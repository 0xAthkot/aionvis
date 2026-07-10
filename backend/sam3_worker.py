"""SAM 3 worker — runs inside the isolated .venv-sam3 environment.

Meta's SAM 3 lives only in transformers>=5, which breaks the main venv's
pinned SDXL stack (transformers<5). The backend therefore keeps a long-lived
instance of this script running on .venv-sam3's python and streams
annotation requests to it (unlike rfdetr_worker's one-shot CLI, vision
inference is per-image and model load dominates, so the process persists).

Protocol — tagged stdout lines:
  READY <json>           model loaded: {"device": "cuda:0"}
  RESULT <json>          per-request payload (see annotate below)
  ERROR <text>           fatal or per-request failure (bridge raises)
  INFO <text>            human log line
stdin — one JSON object per line:
  {"path": "/abs/img.png", "prompts": ["forklift", ...]}   annotate request
  {"cmd": "exit"}                                          graceful shutdown
Anything else on stdout/stderr is library noise and is ignored by the bridge.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent


def emit(tag: str, payload) -> None:
    if isinstance(payload, str):
        # One line per message — the bridge parses line-by-line, and library
        # exceptions (e.g. transformers' torchvision hint) span lines.
        payload = " ".join(payload.split())
    else:
        payload = json.dumps(payload)
    print(f"{tag} {payload}", flush=True)


def _load_geometry():
    """Import app/agents/geometry.py directly from its file — it is pure
    numpy/scipy, but importing it as a package would execute app/__init__
    (FastAPI, settings) which this venv deliberately lacks."""
    path = BACKEND_DIR / "app" / "agents" / "geometry.py"
    spec = importlib.util.spec_from_file_location("sam3_geometry", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="facebook/sam3")
    p.add_argument("--threshold", type=float, default=0.4)
    args = p.parse_args()

    try:
        import torch
        from PIL import Image
        from transformers import Sam3Model, Sam3Processor

        geometry = _load_geometry()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        emit("INFO", f"loading {args.model} on {device}")
        processor = Sam3Processor.from_pretrained(args.model)
        model = Sam3Model.from_pretrained(
            args.model,
            torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        ).to(device)
        model.eval()
    except Exception as exc:  # gated 403, missing class, OOM — all fatal
        emit("ERROR", f"{type(exc).__name__}: {exc}")
        sys.exit(1)

    emit("READY", {"device": device})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as exc:
            emit("ERROR", f"bad request line: {exc}")
            continue
        if req.get("cmd") == "exit":
            break
        try:
            image = Image.open(req["path"]).convert("RGB")
            w, h = image.size
            detections = []
            for class_id, concept in enumerate(req["prompts"]):
                inputs = processor(images=image, text=concept,
                                   return_tensors="pt").to(device)
                with torch.inference_mode():
                    outputs = model(**inputs)
                parsed = processor.post_process_instance_segmentation(
                    outputs, threshold=args.threshold, mask_threshold=0.5,
                    target_sizes=[(h, w)],
                )[0]
                for mask, score, box in zip(
                    parsed["masks"], parsed["scores"], parsed["boxes"]
                ):
                    poly = geometry.mask_to_polygon(mask.cpu().numpy() > 0)
                    if poly is None or len(poly) < 3:
                        continue
                    x1, y1, x2, y2 = box.tolist()
                    detections.append({
                        "class_id": class_id,
                        "confidence": round(float(score), 4),
                        "box_xyxyn": [x1 / w, y1 / h, x2 / w, y2 / h],
                        "polygon": [[round(float(x), 2), round(float(y), 2)]
                                    for x, y in poly],
                    })
            emit("RESULT", {"width": w, "height": h, "detections": detections})
        except Exception as exc:
            emit("ERROR", f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
