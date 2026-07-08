/**
 * Mock-side computation of DatasetAnalytics from annotated images.
 * Mirrors backend/app/agents/dataset_analytics.py — same grid size, same
 * coverage-weighted heatmap, same max-normalization.
 */
import type {
  AnnotatedImage,
  Dataset,
  DatasetAnalytics,
  DimensionStat,
  SplitStat,
} from "@/lib/api/types";

export const HEATMAP_SIZE = 12;

export function computeAnalytics(
  dataset: Dataset,
  images: AnnotatedImage[],
): DatasetAnalytics {
  const labeled = images.filter((i) => i.curationState !== "rejected");
  const heatmap = new Array<number>(HEATMAP_SIZE * HEATMAP_SIZE).fill(0);
  const classCounts = new Map<number, number>();
  const splitAgg = new Map<string, { images: number; instances: number }>();
  const dims = new Map<string, DimensionStat>();
  let boxCount = 0;
  let areaSum = 0;

  for (const img of labeled) {
    const s = splitAgg.get(img.split) ?? { images: 0, instances: 0 };
    s.images += 1;
    s.instances += img.boxes.length;
    splitAgg.set(img.split, s);

    const key = `${img.width}x${img.height}`;
    const d = dims.get(key) ?? { width: img.width, height: img.height, count: 0 };
    d.count += 1;
    dims.set(key, d);

    for (const b of img.boxes) {
      boxCount += 1;
      areaSum += b.w * b.h;
      classCounts.set(b.classId, (classCounts.get(b.classId) ?? 0) + 1);
      // Coverage-weighted heatmap: each box contributes its overlap
      // fraction to every grid cell it touches.
      const x1 = Math.max(b.cx - b.w / 2, 0);
      const y1 = Math.max(b.cy - b.h / 2, 0);
      const x2 = Math.min(b.cx + b.w / 2, 1);
      const y2 = Math.min(b.cy + b.h / 2, 1);
      const c1 = Math.min(Math.floor(x1 * HEATMAP_SIZE), HEATMAP_SIZE - 1);
      const c2 = Math.min(Math.floor(x2 * HEATMAP_SIZE), HEATMAP_SIZE - 1);
      const r1 = Math.min(Math.floor(y1 * HEATMAP_SIZE), HEATMAP_SIZE - 1);
      const r2 = Math.min(Math.floor(y2 * HEATMAP_SIZE), HEATMAP_SIZE - 1);
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const cellX1 = c / HEATMAP_SIZE;
          const cellY1 = r / HEATMAP_SIZE;
          const ox = Math.max(
            Math.min(x2, cellX1 + 1 / HEATMAP_SIZE) - Math.max(x1, cellX1),
            0,
          );
          const oy = Math.max(
            Math.min(y2, cellY1 + 1 / HEATMAP_SIZE) - Math.max(y1, cellY1),
            0,
          );
          heatmap[r * HEATMAP_SIZE + c] += ox * oy * HEATMAP_SIZE * HEATMAP_SIZE;
        }
      }
    }
  }

  const peak = Math.max(...heatmap, 1e-9);
  const splits: SplitStat[] = (["train", "val", "test"] as const)
    .filter((s) => splitAgg.has(s))
    .map((s) => ({ split: s, ...splitAgg.get(s)! }));

  return {
    datasetId: dataset.id,
    classDistribution: dataset.classes.map((c) => ({
      ...c,
      instanceCount: classCounts.get(c.id) ?? c.instanceCount,
    })),
    splits,
    heatmapSize: HEATMAP_SIZE,
    heatmap: heatmap.map((v) => Math.round((v / peak) * 1000) / 1000),
    dimensions: [...dims.values()].sort((a, b) => b.count - a.count),
    meanBoxArea: boxCount ? Math.round((areaSum / boxCount) * 10000) / 10000 : 0,
    boxesPerImage: labeled.length
      ? Math.round((boxCount / labeled.length) * 100) / 100
      : 0,
  };
}
