"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { SIMPLE_PATH, SIMPLE_STAGE, SIMPLE_STATUS } from "@/lib/simple-language";
import { useUiModeStore } from "@/lib/stores/ui-mode";

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

function caption(run: PipelineRun, simple: boolean): string {
  if (!simple) {
    return `${run.path === "synthetic" ? "Synthetic Foundry" : "BYOD"} · stage: ${run.stage.replace(/_/g, " ")}`;
  }
  if (run.status === "failed") return "Something went wrong — open to see why";
  return `${SIMPLE_PATH[run.path]} · ${SIMPLE_STAGE[run.stage]}`;
}

export function RecentRuns() {
  const simple = useUiModeStore((s) => s.mode) === "simple";
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Paginated<PipelineRun>>(endpoints.runs.list()),
  });

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Recent runs</CardTitle>
        <CardDescription>
          {simple ? "Your latest model builds" : "Latest pipeline activity"}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {!data
          ? Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          : data.items.slice(0, 4).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="block space-y-2 rounded-lg border p-3 transition-colors hover:border-foreground/20 hover:bg-accent/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{run.name}</p>
                  <Badge variant={runStatusVariant[run.status]}>
                    {simple ? SIMPLE_STATUS[run.status] : run.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={run.progress.pct} className="h-1.5" />
                  <span className="w-9 text-right text-xs text-muted-foreground">
                    {run.progress.pct}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {caption(run, simple)}
                </p>
              </Link>
            ))}
      </CardContent>
    </Card>
  );
}
