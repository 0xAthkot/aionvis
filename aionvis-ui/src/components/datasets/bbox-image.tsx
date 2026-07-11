"use client";

import type { AnnotatedImage, DatasetClass } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Image with YOLO-normalized bounding boxes drawn as positioned overlays.
 * Box color follows the dataset class (same colors as the distribution
 * chart), so identity is consistent across the whole screen. Labels that
 * carry a mask contour (segment/OBB — `BoundingBox.polygon`) render the
 * actual outline instead of an axis-aligned rectangle.
 */
export function BBoxImage({
  image,
  classes,
  showLabels = false,
  className,
}: {
  image: AnnotatedImage;
  classes: DatasetClass[];
  showLabels?: boolean;
  className?: string;
}) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const polygons = image.boxes.filter(
    (b) => (b.polygon?.length ?? 0) >= 6,
  );

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
      {polygons.length > 0 && (
        <svg
          aria-hidden
          className="absolute inset-0 size-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          {polygons.map((box, i) => {
            const color =
              classById.get(box.classId)?.color ?? "#898781";
            const pts: string[] = [];
            for (let p = 0; p + 1 < box.polygon!.length; p += 2) {
              pts.push(`${box.polygon![p]},${box.polygon![p + 1]}`);
            }
            return (
              <polygon
                key={i}
                points={pts.join(" ")}
                fill={color}
                fillOpacity={0.15}
                stroke={color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
      )}
      {image.boxes.map((box, i) => {
        const cls = classById.get(box.classId);
        const color = cls?.color ?? "#898781";
        const hasPolygon = (box.polygon?.length ?? 0) >= 6;
        return (
          <div
            key={i}
            // The div stays for label anchoring; the outline itself comes
            // from the SVG when a mask contour exists.
            className={cn("absolute", !hasPolygon && "border-2")}
            style={{
              left: `${(box.cx - box.w / 2) * 100}%`,
              top: `${(box.cy - box.h / 2) * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              borderColor: color,
            }}
          >
            {showLabels && (
              <span
                className="absolute -top-5 left-0 whitespace-nowrap rounded-sm px-1 font-mono text-[10px] leading-4 text-white"
                style={{ backgroundColor: color }}
              >
                {cls?.name ?? `class ${box.classId}`}
                {box.confidence !== undefined && ` ${box.confidence.toFixed(2)}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
