"""Vision Agent — zero-shot, text-prompted instance segmentation.

Two interchangeable backends (settings.vision_backend):
  - "yoloe": Ultralytics YOLOE open-vocabulary segmentation. Prompt-free
    weights, ~100 MB, comfortably fits the 8 GB dev card.
  - "sam3":  Meta SAM 3 concept segmentation via transformers (gated
    checkpoint; the MI300X path).

Both emit, per detection: class id, confidence, the model's own box
(xyxy, normalized) and the mask contour polygon in pixel space — the
Critic re-derives a tight box from that polygon and compares.
"""

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from .. import telemetry
from ..config import settings
from ..orchestrator.context import RunContext
from ..schemas import Throughput
from .gpu import device_str, flush_vram


# KEEP_MODELS_WARM=true: the loaded backend stays resident across runs.
_warm_models: dict[str, object] = {}


@dataclass
class Detection:
    class_id: int
    confidence: float
    box_xyxyn: tuple[float, float, float, float]  # model box, normalized
    polygon_px: np.ndarray  # (N, 2) mask contour, pixel coords


@dataclass
class ImageAnnotation:
    path: Path
    width: int
    height: int
    detections: list[Detection] = field(default_factory=list)


class VisionSession:
    """A loaded vision backend with per-image annotation.

    Both pipeline modes drive this: sequential loops annotate_one over the
    finished image list; streaming calls it per image as synthesis hands
    them over. close() releases the model (a no-op under keep-warm).
    """

    def __init__(self, annotate_one: Callable[[Path], ImageAnnotation],
                 teardown: Callable[[], None]) -> None:
        self._annotate_one = annotate_one
        self._teardown = teardown

    def annotate_one(self, path: Path) -> ImageAnnotation:
        return self._annotate_one(path)

    def close(self) -> None:
        self._teardown()


class VisionAgent:
    def describe(self) -> str:
        return ("SAM 3 concept segmentation" if settings.vision_backend == "sam3"
                else f"YOLOE open-vocab segmentation ({settings.yoloe_model})")

    def start(self, ctx: RunContext, target_classes: list[str]) -> VisionSession:
        """Load the configured backend, primed with this run's concepts."""
        prompts = [c.replace("_", " ") for c in target_classes]
        if settings.vision_backend == "sam3":
            try:
                annotate_one, teardown = self._load_sam3(ctx, prompts)
            except Exception as exc:
                # Promised fallback: SAM 3 needs transformers 5 (which the
                # pinned SDXL stack forbids) and a gated checkpoint — any
                # load failure degrades to YOLOE instead of killing the run.
                ctx.log("warn",
                        f"SAM 3 unavailable — falling back to YOLOE "
                        f"({settings.yoloe_model}). Reason: {exc}",
                        agent="vision")
                annotate_one, teardown = self._load_yoloe(ctx, prompts)
        else:
            annotate_one, teardown = self._load_yoloe(ctx, prompts)
        return VisionSession(annotate_one, teardown)

    def annotate(self, ctx: RunContext, image_paths: list[Path],
                 target_classes: list[str],
                 on_progress: Callable[[int], None]) -> list[ImageAnnotation]:
        ctx.set_agent("vision", "waiting_gpu", f"Loading {self.describe()}")
        flush_vram(ctx)
        session = self.start(ctx, target_classes)

        ctx.set_agent("vision", "working",
                      f"Segmenting {len(image_paths)} images, "
                      f"{len(target_classes)} target concepts")
        results: list[ImageAnnotation] = []
        started = time.monotonic()
        try:
            for i, path in enumerate(image_paths):
                ctx.check_cancelled()
                ann = session.annotate_one(path)
                results.append(ann)
                rate = (i + 1) / (time.monotonic() - started)
                telemetry.throughput = Throughput(kind="img_per_s", value=round(rate, 2))
                ctx.log("info",
                        f"[{i + 1}/{len(image_paths)}] {path.name}: "
                        f"{len(ann.detections)} candidate masks",
                        agent="vision")
                on_progress(i + 1)
        finally:
            session.close()
            telemetry.throughput = None
        total = sum(len(r.detections) for r in results)
        ctx.log("info", f"Segmentation done — {total} candidate instances "
                        f"across {len(results)} images", agent="vision")
        flush_vram(ctx)
        return results

    # --- YOLOE backend ------------------------------------------------------------

    def _load_yoloe(self, ctx: RunContext, prompts: list[str]):
        from ultralytics import YOLOE

        device = device_str()
        cache_key = f"yoloe:{settings.yoloe_model}"
        if settings.keep_models_warm and cache_key in _warm_models:
            model = _warm_models[cache_key]
            ctx.log("info", "Reusing warm YOLOE model", agent="vision")
        else:
            model = YOLOE(settings.yoloe_model)
            if settings.keep_models_warm:
                _warm_models.clear()  # one warm vision backend at a time
                _warm_models[cache_key] = model
        # Class embeddings are per-run even on a warm model.
        model.set_classes(prompts, model.get_text_pe(prompts))
        ctx.log("info", f"YOLOE loaded on {device}; open-vocab classes: "
                        f"{', '.join(prompts)}", agent="vision")

        def annotate_one(path: Path) -> ImageAnnotation:
            res = model.predict(source=str(path), conf=settings.vision_min_confidence,
                                device=device, verbose=False)[0]
            h, w = res.orig_shape
            ann = ImageAnnotation(path=path, width=int(w), height=int(h))
            if res.boxes is None or len(res.boxes) == 0:
                return ann
            polygons = res.masks.xy if res.masks is not None else [None] * len(res.boxes)
            for box, poly in zip(res.boxes, polygons):
                xyxyn = box.xyxyn[0].tolist()
                if poly is None or len(poly) < 3:
                    # No mask — synthesize the contour from the box itself.
                    x1, y1, x2, y2 = (xyxyn[0] * w, xyxyn[1] * h,
                                      xyxyn[2] * w, xyxyn[3] * h)
                    poly = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
                ann.detections.append(Detection(
                    class_id=int(box.cls.item()),
                    confidence=float(box.conf.item()),
                    box_xyxyn=tuple(xyxyn),
                    polygon_px=np.asarray(poly, dtype=np.float32),
                ))
            return ann

        def teardown() -> None:
            nonlocal model
            if not settings.keep_models_warm:
                del model

        return annotate_one, teardown

    # --- SAM 3 backend --------------------------------------------------------------

    def _load_sam3(self, ctx: RunContext, prompts: list[str]):
        import torch
        from PIL import Image

        from .geometry import mask_to_polygon

        try:
            from transformers import Sam3Model, Sam3Processor
        except ImportError as exc:
            raise RuntimeError(
                "transformers build lacks SAM 3 — set VISION_BACKEND=yoloe "
                "or upgrade transformers"
            ) from exc

        device = device_str()
        cache_key = f"sam3:{settings.sam3_model}"
        if settings.keep_models_warm and cache_key in _warm_models:
            processor, model = _warm_models[cache_key]
            ctx.log("info", "Reusing warm SAM 3 model", agent="vision")
        else:
            processor = Sam3Processor.from_pretrained(settings.sam3_model)
            model = Sam3Model.from_pretrained(
                settings.sam3_model,
                torch_dtype=torch.float16 if device != "cpu" else torch.float32,
            ).to(device)
            if settings.keep_models_warm:
                _warm_models.clear()  # one warm vision backend at a time
                _warm_models[cache_key] = (processor, model)
        ctx.log("info", f"SAM 3 loaded on {device} ({settings.sam3_model})",
                agent="vision")

        def annotate_one(path: Path) -> ImageAnnotation:
            image = Image.open(path).convert("RGB")
            w, h = image.size
            ann = ImageAnnotation(path=path, width=w, height=h)
            for class_id, concept in enumerate(prompts):
                inputs = processor(images=image, text=concept,
                                   return_tensors="pt").to(device)
                with torch.inference_mode():
                    outputs = model(**inputs)
                parsed = processor.post_process_instance_segmentation(
                    outputs, threshold=0.4, mask_threshold=0.5,
                    target_sizes=[(h, w)],
                )[0]
                for mask, score, box in zip(
                    parsed["masks"], parsed["scores"], parsed["boxes"]
                ):
                    # Largest-blob outer boundary, traced in pure numpy.
                    poly = mask_to_polygon(mask.cpu().numpy() > 0)
                    if poly is None or len(poly) < 3:
                        continue
                    x1, y1, x2, y2 = box.tolist()
                    ann.detections.append(Detection(
                        class_id=class_id,
                        confidence=float(score),
                        box_xyxyn=(x1 / w, y1 / h, x2 / w, y2 / h),
                        polygon_px=poly,
                    ))
            return ann

        def teardown() -> None:
            nonlocal model, processor
            if not settings.keep_models_warm:
                del model, processor

        return annotate_one, teardown


vision_agent = VisionAgent()
