"use client";

import { useQuery } from "@tanstack/react-query";
import { ClassDistribution } from "@/components/datasets/class-distribution";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { DatasetAnalytics } from "@/lib/api/types";

const SPLIT_LABELS: Record<string, string> = {
  train: "Train",
  val: "Validation",
  test: "Test",
};

/**
 * Annotation spatial density as a sequential single-hue grid (AMD red,
 * alpha-ramped over the card surface). Values are pre-normalized 0–1.
 */
function Heatmap({ size, cells }: { size: number; cells: number[] }) {
  return (
    <div>
      <div
        className="grid aspect-square w-full gap-px overflow-hidden rounded-md border border-white/10"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        role="img"
        aria-label="Annotation density heatmap: darker red = more label coverage"
      >
        {cells.map((v, i) => (
          <div
            key={i}
            className="min-h-0"
            title={`row ${Math.floor(i / size) + 1}, col ${(i % size) + 1}: ${Math.round(v * 100)}% of peak density`}
            style={{
              backgroundColor: `oklch(0.637 0.237 25.331 / ${(0.04 + v * 0.92).toFixed(3)})`,
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>sparse</span>
        <div
          className="h-1.5 flex-1 rounded-full"
          style={{
            background:
              "linear-gradient(to right, oklch(0.637 0.237 25.331 / 0.04), oklch(0.637 0.237 25.331 / 0.96))",
          }}
        />
        <span>dense</span>
      </div>
    </div>
  );
}

/** Train/val/test share as one proportion bar with direct labels. */
function SplitBar({ splits }: { splits: DatasetAnalytics["splits"] }) {
  const total = splits.reduce((s, x) => s + x.images, 0);
  if (total === 0) {
    return <p className="text-xs text-muted-foreground">No labeled images yet.</p>;
  }
  // Identity is carried by the labels below, not color alone.
  const fills = ["bg-primary/80", "bg-primary/40", "bg-primary/20"];
  return (
    <div className="space-y-2.5">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {splits.map((s, i) => (
          <div
            key={s.split}
            className={fills[i % fills.length]}
            style={{ width: `${(s.images / total) * 100}%` }}
          />
        ))}
      </div>
      <dl className="space-y-1.5 text-sm">
        {splits.map((s, i) => (
          <div key={s.split} className="flex items-center justify-between">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className={`size-2 rounded-full ${fills[i % fills.length]}`} />
              {SPLIT_LABELS[s.split] ?? s.split}
            </dt>
            <dd className="tabular-nums">
              {s.images.toLocaleString()} img · {s.instances.toLocaleString()} boxes
              <span className="ml-1.5 text-xs text-muted-foreground">
                {Math.round((s.images / total) * 100)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DatasetAnalyticsPanel({ datasetId }: { datasetId: string }) {
  const { data } = useQuery({
    queryKey: ["dataset-analytics", datasetId],
    queryFn: () => api<DatasetAnalytics>(endpoints.datasets.analytics(datasetId)),
  });

  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="section-label">Class distribution</h2>
          <p className="text-sm text-muted-foreground">
            Labeled instances per class · {data.boxesPerImage} boxes/image avg
          </p>
        </div>
        <ClassDistribution classes={data.classDistribution} />
      </section>

      <section className="space-y-3 border-t border-border/60 pt-6">
        <div className="space-y-1">
          <h2 className="section-label">Label density</h2>
          <p className="text-sm text-muted-foreground">
            Where annotations sit in the frame · mean box ={" "}
            {(data.meanBoxArea * 100).toFixed(1)}% of image
          </p>
        </div>
        <Heatmap size={data.heatmapSize} cells={data.heatmap} />
      </section>

      <section className="space-y-4 border-t border-border/60 pt-6">
        <h2 className="section-label">Splits & dimensions</h2>
        <SplitBar splits={data.splits} />
        <dl className="space-y-1.5 border-t border-border/50 pt-3 text-sm">
          {data.dimensions.slice(0, 3).map((d) => (
            <div key={`${d.width}x${d.height}`} className="flex justify-between">
              <dt className="font-mono text-xs text-muted-foreground">
                {d.width}×{d.height}
              </dt>
              <dd className="tabular-nums text-xs">
                {d.count.toLocaleString()} images
              </dd>
            </div>
          ))}
          {data.dimensions.length > 3 && (
            <p className="text-xs text-muted-foreground">
              +{data.dimensions.length - 3} more resolutions
            </p>
          )}
        </dl>
      </section>
    </div>
  );
}
