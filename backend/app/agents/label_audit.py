"""Label Audit — the Critic's treatment for IMPORTED annotations.

When a BYOD archive shipped its own YOLO/COCO labels (byod.py wrote them to
labels.json), a run doesn't label from scratch — it audits what the customer
provided, with the same standards the Critic applies to the Vision Agent:

  geometric sanity  — bounds clamped to the frame, degenerate areas and
                      implausible aspect ratios rejected, near-duplicate
                      boxes of the same class deduplicated
  semantic check    — the shared VLM spot-check runs on the survivors
                      (semantic_critic.py, unchanged)

Output is the same ReviewedImage list the Vision Agent + Critic pair
produces, so dataset compilation and training are oblivious to the source.
"""

import json
from pathlib import Path
from typing import Callable

from PIL import Image

from ..config import DATA_DIR, settings
from ..orchestrator.context import RunContext
from ..schemas import BoundingBox, CritiqueRecord, Dataset
from .critic_agent import ReviewedImage

AUDIT_CRITIC_NAME = "Label Audit (imported annotations · geometric checks)"


def _iou(a: BoundingBox, b: BoundingBox) -> float:
    ax1, ay1, ax2, ay2 = a.cx - a.w / 2, a.cy - a.h / 2, a.cx + a.w / 2, a.cy + a.h / 2
    bx1, by1, bx2, by2 = b.cx - b.w / 2, b.cy - b.h / 2, b.cx + b.w / 2, b.cy + b.h / 2
    ix = max(min(ax2, bx2) - max(ax1, bx1), 0)
    iy = max(min(ay2, by2) - max(ay1, by1), 0)
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def load_manifest(dataset: Dataset) -> dict:
    path = DATA_DIR / "byod" / dataset.id / "labels.json"
    if not path.exists():
        raise RuntimeError(
            f"Dataset {dataset.id} is marked as label-imported but "
            "labels.json is missing — re-upload the archive."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def audit_labels(ctx: RunContext, dataset: Dataset, image_paths: list[Path],
                 on_progress: Callable[[int], None]) -> list[ReviewedImage]:
    manifest = load_manifest(dataset)
    per_image: dict[str, list[dict]] = manifest.get("images", {})
    n_classes = len(manifest.get("classNames", []))
    progress = ctx.run.progress

    total_boxes = sum(len(v) for v in per_image.values())
    ctx.set_agent("critic", "thinking",
                  f"Auditing {total_boxes} imported boxes across "
                  f"{len(per_image)} labeled images")
    ctx.log("info",
            f"Audit mode: {total_boxes} provided {manifest.get('format', '?').upper()} "
            f"labels on {len(per_image)} of {len(image_paths)} images — "
            "verifying instead of relabeling", agent="critic")

    reviewed: list[ReviewedImage] = []
    for i, path in enumerate(image_paths):
        ctx.check_cancelled()
        with Image.open(path) as im:
            width, height = im.size
        raw = per_image.get(path.name, [])
        boxes: list[BoundingBox] = []
        dropped = 0
        clamped = 0

        for entry in raw:
            cls = int(entry.get("classId", -1))
            if cls < 0 or (n_classes and cls >= n_classes):
                dropped += 1
                ctx.log("critic", f"AUDIT REJECT {path.name} — class id {cls} "
                                  "outside the imported class list", agent="critic")
                continue
            cx, cy = float(entry["cx"]), float(entry["cy"])
            w, h = float(entry["w"]), float(entry["h"])
            # Clamp to the frame; count it as a correction when meaningful.
            x1, y1 = max(cx - w / 2, 0.0), max(cy - h / 2, 0.0)
            x2, y2 = min(cx + w / 2, 1.0), min(cy + h / 2, 1.0)
            if x2 - x1 < w - 1e-3 or y2 - y1 < h - 1e-3:
                clamped += 1
            cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
            area = w * h
            if area < settings.critic_min_box_area or area > 0.98:
                dropped += 1
                ctx.log("critic", f"AUDIT REJECT {path.name} class={cls} — "
                                  f"degenerate area {area:.4f}", agent="critic")
                continue
            aspect = (w * width) / max(h * height, 1e-6)
            if aspect > 20 or aspect < 0.05:
                dropped += 1
                ctx.log("critic", f"AUDIT REJECT {path.name} class={cls} — "
                                  f"implausible aspect ratio {aspect:.1f}",
                        agent="critic")
                continue
            candidate = BoundingBox(
                class_id=cls, cx=round(cx, 4), cy=round(cy, 4),
                w=round(w, 4), h=round(h, 4), confidence=1.0,
                polygon=entry.get("polygon"),
            )
            # Near-duplicate of an already-accepted same-class box.
            if any(b.class_id == cls and _iou(b, candidate) > 0.95 for b in boxes):
                dropped += 1
                ctx.log("critic", f"AUDIT REJECT {path.name} class={cls} — "
                                  "duplicate annotation (IoU > 0.95)", agent="critic")
                continue
            boxes.append(candidate)

        accepted = len(boxes) > 0
        progress.masks_accepted += len(boxes)
        progress.masks_rejected += dropped
        if accepted:
            reason = None
            if dropped or clamped:
                bits = []
                if dropped:
                    bits.append(f"{dropped} box(es) rejected")
                if clamped:
                    bits.append(f"{clamped} clamped to the frame")
                reason = "; ".join(bits)
            verdict = "regenerated" if clamped else "accepted"
        else:
            verdict = "rejected"
            reason = ("Every provided box failed the audit" if raw
                      else "No provided labels for this image")
            if raw:
                ctx.log("critic", f"AUDIT REJECT {path.name} — {reason}",
                        agent="critic")
        reviewed.append(ReviewedImage(
            path=path, width=width, height=height, boxes=boxes,
            critique=CritiqueRecord(
                verdict=verdict, reason=reason, iou=None,
                attempts=1, critic=AUDIT_CRITIC_NAME,
            ),
            accepted=accepted,
        ))
        ctx.publish_progress()
        on_progress(i + 1)

    kept = sum(r.accepted for r in reviewed)
    ctx.log("info",
            f"Label audit done — {kept}/{len(reviewed)} images usable, "
            f"{progress.masks_accepted} boxes accepted, "
            f"{progress.masks_rejected} rejected", agent="critic")
    return reviewed
