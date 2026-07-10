"""Dataset analytics: aggregate label statistics from the annotated images.

Mirrors aionvis-ui/src/lib/mocks/analytics.ts — same grid size, same
coverage-weighted heatmap, same max-normalization — so mock mode and the
real backend render identical charts for identical data.
"""

from ..schemas import (
    AnnotatedImage,
    Dataset,
    DatasetAnalytics,
    DimensionStat,
    SplitStat,
)

HEATMAP_SIZE = 12


def compute_analytics(dataset: Dataset,
                      images: list[AnnotatedImage]) -> DatasetAnalytics:
    labeled = [i for i in images if i.curation_state != "rejected"]
    heatmap = [0.0] * (HEATMAP_SIZE * HEATMAP_SIZE)
    class_counts: dict[int, int] = {}
    split_agg: dict[str, list[int]] = {}  # split -> [images, instances]
    dims: dict[tuple[int, int], int] = {}
    box_count = 0
    area_sum = 0.0

    for img in labeled:
        agg = split_agg.setdefault(img.split, [0, 0])
        agg[0] += 1
        agg[1] += len(img.boxes)
        dims[(img.width, img.height)] = dims.get((img.width, img.height), 0) + 1

        for b in img.boxes:
            box_count += 1
            area_sum += b.w * b.h
            class_counts[b.class_id] = class_counts.get(b.class_id, 0) + 1
            # Coverage-weighted heatmap: each box contributes its overlap
            # fraction to every grid cell it touches.
            x1, y1 = max(b.cx - b.w / 2, 0.0), max(b.cy - b.h / 2, 0.0)
            x2, y2 = min(b.cx + b.w / 2, 1.0), min(b.cy + b.h / 2, 1.0)
            c1 = min(int(x1 * HEATMAP_SIZE), HEATMAP_SIZE - 1)
            c2 = min(int(x2 * HEATMAP_SIZE), HEATMAP_SIZE - 1)
            r1 = min(int(y1 * HEATMAP_SIZE), HEATMAP_SIZE - 1)
            r2 = min(int(y2 * HEATMAP_SIZE), HEATMAP_SIZE - 1)
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    cell_x1, cell_y1 = c / HEATMAP_SIZE, r / HEATMAP_SIZE
                    ox = max(min(x2, cell_x1 + 1 / HEATMAP_SIZE) - max(x1, cell_x1), 0.0)
                    oy = max(min(y2, cell_y1 + 1 / HEATMAP_SIZE) - max(y1, cell_y1), 0.0)
                    heatmap[r * HEATMAP_SIZE + c] += ox * oy * HEATMAP_SIZE ** 2

    peak = max(max(heatmap), 1e-9)
    return DatasetAnalytics(
        dataset_id=dataset.id,
        class_distribution=[
            c.model_copy(update={
                "instance_count": class_counts.get(c.id, c.instance_count),
            })
            for c in dataset.classes
        ],
        splits=[
            SplitStat(split=s, images=split_agg[s][0], instances=split_agg[s][1])
            for s in ("train", "val", "test") if s in split_agg
        ],
        heatmap_size=HEATMAP_SIZE,
        heatmap=[round(v / peak, 3) for v in heatmap],
        dimensions=[
            DimensionStat(width=w, height=h, count=n)
            for (w, h), n in sorted(dims.items(), key=lambda kv: -kv[1])
        ],
        mean_box_area=round(area_sum / box_count, 4) if box_count else 0.0,
        boxes_per_image=round(box_count / len(labeled), 2) if labeled else 0.0,
    )
