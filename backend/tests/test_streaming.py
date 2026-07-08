"""Queue-orchestration tests for PIPELINE_MODE=streaming (no GPU, no models).

Synthesis / vision / critic are stubbed with fast fakes; the real
_streaming_stages threads + queues run underneath. Covered: arrival
ordering, bounded backpressure, cancellation mid-stream, exception
propagation, log-id uniqueness under concurrent ctx.log calls.

Run:  .venv\\Scripts\\python -m pytest tests/test_streaming.py -q
"""

import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents import semantic_critic  # noqa: E402
from app.agents.critic_agent import ReviewedImage, critic_agent  # noqa: E402
from app.agents.prompt_agent import prompt_agent  # noqa: E402
from app.agents.synthesis_agent import synthesis_agent  # noqa: E402
from app.agents.vision_agent import (  # noqa: E402
    ImageAnnotation,
    VisionSession,
    vision_agent,
)
from app.orchestrator.context import RunCancelled, RunContext  # noqa: E402
from app.orchestrator.pipeline import Pipeline  # noqa: E402
from app.schemas import (  # noqa: E402
    CritiqueRecord,
    DomainRandomizationConfig,
    PipelineRun,
    RunProgress,
    SyntheticSourceConfig,
    TrainingConfig,
)
from app.store import now_iso, store  # noqa: E402


def make_run(run_id: str, n_images: int) -> PipelineRun:
    return PipelineRun(
        id=run_id, org_id="org_t", project_id="proj_t", name="streaming-test",
        path="synthetic", status="running", stage="queued",
        pipeline_mode="streaming",
        source=SyntheticSourceConfig(
            path="synthetic",
            use_case="our bench camera needs to detect widgets",
            generator="sdxl",
            randomization=DomainRandomizationConfig(
                lighting_variation=0.2, camera_angle_variation=0.2,
                background_diversity=0.2, occlusion_rate=0.0,
                scenario_count=4, image_count=n_images, guidance_scale=5.0,
            ),
        ),
        training=TrainingConfig(architecture="yolov10n", epochs=1,
                                image_size=640, batch_size=1, device="test"),
        target_classes=["widget"],
        progress=RunProgress(pct=0, images_generated=0, images_total=n_images,
                             masks_accepted=0, masks_rejected=0,
                             current_epoch=0, total_epochs=1),
        created_by="member_1", created_at=now_iso(),
    )


@pytest.fixture()
def counters():
    return {"synth": 0, "vision": 0, "critic": 0, "max_lead": 0}


@pytest.fixture(autouse=True)
def hermetic(monkeypatch):
    """No HTTP probes, no semantic critic, clean log store."""
    monkeypatch.setattr(prompt_agent, "_probe_ok", False)
    monkeypatch.setattr(prompt_agent, "_probe_at", time.monotonic())
    monkeypatch.setattr(semantic_critic, "spot_check",
                        lambda ctx, reviewed, classes: None)
    store.run_logs.clear()
    store.feedback.clear()
    yield


def stub_synthesis(monkeypatch, counters, delay=0.0):
    def generate(ctx, scenarios, out_dir, count, negative_prompt,
                 guidance_scale, on_progress, on_image=None):
        ctx.set_agent("synthesis", "working", "stub")
        paths = []
        for i in range(count):
            ctx.check_cancelled()
            if delay:
                time.sleep(delay)
            path = Path(f"img_{i:04d}.jpg")
            paths.append(path)
            ctx.run.progress.images_generated = i + 1
            counters["synth"] = i + 1
            counters["max_lead"] = max(counters["max_lead"],
                                       counters["synth"] - counters["critic"])
            ctx.log("info", f"[{i + 1}/{count}] stub image", agent="synthesis")
            on_progress(i + 1)
            if on_image is not None:
                on_image(path, scenarios[i % len(scenarios)])
        return paths

    monkeypatch.setattr(synthesis_agent, "generate", generate)


def stub_vision(monkeypatch, counters, delay=0.0, fail_at=None):
    def start(ctx, target_classes):
        def annotate_one(path):
            if fail_at is not None and counters["vision"] + 1 == fail_at:
                raise RuntimeError("vision exploded")
            if delay:
                time.sleep(delay)
            counters["vision"] += 1
            return ImageAnnotation(path=path, width=64, height=64,
                                   detections=[])

        return VisionSession(annotate_one, lambda: None)

    monkeypatch.setattr(vision_agent, "start", start)


def stub_critic(monkeypatch, counters, delay=0.0):
    def review_one(ctx, ann):
        if delay:
            time.sleep(delay)
        counters["critic"] += 1
        ctx.log("critic", f"ACCEPT {ann.path.name}", agent="critic")
        ctx.publish_progress()
        return ReviewedImage(
            path=ann.path, width=ann.width, height=ann.height, boxes=[],
            critique=CritiqueRecord(verdict="accepted", attempts=1,
                                    critic="stub"),
            accepted=True,
        )

    monkeypatch.setattr(critic_agent, "review_one", review_one)


def run_streaming(run, tmp_path):
    ctx = RunContext(run)
    reviewed = Pipeline()._streaming_stages(ctx, tmp_path)
    return ctx, reviewed


def test_arrival_order_stages_and_log_ids(monkeypatch, counters, tmp_path):
    n = 12
    stub_synthesis(monkeypatch, counters)
    stub_vision(monkeypatch, counters)
    stub_critic(monkeypatch, counters)
    run = make_run("run_t_order", n)

    ctx, reviewed = run_streaming(run, tmp_path)

    # Every image reviewed, in generation order (FIFO queues, one consumer).
    assert [r.path.name for r in reviewed] == [f"img_{i:04d}.jpg" for i in range(n)]
    assert run.progress.images_generated == n
    assert run.progress.images_annotated == n

    # Transitions fired in order as each stage drained.
    banners = [e.message for e in store.run_logs[run.id] if e.level == "stage"]
    stage_order = [next(s for s in ("PROMPT EXPANSION", "SYNTHESIS",
                                    "SEGMENTATION", "CRITIC REVIEW")
                        if s in b) for b in banners]
    assert stage_order == ["PROMPT EXPANSION", "SYNTHESIS",
                           "SEGMENTATION", "CRITIC REVIEW"]
    assert run.stage == "critic_review"

    # Log ids stay unique with three threads logging concurrently.
    ids = [e.id for e in store.run_logs[run.id]]
    assert len(ids) == len(set(ids))


def test_bounded_backpressure(monkeypatch, counters, tmp_path):
    # Slow critic, fast producer: the bounded queues (2 × maxsize 4 + items
    # in flight) must cap how far synthesis runs ahead of the critic.
    n = 30
    stub_synthesis(monkeypatch, counters)
    stub_vision(monkeypatch, counters)
    stub_critic(monkeypatch, counters, delay=0.02)
    run = make_run("run_t_backpressure", n)

    _, reviewed = run_streaming(run, tmp_path)

    assert len(reviewed) == n
    assert counters["max_lead"] <= 14, (
        f"synthesis ran {counters['max_lead']} images ahead of the critic — "
        "backpressure is not bounding the stream")


def test_cancellation_mid_stream(monkeypatch, counters, tmp_path):
    n = 50
    stub_synthesis(monkeypatch, counters, delay=0.005)
    stub_vision(monkeypatch, counters)
    stub_critic(monkeypatch, counters, delay=0.01)
    run = make_run("run_t_cancel", n)
    ctx = RunContext(run)

    outcome: dict = {}

    def target():
        try:
            Pipeline()._streaming_stages(ctx, tmp_path)
            outcome["result"] = "completed"
        except BaseException as exc:  # noqa: BLE001
            outcome["exc"] = exc

    t = threading.Thread(target=target, daemon=True)
    t.start()
    deadline = time.monotonic() + 10
    while counters["critic"] < 3 and time.monotonic() < deadline:
        time.sleep(0.005)
    assert counters["critic"] >= 3, "stream never started"
    ctx.cancel_event.set()
    t.join(timeout=10)
    assert not t.is_alive(), "streaming stages did not stop after cancellation"
    assert isinstance(outcome.get("exc"), RunCancelled)
    assert counters["synth"] < n, "cancellation should stop synthesis early"


def test_exception_propagates_and_joins(monkeypatch, counters, tmp_path):
    n = 40
    stub_synthesis(monkeypatch, counters, delay=0.002)
    stub_vision(monkeypatch, counters, fail_at=3)
    stub_critic(monkeypatch, counters)
    run = make_run("run_t_explode", n)

    started = time.monotonic()
    with pytest.raises(RuntimeError, match="vision exploded"):
        run_streaming(run, tmp_path)
    # All threads joined promptly instead of draining the remaining images.
    assert time.monotonic() - started < 10
    assert counters["synth"] < n
