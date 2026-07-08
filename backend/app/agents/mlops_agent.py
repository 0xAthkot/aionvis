"""MLOps Agent — real Ultralytics training (YOLOv10/11/26, RT-DETR) + registry.

Streams genuine per-epoch metrics from trainer callbacks into the run's
log/progress channels, then registers a ModelArtifact whose curves and
mAP come from the actual training run. Export serves the real weights.
"""

import shutil
import time
from pathlib import Path
from typing import Callable

from .. import telemetry
from ..config import DATA_DIR, settings
from ..orchestrator.context import RunCancelled, RunContext
from ..schemas import (
    Dataset,
    HardwareSummary,
    ModelArtifact,
    ModelMetrics,
    Throughput,
    TrainingCurvePoint,
)
from ..store import now_iso, store
from .gpu import device_str, flush_vram

MODELS_DIR = DATA_DIR / "files" / "models"

# Base-weight suffix per training task (yolo26n + segment → yolo26n-seg.pt).
TASK_SUFFIX = {"detect": "", "segment": "-seg", "obb": "-obb", "pose": "-pose",
               "classify": "-cls"}


def _model_class(arch: str):
    """RT-DETR checkpoints need the RTDETR entry point; YOLO handles the rest."""
    from ultralytics import RTDETR, YOLO

    return RTDETR if arch.startswith("rtdetr") else YOLO


class MLOpsAgent:
    def train(self, ctx: RunContext, dataset: Dataset, workdir: Path,
              on_epoch: Callable[[int], None]) -> ModelArtifact:
        run = ctx.run
        progress = run.progress
        arch = run.training.architecture
        if arch.startswith("rf-detr"):
            from .rfdetr_bridge import train_rfdetr

            return train_rfdetr(ctx, dataset, workdir, on_epoch)
        device = device_str()
        epochs = progress.total_epochs
        imgsz = min(run.training.image_size, settings.max_train_image_size)
        # Batch ceiling comes from .env (MAX_BATCH_SIZE) so the MI300X can
        # actually be fed; the RT-DETR transformer needs ~2× the VRAM per
        # sample of a YOLO CNN, so it gets half the ceiling.
        cap = settings.max_batch_size
        batch: float = max(1, min(run.training.batch_size,
                                  max(cap // 2, 1) if arch.startswith("rtdetr") else cap))
        if settings.auto_batch and device != "cpu":
            # Fractional batch: ultralytics measures free VRAM at train start
            # (after the warm swarm claimed its share — mem_get_info is
            # HIP-backed on ROCm) and sizes the batch to fit this share of it.
            batch = round(min(0.6 / settings.gpu_slots, 0.9), 2)

        task = run.training.task
        base_weights = f"{arch}{TASK_SUFFIX[task]}.pt"
        ctx.set_agent("mlops", "waiting_gpu", f"Loading {base_weights} base weights")
        flush_vram(ctx)
        ctx.log("info", f"Starting {base_weights} training ({task}) — "
                        f"{epochs} epochs, imgsz {imgsz}, batch {batch}, "
                        f"device {device}",
                agent="mlops")
        model = _model_class(arch)(base_weights)

        curves: list[TrainingCurvePoint] = []
        epoch_started = {"t": time.monotonic()}
        train_started = time.monotonic()

        def on_train_epoch_start(trainer) -> None:
            if ctx.cancel_event.is_set():
                trainer.stop = True
            epoch_started["t"] = time.monotonic()
            ctx.set_agent("mlops", "working",
                          f"Epoch {trainer.epoch + 1}/{epochs}")

        def on_fit_epoch_end(trainer) -> None:
            if trainer.epoch + 1 > epochs:
                return  # final-validation pass re-fires this callback
            if curves and curves[-1].epoch == trainer.epoch + 1:
                # ultralytics 8.4 re-fires the final epoch during the
                # closing validation pass (epoch not bumped, losses zeroed).
                return
            metrics = {k.split("/")[-1].rstrip("(B)"): float(v)
                       for k, v in trainer.metrics.items()}
            loss_items = getattr(trainer, "label_loss_items", None)
            losses = (loss_items(trainer.tloss, prefix="") if callable(loss_items)
                      else {})
            box_loss = float(losses.get("box_loss", metrics.get("box_loss", 0)))
            cls_loss = float(losses.get("cls_loss",
                                        metrics.get("cls_loss",
                                                    losses.get("loss", 0))))
            top1 = metrics.get("accuracy_top1")
            point = TrainingCurvePoint(
                epoch=trainer.epoch + 1,
                box_loss=round(box_loss, 4), cls_loss=round(cls_loss, 4),
                map50=round(metrics.get("mAP50", 0), 4),
                map5095=round(metrics.get("mAP50-95", 0), 4),
                precision=round(metrics.get("precision", 0), 4),
                recall=round(metrics.get("recall", 0), 4),
                top1=round(top1, 4) if top1 is not None else None,
            )
            curves.append(point)
            progress.current_epoch = point.epoch
            progress.latest_loss = point.box_loss if task != "classify" else point.cls_loss
            dt = max(time.monotonic() - epoch_started["t"], 1e-6)
            its = getattr(trainer, "epoch_iterations", None) or batch
            telemetry.throughput = Throughput(
                kind="it_per_s",
                value=round((len(trainer.train_loader) if hasattr(trainer, "train_loader") else its) / dt, 2),
            )
            headline = (f"top1 {point.top1:.3f}" if point.top1 is not None
                        else f"mAP50 {point.map50:.3f}")
            ctx.log("info",
                    f"epoch {point.epoch}/{epochs} — box_loss {point.box_loss:.3f} "
                    f"cls_loss {point.cls_loss:.3f} {headline} "
                    f"({dt:.1f}s)", agent="mlops")
            ctx.publish_progress()
            on_epoch(point.epoch)

        model.add_callback("on_train_epoch_start", on_train_epoch_start)
        model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

        # Classify trains on the imagefolder crops; every other task on the
        # YOLO-format dataset. Classify crops are small — cap imgsz at 224.
        data_arg = (str(workdir / "cls") if task == "classify"
                    else str(workdir / "yolo" / "data.yaml"))

        def fit(b):
            return model.train(
                data=data_arg,
                epochs=epochs, imgsz=min(imgsz, 224) if task == "classify" else imgsz,
                batch=b,
                device=0 if device != "cpu" else "cpu",
                workers=0,  # required on Windows inside a non-main thread
                project=str(workdir / "train"), name="yolo", exist_ok=True,
                verbose=False, plots=False,
            )

        try:
            results = fit(batch)
        except Exception as exc:
            import torch

            if device == "cpu" or not isinstance(exc, torch.cuda.OutOfMemoryError):
                raise
            # Degrade instead of dying: halve the batch (or fraction),
            # flush, retry exactly once.
            halved = round(batch / 2, 2) if isinstance(batch, float) else max(batch // 2, 1)
            ctx.log("warn",
                    f"Out of GPU memory at batch {batch} — flushing VRAM and "
                    f"retrying once at batch {halved}", agent="mlops")
            flush_vram(ctx)
            curves.clear()
            progress.current_epoch = 0
            batch = halved
            results = fit(batch)
        if ctx.cancel_event.is_set():
            raise RunCancelled()
        telemetry.throughput = None

        # --- register the artifact off the real best.pt --------------------------
        best = Path(model.trainer.best)
        if not best.exists():
            best = Path(model.trainer.last)
        model_id = store.next_id("model")
        dest_dir = MODELS_DIR / model_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        weights = dest_dir / f"{model_id}_{arch}{TASK_SUFFIX[task]}.pt"
        shutil.copy2(best, weights)

        rd = getattr(results, "results_dict", {}) or {}

        def metric(name: str, fallback: float = 0.0) -> float:
            for key, value in rd.items():
                if name in key:
                    return float(value)
            return fallback

        last = curves[-1] if curves else None
        # A classifier's class indices follow the SORTED crop folder names,
        # which may be a subset of target_classes (classes with no usable
        # crop don't exist to the model).
        if task == "classify":
            classes = sorted(
                d.name for d in (workdir / "cls" / "train").iterdir() if d.is_dir()
            )
            top1 = metric("accuracy_top1", last.top1 if last and last.top1 else 0)
            top5 = metric("accuracy_top5", 0.0)
        else:
            classes = run.target_classes
            top1 = top5 = None
        version = 1 + sum(
            m.run_id in store.runs
            and store.runs[m.run_id].project_id == run.project_id
            for m in store.models.values()
        )
        node = telemetry.build_node(busy=True)
        artifact = ModelArtifact(
            id=model_id, org_id=run.org_id, run_id=run.id, dataset_id=dataset.id,
            name=f"{run.name} · {arch}{TASK_SUFFIX[task]}", version=version,
            architecture=arch, task=task,
            file_name=weights.name,
            file_size_mb=round(weights.stat().st_size / 1024**2, 1),
            classes=classes,
            metrics=ModelMetrics(
                map50=round(metric("mAP50(B)", last.map50 if last else 0), 4),
                map5095=round(metric("mAP50-95(B)", last.map5095 if last else 0), 4),
                precision=round(metric("precision(B)", last.precision if last else 0), 4),
                recall=round(metric("recall(B)", last.recall if last else 0), 4),
                epochs_run=len(curves),
                training_time_min=round((time.monotonic() - train_started) / 60, 1),
                top1=round(top1, 4) if top1 is not None else None,
                top5=round(top5, 4) if top5 is not None else None,
            ),
            curves=curves,
            trained_on=HardwareSummary(
                node_name=node.name, gpu=node.gpu, vram_gb=node.vram_gb,
                rocm_version=node.rocm_version,
            ),
            status="ready", created_at=now_iso(),
        )
        store.models[model_id] = artifact
        store.save()
        ctx.log("info",
                f"Model {model_id} registered — mAP50 {artifact.metrics.map50:.3f}, "
                f"{artifact.file_size_mb} MB, trained in "
                f"{artifact.metrics.training_time_min} min", agent="mlops")
        flush_vram(ctx)
        return artifact


# One loaded model kept warm for the inference playground; swapped on demand.
_inference_cache: dict[str, object] = {}


def run_inference(artifact: ModelArtifact, image_path: Path) -> dict:
    """Real inference with the trained weights; returns PredictionResult fields."""
    if artifact.architecture.startswith("rf-detr"):
        from .rfdetr_bridge import predict_rfdetr

        return predict_rfdetr(artifact, image_path)
    from ..orchestrator.pipeline import pipeline
    from ..schemas import BoundingBox

    weights = MODELS_DIR / artifact.id / artifact.file_name
    if artifact.id not in _inference_cache:
        _inference_cache.clear()  # keep at most one model warm
        _inference_cache[artifact.id] = _model_class(artifact.architecture)(
            str(weights))
    model = _inference_cache[artifact.id]

    # On a single-slot GPU a training pipeline owns the card and playground
    # requests yield to CPU. With GPU_SLOTS > 1 (MI300X) the card has room —
    # inference stays on GPU alongside active pipelines.
    gpu_busy = pipeline.any_active() and settings.gpu_slots == 1
    device = "cpu" if gpu_busy or device_str() == "cpu" else 0

    start = time.monotonic()
    res = model.predict(source=str(image_path), conf=0.25, max_det=50,
                        device=device, verbose=False)[0]
    latency_ms = (time.monotonic() - start) * 1000
    h, w = res.orig_shape

    boxes = []
    if getattr(res, "probs", None) is not None:
        # Classifier: no boxes — report the top-1 class as a full-frame
        # "detection" so the playground can render the label + confidence.
        probs = res.probs
        boxes.append(BoundingBox(
            class_id=int(probs.top1),
            cx=0.5, cy=0.5, w=1.0, h=1.0,
            confidence=round(float(probs.top1conf.item()), 3),
        ))
    for b in res.boxes or []:
        x1, y1, x2, y2 = b.xyxyn[0].tolist()
        boxes.append(BoundingBox(
            class_id=int(b.cls.item()),
            cx=round((x1 + x2) / 2, 4), cy=round((y1 + y2) / 2, 4),
            w=round(x2 - x1, 4), h=round(y2 - y1, 4),
            confidence=round(float(b.conf.item()), 3),
        ))
    if res.boxes is None and getattr(res, "obb", None) is not None:
        # OBB models emit rotated boxes; give the playground their
        # axis-aligned hull plus the rotated corners as the polygon.
        for ob in res.obb:
            corners = ob.xyxyxyxyn[0].reshape(-1, 2).tolist()
            xs, ys = [c[0] for c in corners], [c[1] for c in corners]
            x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
            boxes.append(BoundingBox(
                class_id=int(ob.cls.item()),
                cx=round((x1 + x2) / 2, 4), cy=round((y1 + y2) / 2, 4),
                w=round(x2 - x1, 4), h=round(y2 - y1, 4),
                confidence=round(float(ob.conf.item()), 3),
                polygon=[round(v, 4) for c in corners for v in c],
            ))

    gpu_name = telemetry.GPU.name
    device_label = (
        f"cpu (GPU busy with a pipeline run)" if gpu_busy and device == "cpu"
        else "cpu" if device == "cpu"
        else f"cuda:0 · {gpu_name}"
    )
    return {
        "boxes": boxes,
        "latency_ms": round(latency_ms, 1),
        "device": device_label,
        "width": int(w),
        "height": int(h),
    }


def export_artifact(artifact: ModelArtifact, fmt: str) -> str:
    """Return a download URL for the weights in the requested format.

    pt serves the training checkpoint as-is; onnx/torchscript convert to a
    single file; openvino produces a directory, so it's zipped for download.
    Conversions are cached next to the weights.
    """
    weights = MODELS_DIR / artifact.id / artifact.file_name
    base = f"{settings.public_base_url}/files/models/{artifact.id}"
    if artifact.architecture.startswith("rf-detr"):
        from .rfdetr_bridge import export_rfdetr

        return export_rfdetr(artifact, fmt, base)
    if fmt == "pt":
        return f"{base}/{artifact.file_name}"

    if fmt == "openvino":
        zip_path = weights.with_name(weights.stem + "_openvino.zip")
        if not zip_path.exists():
            _model_class(artifact.architecture)(str(weights)).export(
                format="openvino", imgsz=640)
            ov_dir = weights.with_name(weights.stem + "_openvino_model")
            shutil.make_archive(str(zip_path.with_suffix("")), "zip", ov_dir)
        return f"{base}/{zip_path.name}"

    suffix = {"onnx": ".onnx", "torchscript": ".torchscript"}[fmt]
    out_path = weights.with_suffix(suffix)
    if not out_path.exists():
        _model_class(artifact.architecture)(str(weights)).export(
            format=fmt, imgsz=640)
    return f"{base}/{out_path.name}"


mlops_agent = MLOpsAgent()
