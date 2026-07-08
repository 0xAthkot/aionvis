"""The run orchestrator: one worker thread per pipeline run.

Stage machine (synthetic):
  prompt_expansion → synthesis → segmentation → critic_review
  → dataset_compile → training → complete
BYOD runs enter at segmentation. Heavy agents import torch lazily so the
API server also boots on machines without the ML stack installed.

PIPELINE_MODE=streaming (MI300X, requires KEEP_MODELS_WARM): the three
middle stages overlap as bounded producer/consumer streams — see
_streaming_stages. Stage semantics there: run.stage is the earliest stage
with pending items (the bottleneck), and StageTransitions still fire in
order as each stage drains. Training needs the full compiled dataset, so
it joins after the streams drain.
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

# Sentinel a queue reader receives when the stream was aborted (failure or
# cancellation) rather than drained; None marks a normal drain.
_ABORT = object()


class Pipeline:
    def __init__(self) -> None:
        self.active: dict[str, RunContext] = {}
        self._lock = threading.Lock()
        # GPU_SLOTS pipelines own the GPU at a time (1 on small cards; the
        # MI300X profile runs 2); later runs hold status=queued until a
        # slot frees.
        self._gpu_slot = threading.Semaphore(settings.gpu_slots)
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
            busy = (f"All {settings.gpu_slots} GPU slots busy"
                    if settings.gpu_slots > 1 else "GPU busy")
            ctx.log("info", f"{busy} — queued at position {position}. "
                            "The run starts automatically when a slot frees.")
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

            source_dataset = (store.datasets.get(run.source.dataset_id)
                              if run.path == "byod" else None)
            audit = source_dataset is not None and bool(source_dataset.imported_labels)

            if run.pipeline_mode == "streaming" and not audit:
                # Parallel swarm: synthesis → vision → critic overlap.
                # Audit runs stay sequential (near-instant, nothing to win).
                reviewed = self._streaming_stages(ctx, workdir)
            elif audit:
                # Audit mode: the archive shipped labels — verify them
                # instead of relabeling (Vision Agent yields).
                image_paths = self._byod_source(ctx)
                reviewed = self._audit_stages(ctx, source_dataset, image_paths)
            else:
                image_paths = (self._synthetic_stages(ctx, workdir)
                               if run.path == "synthetic"
                               else self._byod_source(ctx))
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

    def _prompt_stage(self, ctx: RunContext) -> list[str]:
        run = ctx.run
        source = run.source  # SyntheticSourceConfig
        rand = source.randomization

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
        return scenarios

    def _synthetic_stages(self, ctx: RunContext, workdir: Path) -> list[Path]:
        from ..agents.synthesis_agent import synthesis_agent

        run = ctx.run
        source = run.source  # SyntheticSourceConfig

        # 1) prompt_expansion
        scenarios = self._prompt_stage(ctx)

        # 2) synthesis — output goes under /files so Mission Control can
        # poll GET /runs/{id}/preview and show images as they appear.
        generator_model = (settings.flux_model if source.generator == "flux"
                           else settings.sdxl_model)
        ctx.set_stage("synthesis",
                      f"{generator_model} → {run.progress.images_total} images")
        images = synthesis_agent.generate(
            ctx, scenarios, DATA_DIR / "files" / "runs" / run.id,
            count=run.progress.images_total,
            negative_prompt=source.negative_prompt,
            guidance_scale=source.randomization.guidance_scale,
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

        ctx.set_stage("critic_review", "Geometric checks + Gemma VLM verification")
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

    def _streaming_stages(self, ctx: RunContext, workdir: Path):
        """PIPELINE_MODE=streaming: synthesis → vision → critic overlap as
        bounded producer/consumer streams, every model resident on one card.

        Synthetic runs: three threads (synth → q_vision → vision → q_critic
        → critic). Unlabeled BYOD: two (vision reads the extracted files).
        Queues are bounded so a stalled consumer applies backpressure
        instead of buffering the whole run. On failure/cancellation in any
        thread the stream is poisoned, all threads join, and the first
        exception re-raises — same failure semantics as sequential mode.
        """
        import queue

        from ..agents.critic_agent import critic_agent
        from ..agents.vision_agent import vision_agent

        run = ctx.run
        progress = run.progress
        synthetic = run.path == "synthetic"
        scenarios = self._prompt_stage(ctx) if synthetic else None
        image_paths = None if synthetic else self._byod_source(ctx)
        total = max(progress.images_total, 1)

        q_vision: queue.Queue = queue.Queue(maxsize=4)
        q_critic: queue.Queue = queue.Queue(maxsize=4)
        stop = threading.Event()
        failures: list[BaseException] = []
        fail_lock = threading.Lock()
        reviewed: list = []  # ReviewedImage, in arrival order

        def fail(exc: BaseException) -> None:
            with fail_lock:
                failures.append(exc)
            stop.set()

        def q_put(q: queue.Queue, item) -> bool:
            """Bounded put that aborts when the stream is poisoned."""
            while not stop.is_set():
                try:
                    q.put(item, timeout=0.25)
                    return True
                except queue.Full:
                    continue
            return False

        def q_get(q: queue.Queue):
            while not stop.is_set():
                try:
                    return q.get(timeout=0.25)
                except queue.Empty:
                    continue
            return _ABORT

        def publish_pct() -> None:
            # Overall % during the overlap = weighted mean of the three
            # per-image stage fractions (prompt stage already complete).
            stages = [s for s in STAGE_WEIGHTS if synthetic
                      or s not in ("prompt_expansion", "synthesis")]
            total_w = sum(STAGE_WEIGHTS[s] for s in stages)
            done = 0.0
            if synthetic:
                done += STAGE_WEIGHTS["prompt_expansion"]
                done += STAGE_WEIGHTS["synthesis"] * min(
                    progress.images_generated / total, 1.0)
            done += STAGE_WEIGHTS["segmentation"] * min(
                (progress.images_annotated or 0) / total, 1.0)
            done += STAGE_WEIGHTS["critic_review"] * min(len(reviewed) / total, 1.0)
            progress.pct = round(done / total_w * 100, 1)
            ctx.publish_progress()

        def synth_worker() -> None:
            from ..agents.synthesis_agent import synthesis_agent

            source = run.source
            try:
                def hand_off(path: Path, scenario: str) -> None:
                    ctx.check_cancelled()
                    if not q_put(q_vision, path):
                        raise RunCancelled()  # stream aborted downstream

                synthesis_agent.generate(
                    ctx, scenarios, DATA_DIR / "files" / "runs" / run.id,
                    count=progress.images_total,
                    negative_prompt=source.negative_prompt,
                    guidance_scale=source.randomization.guidance_scale,
                    on_progress=lambda done: publish_pct(),
                    on_image=hand_off,
                )
                ctx.set_agent("synthesis", "done")
                # Synthesis drained — the bottleneck moves downstream.
                ctx.set_stage("segmentation", vision_agent.describe())
            except BaseException as exc:  # noqa: BLE001 — poison the stream
                fail(exc)
            finally:
                q_put(q_vision, None)

        def vision_worker() -> None:
            session = None
            try:
                ctx.set_agent("vision", "waiting_gpu",
                              f"Loading {vision_agent.describe()}")
                session = vision_agent.start(ctx, run.target_classes)
                ctx.set_agent("vision", "working",
                              f"Segmenting the image stream, "
                              f"{len(run.target_classes)} target concepts")

                def paths():
                    if not synthetic:
                        yield from image_paths
                        return
                    while True:
                        item = q_get(q_vision)
                        if item is None or item is _ABORT:
                            return
                        yield item

                for path in paths():
                    ctx.check_cancelled()
                    ann = session.annotate_one(path)
                    progress.images_annotated = (progress.images_annotated or 0) + 1
                    ctx.log("info",
                            f"[{progress.images_annotated}/{progress.images_total}] "
                            f"{path.name}: {len(ann.detections)} candidate masks",
                            agent="vision")
                    publish_pct()
                    if not q_put(q_critic, ann):
                        return
                if not stop.is_set():
                    ctx.set_agent("vision", "done")
                    ctx.set_stage("critic_review", "Geometric checks + Gemma VLM verification")
            except BaseException as exc:  # noqa: BLE001 — poison the stream
                fail(exc)
            finally:
                if session is not None:
                    session.close()
                q_put(q_critic, None)

        def critic_worker() -> None:
            try:
                ctx.set_agent("critic", "working",
                              "Reviewing annotations as they stream in")
                while True:
                    item = q_get(q_critic)
                    if item is None or item is _ABORT:
                        return
                    ctx.check_cancelled()
                    reviewed.append(critic_agent.review_one(ctx, item))
                    publish_pct()
            except BaseException as exc:  # noqa: BLE001 — poison the stream
                fail(exc)

        progress.images_annotated = 0
        ctx.log("info",
                "Parallel swarm engaged — synthesis, vision and critic stream "
                "concurrently on the resident models (PIPELINE_MODE=streaming)")
        if synthetic:
            generator_model = (settings.flux_model
                               if run.source.generator == "flux"
                               else settings.sdxl_model)
            ctx.set_stage("synthesis",
                          f"{generator_model} → streaming into "
                          f"{vision_agent.describe()}")
        else:
            ctx.set_stage("segmentation",
                          f"{vision_agent.describe()} — streaming into the Critic")

        workers = [threading.Thread(target=vision_worker,
                                    name=f"vision-{run.id}", daemon=True),
                   threading.Thread(target=critic_worker,
                                    name=f"critic-{run.id}", daemon=True)]
        if synthetic:
            workers.insert(0, threading.Thread(target=synth_worker,
                                               name=f"synth-{run.id}", daemon=True))
        for t in workers:
            t.start()
        while any(t.is_alive() for t in workers):
            if ctx.cancel_event.is_set():
                stop.set()  # unblock queue waits; workers exit via _ABORT
            for t in workers:
                t.join(timeout=0.25)
        if failures:
            raise failures[0]
        ctx.check_cancelled()

        critic_agent.log_summary(ctx, reviewed)
        try:
            from ..agents.semantic_critic import spot_check

            spot_check(ctx, reviewed, run.target_classes)
        except RunCancelled:
            raise
        except Exception as exc:  # semantic stage is best-effort by design
            ctx.log("warn", f"Semantic Critic skipped: {exc}", agent="critic")
        ctx.set_agent("critic", "done")
        return reviewed

    def _audit_stages(self, ctx: RunContext, dataset, image_paths: list[Path]):
        """Imported-label runs: segmentation is a no-op handoff, critic_review
        audits the provided annotations. Same stage machine, same output shape."""
        from ..agents.label_audit import audit_labels

        fmt = dataset.imported_labels.format.upper()
        ctx.set_stage("segmentation", f"{fmt} labels provided — audit mode")
        ctx.log("info",
                f"Archive shipped {dataset.imported_labels.box_count} {fmt} "
                "labels — Vision Agent yields to the Label Audit", agent="vision")
        ctx.set_agent("vision", "done")
        self._pct(ctx, 1.0)

        ctx.set_stage("critic_review", "Auditing imported annotations")
        reviewed = audit_labels(
            ctx, dataset, image_paths,
            on_progress=lambda done: self._pct(ctx, done / max(len(image_paths), 1)),
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
