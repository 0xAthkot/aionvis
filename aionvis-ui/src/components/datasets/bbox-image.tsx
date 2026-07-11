"use client";

import type {
  AnnotatedImage,
  BoundingBox,
  DatasetClass,
  TrainingTask,
} from "@/lib/api/types";
import { minAreaRect } from "@/lib/geometry";
import { cn } from "@/lib/utils";

/** How to draw the labels on one image:
 *  - "sam": the raw labeler output — mask contours (rectangle fallback).
 *  - "model": what the run's trained model will produce, derived per task:
 *    detect → boxes, obb → min-area rotated boxes, pose → boxes+skeletons,
 *    classify → class labels only, segment → the contours themselves. */
export type BBoxView = "sam" | "model";

// COCO-17 skeleton edges (0-indexed keypoint pairs).
const COCO_EDGES: [number, number][] = [
  [15, 13], [13, 11], [16, 14], [14, 12], [11, 12], [5, 11], [6, 12],
  [5, 6], [5, 7], [6, 8], [7, 9], [8, 10], [1, 2], [0, 1], [0, 2],
  [1, 3], [2, 4], [3, 5], [4, 6],
];

function polygonPoints(flat: number[]): string {
  const pts: string[] = [];
  for (let p = 0; p + 1 < flat.length; p += 2)
    pts.push(`${flat[p]},${flat[p + 1]}`);
  return pts.join(" ");
}

export function Skeleton17({ flat, color }: { flat: number[]; color: string }) {
  const kp = (i: number): [number, number, number] => [
    flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2],
  ];
  const n = Math.floor(flat.length / 3);
  return (
    <g>
      {COCO_EDGES.map(([a, b], i) => {
        if (a >= n || b >= n) return null;
        const [ax, ay, av] = kp(a);
        const [bx, by, bv] = kp(b);
        if (av <= 0 || bv <= 0) return null;
        return (
          <line
            key={i}
            x1={ax} y1={ay} x2={bx} y2={by}
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
        );
      })}
      {Array.from({ length: n }, (_, i) => {
        const [x, y, v] = kp(i);
        if (v <= 0) return null;
        // Zero-ish-length round-cap line = screen-size dot in a distorted
        // normalized viewBox (circles would stretch with the aspect).
        return (
          <line
            key={`p${i}`}
            x1={x} y1={y} x2={x + 0.0001} y2={y}
            stroke="#ffffff"
            strokeWidth={5}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

/**
 * Image with its labels drawn as overlays. Colors follow the dataset class
 * (same palette as the distribution chart). Default view shows the raw
 * SAM 3 mask contours; `view="model"` shows the representation the run's
 * trained model will actually produce (see BBoxView).
 */
export function BBoxImage({
  image,
  classes,
  showLabels = false,
  className,
  view = "sam",
  task = "detect",
}: {
  image: AnnotatedImage;
  classes: DatasetClass[];
  showLabels?: boolean;
  className?: string;
  view?: BBoxView;
  task?: TrainingTask;
}) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const aspect = image.height > 0 ? image.width / image.height : 1;
  const labelsOnly = view === "model" && task === "classify";

  /** Outline to draw for one box under the active view, or null. */
  function outline(box: BoundingBox): number[] | null {
    const poly =
      (box.polygon?.length ?? 0) >= 6 ? (box.polygon as number[]) : null;
    if (labelsOnly) return null;
    if (view === "model") {
      if (task === "segment") return poly;
      if (task === "obb") return poly ? minAreaRect(poly, aspect) : null;
      return null; // detect & pose draw plain rectangles
    }
    return poly; // raw SAM view
  }

  const shapes = image.boxes
    .map((box, i) => ({ box, i, poly: outline(box) }))
    .filter((s) => s.poly || (view === "model" && task === "pose" && s.box.keypoints));

  return (
    <div className={cn("relative overflow-hidden rounded-md", className)}>
      {/* Mock images are SVG data URIs; next/image adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.fileName}
        width={image.width}
        height={image.height}
        className="block h-auto w-full"
      />
      {shapes.length > 0 && (
        <svg
          aria-hidden
          className="absolute inset-0 size-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          {shapes.map(({ box, i, poly }) => {
            const color = classById.get(box.classId)?.color ?? "#898781";
            return (
              <g key={i}>
                {poly && (
                  <polygon
                    points={polygonPoints(poly)}
                    fill={color}
                    fillOpacity={0.15}
                    stroke={color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                )}
                {view === "model" && task === "pose" && box.keypoints && (
                  <Skeleton17 flat={box.keypoints} color={color} />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {image.boxes.map((box, i) => {
        const cls = classById.get(box.classId);
        const color = cls?.color ?? "#898781";
        const hasOutline = outline(box) !== null;
        return (
          <div
            key={i}
            // The div anchors the label chip; the border is the plain
            // rectangle, dropped when an outline/labels-only view covers it.
            className={cn(
              "absolute",
              !hasOutline && !labelsOnly && "border-2",
            )}
            style={{
              left: `${(box.cx - box.w / 2) * 100}%`,
              top: `${(box.cy - box.h / 2) * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              borderColor: color,
            }}
          >
            {(showLabels || labelsOnly) && (
              <span
                className="absolute -top-5 left-0 whitespace-nowrap rounded-sm px-1 font-mono text-[10px] leading-4 text-white"
                style={{ backgroundColor: color }}
              >
                {cls?.name ?? `class ${box.classId}`}
                {box.confidence !== undefined && !labelsOnly &&
                  ` ${box.confidence.toFixed(2)}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
