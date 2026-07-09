"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, Images, Timer, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { DashboardStats } from "@/lib/api/types";
import { useUiModeStore } from "@/lib/stores/ui-mode";

interface Tile {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}

/**
 * Headline numbers as an open editorial strip — no boxes, just a hairline
 * frame and typographic hierarchy.
 */
export function StatCards() {
  const simple = useUiModeStore((s) => s.mode) === "simple";
  const { data } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>(endpoints.dashboard.stats()),
  });

  const tiles: Tile[] | null = data
    ? [
        {
          icon: Activity,
          label: simple ? "Builds in progress" : "Active runs",
          value: String(data.activeRuns),
          hint: simple
            ? `${data.queuedRuns} waiting`
            : `${data.queuedRuns} queued`,
        },
        {
          icon: Boxes,
          label: "Models trained",
          value: String(data.modelsTrained),
          hint: "all time",
        },
        {
          icon: Images,
          label: "Images labeled",
          value: data.imagesLabeled.toLocaleString(),
          hint: simple
            ? `${data.imagesGenerated.toLocaleString()} created by the swarm`
            : `${data.imagesGenerated.toLocaleString()} synthesized`,
        },
        {
          icon: Timer,
          label: simple ? "Compute used" : "GPU hours",
          value: simple
            ? `${data.gpuHoursUsed.toFixed(1)} h`
            : data.gpuHoursUsed.toFixed(1),
          hint: `$${data.creditsRemainingUsd.toFixed(2)} credits left`,
        },
      ]
    : null;

  return (
    <div className="grid grid-cols-2 gap-y-6 border-y border-border/70 lg:grid-cols-4 lg:divide-x lg:divide-border/70">
      {(tiles ?? Array.from({ length: 4 }, () => null)).map((tile, i) => (
        <div
          key={tile?.label ?? i}
          className="space-y-1.5 py-5 pr-4 lg:px-8 lg:first:pl-0"
        >
          {tile ? (
            <>
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <tile.icon className="size-3.5 text-muted-foreground/70" />
                {tile.label}
              </p>
              <p className="text-4xl font-semibold tracking-[-0.02em] tabular-nums">
                {tile.value}
              </p>
              <p className="text-xs text-muted-foreground">{tile.hint}</p>
            </>
          ) : (
            <>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-28" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
