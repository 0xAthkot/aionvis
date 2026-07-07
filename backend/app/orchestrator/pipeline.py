"""The run orchestrator: one worker thread per pipeline run.

Stage machine (synthetic):
  prompt_expansion → synthesis → segmentation → critic_review
  → dataset_compile → training → complete
BYOD runs enter at segmentation. Heavy agents import torch lazily so the
API server also boots on machines without the ML stack installed.
"""

import threading
import traceback
from pathlib import Path

from .. import telemetry
from ..agents.prompt_agent import prompt_agent
from ..config import DATA_DIR, settings
from ..schemas import AgentInstance, PipelineStage
from ..store import now_iso, store
from .context import RunCancelled, RunContext

# Weights for the overall progress percentage.
STAGE_WEIGHTS: dict[PipelineStage, float] = {
    "prompt_expansion": 5,
    "synthesis": 35,
    "segmentation": 20,
    "critic_review": 10,
    "dataset_compile": 5,
    "training": 25,
}


class Pipeline:
    def __init__(self) -> None:
        self.active: dict[str, RunContext] = {}
        self._lock = threading.Lock()
        # One pipeline owns the GPU at a time; later runs hold status=queued
        # until the slot frees. On a multi-GPU node raise the count.
        self._gpu_slot = threading.Semaphore(1)
        self._queue_order: list[str] = []

    # --- public API ----------------------------------------------------------

    def launch(self, run_id: str) -> None:
        run = store.runs[run_id]
        ctx = RunContext(run)
        with self._lock:
            self.active[run_id] = ctx
        threading.Thread(
            target=self._worker, args=(ctx,), name=f"run-{run_id}", daemon=True
        ).start()

    def request_cancel(self, run_id: str) -> None:
        run = store.runs.get(run_id)
        if run is None or run.status not in ("queued", "running", "paused"):
            return
        ctx = self.active.get(run_id)
        run.status = "cancelled"
        run.finished_at = now_iso()
        if ctx is not None:
            ctx.cancel_event.set()  # worker publishes the final status event
        else:
            store.save()

    def agents_for(self, run_id: str) -> list[AgentInstance]:
        ctx = self.active.get(run_id)
        if ctx is not None:
            return list(ctx.agents.values())
        # Run finished (or predates a restart): reconstruct terminal states.
        run = store.runs[run_id]
        ctx = RunContext(run)  # builds the roster; never started
        terminal = {"succeeded": "done", "failed": "error",
                    "cancelled": "idle"}.get(run.status, "idle")
        for agent in ctx.agents.values():
            agent.state = terminal  # type: ignore[assignment]
        return list(ctx.agents.values())

    def any_active(self) -> bool:
        return any(
            store.runs[rid].status == "running" for rid in list(self.active)
            if rid in store.runs
        )

    # --- progress helper --------------------------------------------------------

    def _pct(self, ctx: RunContext, fraction: float) -> None:
        stages = [s for s in STAGE_WEIGHTS if ctx.run.path == "synthetic"
                  or s not in ("prompt_expansion", "synthesis")]
        total = sum(STAGE_WEIGHTS[s] for s in stages)
        done = 0.0
        for s in stages:
            if s == ctx.run.stage:
                done += STAGE_WEIGHTS[s] * min(max(fraction, 0.0), 1.0)
                break
            done += STAGE_WEIGHTS[s]
        ctx.run.progress.pct = round(done / total * 100, 1)
        ctx.publish_progress()

    # --- GPU slot ------------------------------------------------------------------

    def _acquire_gpu(self, ctx: RunContext) -> bool:
        """Block until the GPU frees. False if cancelled while queued."""
        run = ctx.run
        if not self._gpu_slot.acquire(blocking=False):
            with self._lock:
                self._queue_order.append(run.id)
                position = len(self._queue_order)
            ctx.log("info", f"GPU busy — queued at position {position}. "
                            "The run starts automatically when the node frees.")
            while not self._gpu_slot.acquire(timeout=1.0):
                if ctx.cancel_event.is_set():
                    with self._lock:
                        if run.id in self._queue_order:
                            self._queue_order.remove(run.id)
                    return False
            with self._lock:
                if run.id in self._queue_order:
                    self._queue_order.remove(run.id)
        if ctx.cancel_event.is_set():
            self._gpu_slot.release()
            return False
        return True

    # --- the run ------------------------------------------------------------------

    def _worker(self, ctx: RunContext) -> None:
        run = ctx.run
        workdir = DATA_DIR / "runs" / run.id
        workdir.mkdir(parents=True, exist_ok=True)
        if not self._acquire_gpu(ctx):
            run.status = "cancelled"
            run.finished_at = now_iso()
            ctx.log("warn", "Cancelled while waiting in the GPU queue.")
            ctx.publish_status()
            with self._lock:
                self.active.pop(run.id, None)
            store.save()
            return
        try:
            run.status = "running"
            run.started_at = now_iso()
            ctx.publish_status()
            store.save()
            ctx.log("info", f"Autonomous run '{run.name}' accepted — "
                            f"path: {run.path}, device: {telemetry.GPU.name}")

            if run.path == "synthetic":
                image_paths = self._synthetic_stages(ctx, workdir)
            else:
                image_paths = self._byod_source(ctx)

            annotated = self._segmentation_stage(ctx, image_paths)
            reviewed = self._critic_stage(ctx, annotated)
            dataset = self._compile_stage(ctx, reviewed, workdir)
            self._training_stage(ctx, dataset, workdir)

            ctx.set_stage("complete")
            self._pct(ctx, 1.0)
            run.status = "succeeded"
            run.finished_at = now_iso()
            ctx.log("info", f"Run complete — dataset {run.dataset_id}, "
                            f"model {run.model_id}. Swarm going idle.")
            ctx.publish_status()
        except RunCancelled:
            run.status = "cancelled"
            run.finished_at = now_iso()
            ctx.log("warn", "Cancellation requested — pipeline stopped, "
                            "VRAM released.")
            ctx.publish_status()
        except Exception as exc:  # noqa: BLE001 — a run must never kill the server
            traceback.print_exc()
            run.status = "failed"
            run.failure_reason = f"{type(exc).__name__}: {exc}"
            run.finished_at = now_iso()
            ctx.log("error", f"Pipeline failed: {run.failure_reason}")
            ctx.publish_status()
        finally:
            telemetry.throughput = None
            from ..agents.gpu import flush_vram

            flush_vram(ctx, quiet=True)
            self._gpu_slot.release()
            for kind, agent in ctx.agents.items():
                if agent.state not in ("done", "error"):
                    ctx.set_agent(kind, "done" if run.status == "succeeded" else "idle")
            with self._lock:
                self.active.pop(run.id, None)
            store.save()

    # --- stages ----------------------------------------------------------------------

    def _synthetic_stages(self, ctx: RunContext, workdir: Path) -> list[Path]:
        from ..agents.synthesis_agent import synthesis_agent

        run = ctx.run
        source = run.source  # SyntheticSourceConfig
        rand = source.randomization

        # 1) prompt_expansion
        ctx.set_stage("prompt_expansion",
                      f"{prompt_agent.model_label} via {prompt_agent.provider_label}")
        ctx.set_agent("prompt", "thinking", "Expanding base prompt with domain randomization")
        ctx.check_cancelled()
        n_scenarios = min(rand.scenario_count, run.progress.images_total, 16)
        # Active learning: hard cases flagged in the playground steer this
        # expansion, then are marked consumed.
        pending = [f for f in store.feedback.values()
                   if f.project_id == run.project_id and f.consumed_by_run_id is None]
        if pending:
            ctx.log("info",
                    f"Incorporating {len(pending)} flagged hard case(s) from the "
                    "inference playground into scenario expansion", agent="prompt")
            for f in pending:
                f.consumed_by_run_id = run.id
        scenarios = prompt_agent.expand(
            source.base_prompt, run.target_classes, rand, n_scenarios,
            hard_cases=[f.note for f in pending],
        )
        for i, s in enumerate(scenarios[:5]):
            ctx.log("info", f"scenario[{i}] {s}", agent="prompt")
        if len(scenarios) > 5:
            ctx.log("info", f"… +{len(scenarios) - 5} more scenarios", agent="prompt")
        ctx.set_agent("prompt", "done")
        self._pct(ctx, 1.0)

        # 2) synthesis — output goes under /files so Mission Control can
        # poll GET /runs/{id}/preview and show images as they appear.
        ctx.set_stage("synthesis", f"{settings.sdxl_model} → {run.progress.images_total} images")
        images = synthesis_agent.generate(
            ctx, scenarios, DATA_DIR / "files" / "runs" / run.id,
            count=run.progress.images_total,
            negative_prompt=source.negative_prompt,
            guidance_scale=rand.guidance_scale,
            on_progress=lambda done: self._pct(ctx, done / run.progress.images_total),
        )
        ctx.set_agent("synthesis", "done")
        return images

    def _byod_source(self, ctx: RunContext) -> list[Path]:
        dataset = store.datasets[ctx.run.source.dataset_id]
        raw_dir = DATA_DIR / "byod" / dataset.id
        images = sorted(
            p for p in raw_dir.rglob("*")
            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp", ".webp")
        )
        if not images:
            raise RuntimeError(
                f"BYOD dataset {dataset.id} has no extracted images — "
                "upload the archive as multipart (field 'archive')."
            )
        ctx.run.progress.images_total = len(images)
        ctx.run.progress.images_generated = len(images)
        ctx.log("info", f"BYOD source: {len(images)} images from {dataset.name}")
        return images

    def _segmentation_stage(self, ctx: RunContext, image_paths: list[Path]):
        from ..agents.vision_agent import vision_agent

        ctx.set_stage("segmentation", vision_agent.describe())
        result = vision_agent.annotate(
            ctx, image_paths, ctx.run.target_classes,
            on_progress=lambda done: self._pct(ctx, done / max(len(image_paths), 1)),
        )
        ctx.set_agent("vision", "done")
        return result

    def _critic_stage(self, ctx: RunContext, annotated):
        from ..agents.critic_agent import critic_agent

        ctx.set_stage("critic_review", "OpenCV geometric verification")
        reviewed = critic_agent.review(
            ctx, annotated,
            on_progress=lambda done: self._pct(ctx, done / max(len(annotated), 1)),
        )
        try:
            from ..agents.semantic_critic import spot_check

            spot_check(ctx, reviewed, ctx.run.target_classes)
        except RunCancelled:
            raise
        except Exception as exc:  # semantic stage is best-effort by design
            ctx.log("warn", f"Semantic Critic skipped: {exc}", agent="critic")
        ctx.set_agent("critic", "done")
        return reviewed

    def _compile_stage(self, ctx: RunContext, reviewed, workdir: Path):
        from ..agents.dataset_compiler import compile_dataset

        ctx.set_stage("dataset_compile", "Formatting YOLO dataset")
        ctx.set_agent("mlops", "working", "Compiling YOLO dataset + train/val split")
        dataset = compile_dataset(ctx, reviewed, workdir)
        self._pct(ctx, 1.0)
        return dataset

    def _training_stage(self, ctx: RunContext, dataset, workdir: Path) -> None:
        from ..agents.mlops_agent import mlops_agent

        run = ctx.run
        ctx.set_stage("training",
                      f"{run.training.architecture} · {run.progress.total_epochs} epochs")
        artifact = mlops_agent.train(
            ctx, dataset, workdir,
            on_epoch=lambda e: self._pct(ctx, e / max(run.progress.total_epochs, 1)),
        )
        run.model_id = artifact.id
        ctx.set_agent("mlops", "working", "Writing the model card")
        try:
            from ..agents.model_card import write_model_card

            write_model_card(ctx, artifact, dataset)
        except Exception as exc:  # a missing card must never fail the run
            ctx.log("warn", f"Model card generation failed: {exc}", agent="mlops")
        ctx.set_agent("mlops", "done")


pipeline = Pipeline()
