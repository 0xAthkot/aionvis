"""Big-run design: split storage, unlimited scenes with a class mix, and the
Critic VLM over every label. CPU only, no models, no real LLM.

Run:  .venv\\Scripts\\python -m pytest tests/test_scaling.py -q
"""

import json
import sys
from collections import Counter
from pathlib import Path

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import store as store_mod  # noqa: E402
from app.agents import prompt_agent as pa_mod  # noqa: E402
from app.agents import semantic_critic as sc_mod  # noqa: E402
from app.agents.critic_agent import ReviewedImage  # noqa: E402
from app.agents.prompt_agent import SceneSpec, plan_scenes, prompt_agent  # noqa: E402
from app.orchestrator.context import RunContext  # noqa: E402
from app.schemas import (  # noqa: E402
    AnnotatedImage,
    BoundingBox,
    CritiqueRecord,
    Dataset,
    DomainRandomizationConfig,
    LogEvent,
    PipelineRun,
    RunProgress,
    SyntheticSourceConfig,
    TrainingConfig,
)


def rand_cfg(**kw) -> DomainRandomizationConfig:
    base = dict(lighting_variation=0.6, camera_angle_variation=0.5,
                background_diversity=0.6, occlusion_rate=0.2,
                scenario_count=10, image_count=10, guidance_scale=4.0)
    base.update(kw)
    return DomainRandomizationConfig(**base)


# --- storage ------------------------------------------------------------------------


@pytest.fixture()
def disk(tmp_path, monkeypatch):
    """A fresh Store writing to a temp data dir (the global one is mocked)."""
    monkeypatch.setattr(store_mod, "DATA_DIR", tmp_path)
    monkeypatch.setattr(store_mod, "STATE_FILE", tmp_path / "state.json")
    monkeypatch.setattr(store_mod, "LOGS_DIR", tmp_path / "logs")
    monkeypatch.setattr(store_mod, "IMAGES_DIR", tmp_path / "images")
    s = store_mod.Store()
    s.seed()
    return s, tmp_path


def _event(run_id: str, i: int) -> LogEvent:
    return LogEvent(id=f"{run_id}-log-{i:05d}", run_id=run_id, at="t",
                    level="info", message=f"line {i}")


def _image(ds: str, i: int) -> AnnotatedImage:
    return AnnotatedImage(
        id=f"{ds}-img-{i}", dataset_id=ds, file_name=f"img_{i}.jpg", width=8,
        height=8, url="u", thumbnail_url="t", split="train",
        curation_state="accepted",
        boxes=[BoundingBox(class_id=0, cx=.5, cy=.5, w=.2, h=.2, polygon=[0.1] * 40)])


def _dataset(ds: str) -> Dataset:
    return Dataset(id=ds, org_id="org", name=ds, origin="synthetic", status="ready",
                   image_count=3, labeled_count=3, classes=[], size_mb=0,
                   created_at="t")


def test_logs_go_to_their_own_file_and_tail_reads_backwards(disk):
    s, root = disk
    for i in range(6000):
        s.append_log(_event("run_x", i))
    s.save()
    assert len(s.run_logs["run_x"]) == store_mod.LOG_TAIL  # memory is bounded
    assert "runLogs" not in json.loads((root / "state.json").read_text())
    assert len(s.read_logs("run_x")) == 6000  # full history from disk
    tail = s.read_logs("run_x", limit=3)
    assert [e.message for e in tail] == ["line 5997", "line 5998", "line 5999"]
    s.drop_logs("run_x")
    assert not (root / "logs" / "run_x.jsonl").exists()


def test_images_live_per_dataset_and_curation_is_appended(disk):
    s, root = disk
    s.datasets["ds_a"] = _dataset("ds_a")
    s.set_images("ds_a", [_image("ds_a", i) for i in range(3)])
    s.save()
    f = root / "images" / "ds_a.json"
    assert f.exists() and "images" not in json.loads((root / "state.json").read_text())
    before = f.stat().st_mtime_ns
    s.images["ds_a"][1].curation_state = "rejected"
    s.record_curation("ds_a", "ds_a-img-1", "rejected")
    s.save()
    assert f.stat().st_mtime_ns == before  # a click never rewrites the dataset
    fresh = store_mod.Store()
    fresh.load()
    assert [i.curation_state for i in fresh.images["ds_a"]] == \
        ["accepted", "rejected", "accepted"]
    fresh.drop_images("ds_a")
    fresh.save()
    assert not f.exists()


def test_legacy_single_file_state_migrates(disk):
    s, root = disk
    legacy = {
        "organizations": [o.model_dump(by_alias=True) for o in s.organizations],
        "members": [], "projects": [], "runs": [],
        "datasets": [_dataset("ds_old").model_dump(by_alias=True)],
        "images": {"ds_old": [_image("ds_old", i).model_dump(by_alias=True)
                              for i in range(2)]},
        "runLogs": {"run_old": [_event("run_old", i).model_dump(by_alias=True)
                                for i in range(4)]},
        "models": [], "apiKeys": [], "feedback": [], "gpuSecondsUsed": 1.0,
    }
    (root / "state.json").write_text(json.dumps(legacy))
    fresh = store_mod.Store()
    assert fresh.load()
    state = json.loads((root / "state.json").read_text())
    assert "images" not in state and "runLogs" not in state  # bulk moved out
    assert (root / "images" / "ds_old.json").exists()
    assert len(fresh.images["ds_old"]) == 2
    assert [e.message for e in fresh.read_logs("run_old")] == \
        [f"line {i}" for i in range(4)]


# --- scene plan + class mix ------------------------------------------------------------


def test_few_classes_keep_the_classic_all_classes_scene():
    plan = plan_scenes(["forklift", "pallet", "worker"], rand_cfg(), 7)
    assert plan == [SceneSpec(primary=None)] * 7


def test_class_mix_is_exact_even_for_small_runs():
    cfg = rand_cfg(class_mix={"hard hat": 50, "safety_vest": 30, "worker": 20})
    plan = plan_scenes(["hard_hat", "safety vest", "worker"], cfg, 10)
    assert Counter(s.primary for s in plan) == {"hard hat": 5, "safety vest": 3,
                                                "worker": 2}
    big = Counter(s.primary for s in plan_scenes(
        ["hard_hat", "safety vest", "worker"], cfg, 1000))
    assert big == {"hard hat": 500, "safety vest": 300, "worker": 200}
    assert all(s.companions == 2 for s in plan)


def test_many_classes_spread_equally_and_mix_can_exclude():
    classes = [f"c{i}" for i in range(20)]
    shares = Counter(s.primary for s in plan_scenes(classes, rand_cfg(), 200))
    assert set(shares.values()) == {10}
    cfg = rand_cfg(class_mix={"c0": 1, "c1": 1})
    assert set(s.primary for s in plan_scenes(classes, cfg, 40)) == {"c0", "c1"}


# --- parallel scene design against a fake LLM ------------------------------------------


class _FakeLLM:
    """Answers each design call with uniquely numbered scenes (plus one exact
    duplicate per batch); calls for one facet fail outright."""

    calls: list[dict] = []
    _lock = __import__("threading").Lock()
    _n = 0

    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, headers=None, json=None):
        text = json["messages"][1]["content"]
        with _FakeLLM._lock:
            _FakeLLM.calls.append(json)
            _FakeLLM._n += 1
            call_no = _FakeLLM._n
        if "bright midday sun, close-up framing" in text:
            raise httpx.ConnectError("boom")
        n = int(text.split("exactly ")[1].split(" ")[0])
        scenes = [f"scene {call_no}-{i}" for i in range(n)]
        scenes[-1] = scenes[0]
        req = httpx.Request("POST", url)
        return httpx.Response(200, request=req, json={
            "choices": [{"message": {"content": _dumps(scenes)}}]})


def _dumps(x):
    return json.dumps(x)


def test_parallel_design_scales_dedupes_and_survives_a_failed_batch(monkeypatch):
    _FakeLLM.calls = []
    monkeypatch.setattr(prompt_agent, "_probe_ok", True)
    monkeypatch.setattr(prompt_agent, "_probe_at", 1e18)
    monkeypatch.setattr(pa_mod.httpx, "Client", _FakeLLM)
    prompt_agent._cache.clear()
    cfg = rand_cfg(class_mix={"a": 1, "b": 1, "c": 1, "d": 1},
                   scenario_count=500, image_count=500)
    out = prompt_agent.expand("a site camera needs to see things",
                              ["a", "b", "c", "d"], cfg, 500)
    assert len(out) == 500 and len(set(out)) == 500  # no ceiling, all unique
    assert len(_FakeLLM.calls) == 32  # ceil(500 / 16) batches
    facets = {c["messages"][1]["content"].split("Vary this batch around: ")[1]
              .split(".")[0] for c in _FakeLLM.calls}
    assert len(facets) > 8  # batches steered to different facets
    first = _FakeLLM.calls[0]["messages"][1]["content"]
    assert "1. main subject: a" in first and "2. main subject: b" in first
    prompt_agent._cache.clear()


# --- Critic VLM over every label ------------------------------------------------------


def _run() -> PipelineRun:
    return PipelineRun(
        id="run_sem", org_id="o", project_id="p", name="t", path="synthetic",
        status="running", stage="critic_review", semantic_check="all",
        source=SyntheticSourceConfig(path="synthetic", use_case="drone sees workers",
                                     generator="flux", randomization=rand_cfg()),
        training=TrainingConfig(architecture="yolo26n", epochs=1, image_size=320,
                                batch_size=2, device="cpu"),
        target_classes=["worker"],
        progress=RunProgress(pct=0, images_generated=0, images_total=2,
                             masks_accepted=3, masks_rejected=0,
                             current_epoch=0, total_epochs=1),
        created_by="m", created_at="t")


def _reviewed(tmp_path, n_boxes: int, name: str) -> ReviewedImage:
    p = tmp_path / name
    Image.new("RGB", (64, 64), (120, 90, 60)).save(p)
    return ReviewedImage(
        path=p, width=64, height=64,
        boxes=[BoundingBox(class_id=0, cx=.5, cy=.5, w=.4, h=.4) for _ in range(n_boxes)],
        critique=CritiqueRecord(verdict="accepted", attempts=1, critic="geo"),
        accepted=True)


def test_every_label_gets_a_verdict_and_only_no_removes(tmp_path, monkeypatch):
    monkeypatch.setattr(prompt_agent, "_probe_ok", True)
    monkeypatch.setattr(prompt_agent, "_probe_at", 1e18)
    answers = iter(["YES", "UNSURE", "NO"])
    seen_deployments = []

    def fake_ask(client, b64, cls, deployment):
        seen_deployments.append(deployment)
        return next(answers)

    monkeypatch.setattr(sc_mod, "_ask", fake_ask)
    monkeypatch.setattr(sc_mod, "_CONCURRENCY", 1)  # deterministic answer order
    ctx = RunContext(_run())
    a, b = _reviewed(tmp_path, 2, "a.jpg"), _reviewed(tmp_path, 1, "b.jpg")
    v = sc_mod.SemanticVerifier(ctx, ["worker"], mode="all")
    v.submit(a)
    v.submit(b)
    v.finish([a, b])
    assert [x.semantic for x in a.boxes] == ["confirmed", "unsure"]
    assert b.boxes == [] and not b.accepted  # its only label was a clear NO
    assert ctx.run.progress.masks_accepted == 2 and ctx.run.progress.masks_rejected == 1
    assert seen_deployments == ["drone sees workers"] * 3  # critic knows the viewpoint


def test_unreachable_vlm_stops_and_geometry_stands(tmp_path, monkeypatch):
    monkeypatch.setattr(prompt_agent, "_probe_ok", True)
    monkeypatch.setattr(prompt_agent, "_probe_at", 1e18)

    def down(*a):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(sc_mod, "_ask", down)
    ctx = RunContext(_run())
    imgs = [_reviewed(tmp_path, 2, f"i{k}.jpg") for k in range(6)]
    v = sc_mod.SemanticVerifier(ctx, ["worker"], mode="all")
    for img in imgs:
        v.submit(img)
    v.finish(imgs)
    assert all(len(i.boxes) == 2 and i.accepted for i in imgs)
    assert all(b.semantic is None for i in imgs for b in i.boxes)


# --- logs endpoint limit --------------------------------------------------------------


def test_logs_endpoint_limit():
    from starlette.testclient import TestClient

    from app.main import app
    from app.store import store

    run = _run().model_copy(update={"id": "run_logs_t"})
    store.runs[run.id] = run
    store.start_run_log(run.id)
    try:
        for i in range(10):
            store.append_log(_event(run.id, i))
        c = TestClient(app)
        assert len(c.get(f"/api/v1/runs/{run.id}/logs").json()) == 10
        last = c.get(f"/api/v1/runs/{run.id}/logs?limit=2").json()
        assert [e["message"] for e in last] == ["line 8", "line 9"]
    finally:
        store.runs.pop(run.id, None)
        store.drop_logs(run.id)
