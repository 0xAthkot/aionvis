"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Paginated, PipelineRun } from "@/lib/api/types";

export const runStatusVariant: Record<
  PipelineRun["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  running: "default",
  queued: "secondary",
  paused: "secondary",
  succeeded: "outline",
  failed: "destructive",
  cancelled: "secondary",
};

export function RecentRuns() {
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Paginated<PipelineRun>>(endpoints.runs.list()),
  });

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Latest pipeline activity</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {!data
          ? Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          : data.items.slice(0, 4).map((run) => (
              <div key={run.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{run.name}</p>
                  <Badge variant={runStatusVariant[run.status]}>
                    {run.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={run.progress.pct} className="h-1.5" />
                  <span className="w-9 text-right text-xs text-muted-foreground">
                    {run.progress.pct}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {run.path === "synthetic" ? "Synthetic Foundry" : "BYOD"} ·
                  stage: {run.stage.replace(/_/g, " ")}
                </p>
              </div>
            ))}
      </CardContent>
    </Card>
  );
}
