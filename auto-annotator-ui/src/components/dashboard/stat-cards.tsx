"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { DashboardStats } from "@/lib/api/types";

export function StatCards() {
  const { data } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>(endpoints.dashboard.stats()),
  });

  const tiles = data
    ? ([
        {
          label: "Active runs",
          value: String(data.activeRuns),
          hint: `${data.queuedRuns} queued`,
        },
        {
          label: "Models trained",
          value: String(data.modelsTrained),
          hint: "all time",
        },
        {
          label: "Images labeled",
          value: data.imagesLabeled.toLocaleString(),
          hint: `${data.imagesGenerated.toLocaleString()} synthesized`,
        },
        {
          label: "GPU hours",
          value: data.gpuHoursUsed.toFixed(1),
          hint: `$${data.creditsRemainingUsd.toFixed(2)} credits left`,
        },
      ] as const)
    : null;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles
        ? tiles.map((tile) => (
            <Card key={tile.label}>
              <CardContent className="space-y-1">
                <p className="text-sm text-muted-foreground">{tile.label}</p>
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
