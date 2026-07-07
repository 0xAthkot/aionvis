"""Bridge to the isolated RF-DETR runtime (.venv-rfdetr + rfdetr_worker.py).

rfdetr needs transformers>=5 while the SDXL synthesis stack pins <5, so
RF-DETR runs in its own venv and the backend talks to it over a subprocess
line protocol (see rfdetr_worker.py). If the venv is missing, RF-DETR runs
fail fast with setup instructions instead of poisoning the main env.
"""

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from .. import telemetry
from ..config import DATA_DIR
from ..orchestrator.context import RunCancelled, RunContext
from ..schemas import (
    Dataset,
    HardwareSummary,
    ModelArtifact,
    ModelMetrics,
    TrainingCurvePoint,
)
from ..store import now_iso, store

BACKEND_DIR = DATA_DIR.parent
WORKER = BACKEND_DIR / "rfdetr_worker.py"
MODELS_DIR = DATA_DIR / "files" / "models"

SETUP_HINT = (
    "RF-DETR runtime not installed. From backend/: "
    "python -m venv .venv-rfdetr && .venv-rfdetr\\Scripts\\pip install "
    "torch torchvision --index-url https://download.pytorch.org/whl/cu126 "
    '&& .venv-rfdetr\\Scripts\\pip install "rfdetr[train]" onnx onnxsim '
    "(see README - Optional: RF-DETR architectures)"
)


def worker_python() -> Path:
    return BACKEND_DIR / ".venv-rfdetr" / "Scripts" / "python.exe"


def available() -> bool:
    return worker_python().exists() and WORKER.exists()


def _run_worker(ctx: RunContext | None, args: list[str],
                on_epoch=None) -> dict:
    """Run the worker, stream tagged lines, return the RESULT payload."""
    if not available():
        raise RuntimeError(SETUP_HINT)
    # utf-8 stdout or pytorch_lightning's rich tables crash cp1252 consoles.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.Popen(
        [str(worker_python()), str(WORKER), *args],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", errors="replace", cwd=str(BACKEND_DIR),
        env=env,
    )
    result: dict | None = None
    # rfdetr 1.8's legacy callback dict is never invoked, so live progress
    # comes from its own per-epoch console tables ("Val (Epoch k/n) …").
    epoch_re = re.compile(r"Epoch (\d+)/\d+")
    seen_epoch = 0
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            if ctx is not None and ctx.cancel_event.is_set():
                proc.kill()
                raise RunCancelled()
            line = line.strip()
            if line.startswith("INFO ") and ctx is not None:
                ctx.log("info", line[5:], agent="mlops")
            elif line.startswith("EPOCH ") and on_epoch is not None:
                on_epoch(json.loads(line[6:]))
            elif line.startswith("RESULT "):
                result = json.loads(line[7:])
            elif on_epoch is not None:
                m = epoch_re.search(line)
                if m and int(m.group(1)) > seen_epoch:
                    seen_epoch = int(m.group(1))
                    on_epoch({"epoch": seen_epoch})
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
    if proc.returncode != 0 or result is None:
        raise RuntimeError(
            f"RF-DETR worker exited with code {proc.returncode} "
            f"({'no result' if result is None else 'partial result'})")
    return result


def train_rfdetr(ctx: RunContext, dataset: Dataset, workdir: Path,
                 on_epoch) -> ModelArtifact:
    run = ctx.run
    progress = run.progress
    arch = run.training.architecture
    epochs = progress.total_epochs
    batch = max(1, min(run.training.batch_size, 2))  # DINOv2 backbone, 8 GB
    out_dir = workdir / "rfdetr_out"

    ctx.set_agent("mlops", "waiting_gpu", f"Starting {arch} worker")
    ctx.log("info", f"Handing off to the isolated RF-DETR runtime — {arch}, "
                    f"{epochs} epochs, batch {batch}", agent="mlops")

    curves: list[TrainingCurvePoint] = []
    started = time.monotonic()

    def handle_epoch(data: dict) -> None:
        epoch = data.get("epoch", len(curves) + 1)
        progress.current_epoch = epoch
        ctx.set_agent("mlops", "working", f"Epoch {epoch}/{epochs}")
        if "box_loss" in data:  # full metrics (tagged EPOCH line)
            point = TrainingCurvePoint(
                epoch=epoch,
                box_loss=data.get("box_loss", 0), cls_loss=0,
                map50=data.get("map50", 0), map5095=0,
                precision=0, recall=0,
            )
            curves.append(point)
            progress.latest_loss = point.box_loss
            ctx.log("info", f"epoch {epoch}/{epochs} — loss "
                            f"{point.box_loss:.3f} mAP50 {point.map50:.3f}",
                    agent="mlops")
        else:  # progress-only (parsed from the worker's console tables)
            ctx.log("info", f"epoch {epoch}/{epochs} complete", agent="mlops")
        ctx.publish_progress()
        on_epoch(epoch)

    result = _run_worker(ctx, [
        "train", "--arch", arch, "--dataset", str(workdir / "rfdetr"),
        "--epochs", str(epochs), "--batch", str(batch),
        "--output", str(out_dir),
    ], on_epoch=handle_epoch)

    model_id = store.next_id("model")
    dest_dir = MODELS_DIR / model_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    weights = dest_dir / f"{model_id}_{arch}.pth"
    shutil.copy2(result["checkpoint"], weights)

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
        task="detect", file_name=weights.name,
        file_size_mb=round(weights.stat().st_size / 1024**2, 1),
        classes=run.target_classes,
        metrics=ModelMetrics(
            map50=last.map50 if last else 0,
            map5095=0,
            precision=0, recall=0,
            epochs_run=len(curves) or epochs,
            training_time_min=round((time.monotonic() - started) / 60, 1),
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
    ctx.log("info", f"Model {model_id} registered — RF-DETR checkpoint "
                    f"{artifact.file_size_mb} MB", agent="mlops")
    return artifact


def predict_rfdetr(artifact: ModelArtifact, image_path: Path) -> dict:
    weights = MODELS_DIR / artifact.id / artifact.file_name
    result = _run_worker(None, [
        "predict", "--arch", artifact.architecture,
        "--weights", str(weights), "--image", str(image_path),
    ])
    from ..schemas import BoundingBox

    return {
        "boxes": [BoundingBox(**b) for b in result["boxes"]],
        "latency_ms": result["latency_ms"],
        "device": f"RF-DETR worker · {telemetry.GPU.name}",
        "width": result["width"],
        "height": result["height"],
    }


def export_rfdetr(artifact: ModelArtifact, fmt: str, base_url: str) -> str:
    if fmt == "pt":
        return f"{base_url}/{artifact.file_name}"
    if fmt != "onnx":
        raise RuntimeError("RF-DETR exports .pt (checkpoint) and ONNX only")
    weights = MODELS_DIR / artifact.id / artifact.file_name
    onnx_path = weights.with_suffix(".onnx")
    if not onnx_path.exists():
        result = _run_worker(None, [
            "export", "--arch", artifact.architecture,
            "--weights", str(weights),
            "--output", str(weights.parent / "onnx_export"),
        ])
        shutil.copy2(result["onnx"], onnx_path)
    return f"{base_url}/{onnx_path.name}"
