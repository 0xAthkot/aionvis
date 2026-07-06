"""Critic Agent — OpenCV geometric verification of the Vision Agent's work.

For every detection it independently re-derives a tight bounding box from
the mask contour (cv2.boundingRect) and compares it to the box the vision
model reported. Low IoU means the box does not actually fit the mask —
the Critic REJECTS it and regenerates the box from the contour instead
(self-correction). Degenerate masks (dust specks, full-frame blobs,
extreme aspect ratios, low confidence) are dropped outright.
"""

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from ..config import settings
from ..orchestrator.context import RunContext
from ..schemas import BoundingBox, CritiqueRecord
from .vision_agent import ImageAnnotation

CRITIC_NAME = "Critic Agent (OpenCV geometric verifier)"


@dataclass
class ReviewedImage:
    path: Path
    width: int
    height: int
    boxes: list[BoundingBox]
    critique: CritiqueRecord
    accepted: bool


def _iou(a: tuple[float, float, float, float],
         b: tuple[float, float, float, float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(ix2 - ix1, 0) * max(iy2 - iy1, 0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _to_yolo(xyxyn: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = (min(max(v, 0.0), 1.0) for v in xyxyn)
    return ((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1)


class CriticAgent:
    def review(self, ctx: RunContext, annotated: list[ImageAnnotation],
               on_progress: Callable[[int], None]) -> list[ReviewedImage]:
        import cv2

        ctx.set_agent("critic", "thinking",
                      f"Verifying geometry of {sum(len(a.detections) for a in annotated)} "
                      "candidate boxes")
        reviewed: list[ReviewedImage] = []
        progress = ctx.run.progress

        for i, ann in enumerate(annotated):
            ctx.check_cancelled()
            boxes: list[BoundingBox] = []
            worst_iou: Optional[float] = None
            regenerated = 0
            dropped = 0

            for det in ann.detections:
                # Independent geometric ground truth from the mask contour.
                x, y, bw, bh = cv2.boundingRect(det.polygon_px.astype("float32"))
                tight = (x / ann.width, y / ann.height,
                         (x + bw) / ann.width, (y + bh) / ann.height)
                area = (tight[2] - tight[0]) * (tight[3] - tight[1])
                aspect = max(bw, 1) / max(bh, 1)
                iou = _iou(det.box_xyxyn, tight)
                worst_iou = iou if worst_iou is None else min(worst_iou, iou)

                if det.confidence < settings.critic_min_confidence:
                    dropped += 1
                    ctx.log("critic",
                            f"REJECT {ann.path.name} class={det.class_id} — "
                            f"confidence {det.confidence:.2f} below "
                            f"{settings.critic_min_confidence:.2f}",
                            agent="critic")
                    continue
                if area < settings.critic_min_box_area or area > 0.98:
                    dropped += 1
                    ctx.log("critic",
                            f"REJECT {ann.path.name} class={det.class_id} — "
                            f"degenerate area {area:.4f}", agent="critic")
                    continue
                if aspect > 20 or aspect < 0.05:
                    dropped += 1
                    ctx.log("critic",
                            f"REJECT {ann.path.name} class={det.class_id} — "
                            f"implausible aspect ratio {aspect:.1f}", agent="critic")
                    continue

                if iou < settings.critic_iou_accept:
                    # Box doesn't fit its own mask — regenerate from contour.
                    regenerated += 1
                    cx, cy, w, h = _to_yolo(tight)
                    ctx.log("critic",
                            f"REJECT {ann.path.name} class={det.class_id} — "
                            f"IoU {iou:.2f} < {settings.critic_iou_accept:.2f}; "
                            "regenerating box from mask contour", agent="critic")
                else:
                    cx, cy, w, h = _to_yolo(det.box_xyxyn)
                    ctx.log("critic",
                            f"ACCEPT {ann.path.name} class={det.class_id} "
                            f"IoU {iou:.2f} conf {det.confidence:.2f}",
                            agent="critic")
                boxes.append(BoundingBox(
                    class_id=det.class_id, cx=round(cx, 4), cy=round(cy, 4),
                    w=round(w, 4), h=round(h, 4),
                    confidence=round(det.confidence, 3),
                ))

            accepted = len(boxes) > 0
            if accepted:
                progress.masks_accepted += len(boxes)
            progress.masks_rejected += dropped + regenerated
            verdict = ("regenerated" if regenerated else "accepted") if accepted else "rejected"
            reason = None
            if not accepted:
                reason = ("No detections survived geometric review"
                          if ann.detections else "Vision Agent found no target instances")
                ctx.log("critic", f"REJECT {ann.path.name} — {reason}", agent="critic")
            elif regenerated:
                reason = f"{regenerated} box(es) re-derived from mask contours"
            reviewed.append(ReviewedImage(
                path=ann.path, width=ann.width, height=ann.height, boxes=boxes,
                critique=CritiqueRecord(
                    verdict=verdict, reason=reason,
                    iou=round(worst_iou, 3) if worst_iou is not None else None,
                    attempts=2 if regenerated else 1, critic=CRITIC_NAME,
                ),
                accepted=accepted,
            ))
            ctx.publish_progress()
            on_progress(i + 1)
            time.sleep(0)  # yield

        kept = sum(r.accepted for r in reviewed)
        ctx.log("info",
                f"Critic review done — {kept}/{len(reviewed)} images usable, "
                f"{progress.masks_accepted} boxes accepted, "
                f"{progress.masks_rejected} rejected/regenerated", agent="critic")
        return reviewed


critic_agent = CriticAgent()
