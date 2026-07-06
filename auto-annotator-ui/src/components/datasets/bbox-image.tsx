"use client";

import type { AnnotatedImage, DatasetClass } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Image with YOLO-normalized bounding boxes drawn as positioned overlays.
 * Box color follows the dataset class (same colors as the distribution
 * chart), so identity is consistent across the whole screen.
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
      {image.boxes.map((box, i) => {
        const cls = classById.get(box.classId);
        const color = cls?.color ?? "#898781";
        return (
          <div
            key={i}
            className="absolute border-2"
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
