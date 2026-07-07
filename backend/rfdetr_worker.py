"""RF-DETR worker — runs inside the isolated .venv-rfdetr environment.

Roboflow's rfdetr package requires transformers>=5, which breaks the main
venv's pinned SDXL stack (transformers<5). The backend therefore shells out
to this script with .venv-rfdetr's python for RF-DETR train/predict/export.

Protocol: JSON args on the command line, progress as tagged stdout lines —
  INFO <text>            human log line
  EPOCH <json>           per-epoch metrics {epoch, box_loss, map50, ...}
  RESULT <json>          final payload (checkpoint/onnx path, metrics)
Anything else on stdout/stderr is noise from the library and is ignored.
"""

import argparse
import json
import sys
import time
from pathlib import Path

ARCHS = {}


def _load_archs():
    import rfdetr

    for name, cls_name in [
        ("rf-detr-nano", "RFDETRNano"),
        ("rf-detr-small", "RFDETRSmall"),
        ("rf-detr-medium", "RFDETRMedium"),
        ("rf-detr-base", "RFDETRBase"),
        ("rf-detr-large", "RFDETRLarge"),
    ]:
        cls = getattr(rfdetr, cls_name, None)
        if cls is not None:
            ARCHS[name] = cls


def emit(tag: str, payload) -> None:
    line = f"{tag} {json.dumps(payload) if not isinstance(payload, str) else payload}"
    print(line, flush=True)


def cmd_train(args) -> None:
    _load_archs()
    model = ARCHS[args.arch]()
    emit("INFO", f"{args.arch} loaded, training {args.epochs} epochs "
                 f"batch {args.batch}")
    started = time.monotonic()

    # model.callbacks is a defaultdict(list) keyed by event name; the handler
    # receives the epoch's log_stats dict (coco_eval_bbox = 12 COCO stats,
    # index 1 is AP50).
    def on_epoch_end(data: dict) -> None:
        def ap50(key: str):
            v = data.get(key)
            return float(v[1]) if isinstance(v, (list, tuple)) and len(v) > 1 else None

        map50 = ap50("ema_test_coco_eval_bbox") or ap50("test_coco_eval_bbox") or 0.0
        emit("EPOCH", {
            "epoch": int(data.get("epoch", -1)) + 1,
            "box_loss": round(float(data.get("train_loss", 0)), 4),
            "map50": round(map50, 4),
        })

    try:
        model.callbacks["on_fit_epoch_end"].append(on_epoch_end)
    except Exception as exc:
        emit("INFO", f"per-epoch callback unavailable ({exc}); "
                     "progress will be coarse")

    model.train(
        dataset_dir=args.dataset,
        epochs=args.epochs,
        batch_size=args.batch,
        grad_accum_steps=max(1, 8 // max(args.batch, 1)),
        output_dir=args.output,
        num_workers=0,
        tensorboard=False,
        wandb=False,
    )
    out = Path(args.output)
    best = out / "checkpoint_best_total.pth"
    if not best.exists():
        candidates = sorted(out.glob("checkpoint*.pth"))
        if not candidates:
            raise RuntimeError(f"no checkpoint produced in {out}")
        best = candidates[-1]
    results = out / "results.json"
    metrics = {}
    if results.exists():
        metrics = json.loads(results.read_text())
    emit("RESULT", {
        "checkpoint": str(best),
        "metrics": metrics,
        "train_seconds": round(time.monotonic() - started, 1),
    })


def cmd_predict(args) -> None:
    _load_archs()
    from PIL import Image

    model = ARCHS[args.arch](pretrain_weights=args.weights)
    with Image.open(args.image) as im:
        im = im.convert("RGB")
        w, h = im.size
        started = time.monotonic()
        det = model.predict(im, threshold=args.conf)
        latency_ms = (time.monotonic() - started) * 1000
    boxes = []
    for (x1, y1, x2, y2), conf, cls in zip(
        det.xyxy.tolist(), det.confidence.tolist(), det.class_id.tolist()
    ):
        boxes.append({
            # categories are written 1-based at compile time
            "class_id": max(int(cls) - 1, 0),
            "cx": round((x1 + x2) / 2 / w, 4), "cy": round((y1 + y2) / 2 / h, 4),
            "w": round((x2 - x1) / w, 4), "h": round((y2 - y1) / h, 4),
            "confidence": round(float(conf), 3),
        })
    emit("RESULT", {"boxes": boxes[:50], "latency_ms": round(latency_ms, 1),
                    "width": w, "height": h})


def cmd_export(args) -> None:
    _load_archs()
    model = ARCHS[args.arch](pretrain_weights=args.weights)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    model.export(output_dir=str(out_dir))
    onnx = next(out_dir.glob("*.onnx"), None)
    if onnx is None:
        raise RuntimeError(f"export produced no onnx in {out_dir}")
    emit("RESULT", {"onnx": str(onnx)})


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("train")
    t.add_argument("--arch", required=True)
    t.add_argument("--dataset", required=True)
    t.add_argument("--epochs", type=int, required=True)
    t.add_argument("--batch", type=int, default=2)
    t.add_argument("--output", required=True)

    pr = sub.add_parser("predict")
    pr.add_argument("--arch", required=True)
    pr.add_argument("--weights", required=True)
    pr.add_argument("--image", required=True)
    pr.add_argument("--conf", type=float, default=0.4)

    e = sub.add_parser("export")
    e.add_argument("--arch", required=True)
    e.add_argument("--weights", required=True)
    e.add_argument("--output", required=True)

    args = p.parse_args()
    {"train": cmd_train, "predict": cmd_predict, "export": cmd_export}[args.cmd](args)


if __name__ == "__main__":
    main()
