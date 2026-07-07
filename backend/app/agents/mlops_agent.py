"""MLOps Agent — real Ultralytics YOLOv10 training + model registry.

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


class MLOpsAgent:
    def train(self, ctx: RunContext, dataset: Dataset, workdir: Path,
              on_epoch: Callable[[int], None]) -> ModelArtifact:
        from ultralytics import YOLO

        run = ctx.run
        progress = run.progress
        device = device_str()
        arch = run.training.architecture
        epochs = progress.total_epochs
        imgsz = min(run.training.image_size, settings.synthesis_image_size)
        batch = max(1, min(run.training.batch_size, 8))

        ctx.set_agent("mlops", "waiting_gpu", f"Loading {arch} base weights")
        flush_vram(ctx)
        ctx.log("info", f"Starting {arch} training — {epochs} epochs, "
                        f"imgsz {imgsz}, batch {batch}, device {device}",
                agent="mlops")
        model = YOLO(f"{arch}.pt")

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
            metrics = {k.split("/")[-1].rstrip("(B)"): float(v)
                       for k, v in trainer.metrics.items()}
            loss_items = getattr(trainer, "label_loss_items", None)
            losses = (loss_items(trainer.tloss, prefix="") if callable(loss_items)
                      else {})
            box_loss = float(losses.get("box_loss", metrics.get("box_loss", 0)))
            cls_loss = float(losses.get("cls_loss", metrics.get("cls_loss", 0)))
            point = TrainingCurvePoint(
                epoch=trainer.epoch + 1,
                box_loss=round(box_loss, 4), cls_loss=round(cls_loss, 4),
                map50=round(metrics.get("mAP50", 0), 4),
                map5095=round(metrics.get("mAP50-95", 0), 4),
                precision=round(metrics.get("precision", 0), 4),
                recall=round(metrics.get("recall", 0), 4),
            )
            curves.append(point)
            progress.current_epoch = point.epoch
            progress.latest_loss = point.box_loss
            dt = max(time.monotonic() - epoch_started["t"], 1e-6)
            its = getattr(trainer, "epoch_iterations", None) or batch
            telemetry.throughput = Throughput(
                kind="it_per_s",
                value=round((len(trainer.train_loader) if hasattr(trainer, "train_loader") else its) / dt, 2),
            )
            ctx.log("info",
                    f"epoch {point.epoch}/{epochs} — box_loss {point.box_loss:.3f} "
                    f"cls_loss {point.cls_loss:.3f} mAP50 {point.map50:.3f} "
                    f"({dt:.1f}s)", agent="mlops")
            ctx.publish_progress()
            on_epoch(point.epoch)

        model.add_callback("on_train_epoch_start", on_train_epoch_start)
        model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

        results = model.train(
            data=str(workdir / "yolo" / "data.yaml"),
            epochs=epochs, imgsz=imgsz, batch=batch,
            device=0 if device != "cpu" else "cpu",
            workers=0,  # required on Windows inside a non-main thread
            project=str(workdir / "train"), name="yolo", exist_ok=True,
            verbose=False, plots=False,
        )
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
        weights = dest_dir / f"{model_id}_{arch}.pt"
        shutil.copy2(best, weights)

        rd = getattr(results, "results_dict", {}) or {}

        def metric(name: str, fallback: float = 0.0) -> float:
            for key, value in rd.items():
                if name in key:
                    return float(value)
            return fallback

        last = curves[-1] if curves else None
        version = 1 + sum(
            m.run_id in store.runs
            and store.runs[m.run_id].project_id == run.project_id
            for m in store.models.values()
        )
        node = telemetry.build_node(busy=True)
        artifact = ModelArtifact(
            id=model_id, org_id=run.org_id, run_id=run.id, dataset_id=dataset.id,
            name=f"{run.name} · {arch}", version=version, architecture=arch,
            file_name=weights.name,
            file_size_mb=round(weights.stat().st_size / 1024**2, 1),
            classes=run.target_classes,
            metrics=ModelMetrics(
                map50=round(metric("mAP50(B)", last.map50 if last else 0), 4),
                map5095=round(metric("mAP50-95(B)", last.map5095 if last else 0), 4),
                precision=round(metric("precision(B)", last.precision if last else 0), 4),
                recall=round(metric("recall(B)", last.recall if last else 0), 4),
                epochs_run=len(curves),
                training_time_min=round((time.monotonic() - train_started) / 60, 1),
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
    from ultralytics import YOLO

    from ..orchestrator.pipeline import pipeline
    from ..schemas import BoundingBox

    weights = MODELS_DIR / artifact.id / artifact.file_name
    if artifact.id not in _inference_cache:
        _inference_cache.clear()  # keep at most one model warm
        _inference_cache[artifact.id] = YOLO(str(weights))
    model = _inference_cache[artifact.id]

    # A training pipeline owns the GPU; playground requests yield to CPU.
    gpu_busy = pipeline.any_active()
    device = "cpu" if gpu_busy or device_str() == "cpu" else 0

    start = time.monotonic()
    res = model.predict(source=str(image_path), conf=0.25, device=device,
                        verbose=False)[0]
    latency_ms = (time.monotonic() - start) * 1000
    h, w = res.orig_shape

    boxes = []
    for b in res.boxes or []:
        x1, y1, x2, y2 = b.xyxyn[0].tolist()
        boxes.append(BoundingBox(
            class_id=int(b.cls.item()),
            cx=round((x1 + x2) / 2, 4), cy=round((y1 + y2) / 2, 4),
            w=round(x2 - x1, 4), h=round(y2 - y1, 4),
            confidence=round(float(b.conf.item()), 3),
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
    """Return a download URL for the real weights (.pt) or an ONNX export."""
    weights = MODELS_DIR / artifact.id / artifact.file_name
    base = f"{settings.public_base_url}/files/models/{artifact.id}"
    if fmt == "pt":
        return f"{base}/{artifact.file_name}"
    onnx_path = weights.with_suffix(".onnx")
    if not onnx_path.exists():
        from ultralytics import YOLO

        YOLO(str(weights)).export(format="onnx", imgsz=640)
    return f"{base}/{onnx_path.name}"


mlops_agent = MLOpsAgent()
