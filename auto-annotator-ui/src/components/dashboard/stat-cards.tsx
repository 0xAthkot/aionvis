"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, Images, Timer, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles
        ? tiles.map((tile) => (
            <Card key={tile.label}>
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">{tile.label}</p>
                  <tile.icon className="size-4 text-muted-foreground/60" />
                </div>
                <p className="text-2xl font-semibold tracking-tight">
                  {tile.value}
                </p>
                <p className="text-xs text-muted-foreground">{tile.hint}</p>
              </CardContent>
            </Card>
          ))
        : Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-7 w-14" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
    </div>
  );
}
