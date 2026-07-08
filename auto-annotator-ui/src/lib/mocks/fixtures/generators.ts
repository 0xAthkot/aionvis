/**
 * Runtime fixture generators, used by the pipeline simulator when a run
 * completes and needs a plausible dataset + annotated images to exist.
 */
import type { AnnotatedImage, DatasetClass } from "@/lib/api/types";
import { CLASS_COLORS } from "@/lib/class-colors";
import { placeholderImage } from "./placeholder";

export { CLASS_COLORS };

export function datasetClassesFrom(
  classNames: string[],
  totalInstances: number,
): DatasetClass[] {
  return classNames.map((name, i) => ({
    id: i,
    name,
    color: CLASS_COLORS[i % CLASS_COLORS.length],
    instanceCount: Math.round(
      (totalInstances / classNames.length) * (0.8 + ((i * 7) % 5) * 0.1),
    ),
  }));
}

export function generateAnnotatedImages(
  datasetId: string,
  classNames: string[],
  count = 24,
  seedOffset = 0,
): AnnotatedImage[] {
  const classCount = Math.max(1, classNames.length);
  return Array.from({ length: count }, (_, i) => {
    const seed = seedOffset + i;
    const fileName = `img_${String(i).padStart(4, "0")}.png`;
    const rejected = i % 11 === 10;
    const boxCount = 1 + (seed % 3);
    return {
      id: `${datasetId}_img_${String(i).padStart(4, "0")}`,
      datasetId,
      fileName,
      width: 640,
      height: 480,
      url: placeholderImage(seed, fileName),
      thumbnailUrl: placeholderImage(seed, fileName, 320, 240),
      boxes: Array.from({ length: boxCount }, (_, b) => ({
        classId: (seed + b) % classCount,
        cx: 0.25 + ((seed * 7 + b * 13) % 50) / 100,
        cy: 0.3 + ((seed * 11 + b * 17) % 40) / 100,
        w: 0.12 + ((seed + b) % 4) * 0.04,
        h: 0.1 + ((seed + b) % 3) * 0.05,
        confidence: +(0.82 + ((seed + b) % 15) / 100).toFixed(2),
      })),
      split: i % 5 === 4 ? ("val" as const) : ("train" as const),
      curationState: rejected ? ("rejected" as const) : ("accepted" as const),
      critique: rejected
        ? {
            verdict: "rejected" as const,
            reason: `Mask-box IoU ${(0.4 + (seed % 10) / 100).toFixed(2)} below 0.85 threshold`,
            iou: +(0.4 + (seed % 10) / 100).toFixed(2),
            attempts: 2,
            critic: "Critic Agent (Gemma 4 VLM + geometric checks)",
          }
        : {
            verdict: "accepted" as const,
            iou: +(0.87 + (seed % 12) / 100).toFixed(2),
            attempts: 1,
            critic: "Critic Agent (Gemma 4 VLM + geometric checks)",
          },
    } satisfies AnnotatedImage;
  });
}
