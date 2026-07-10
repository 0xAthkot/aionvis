"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RunStatusChip } from "@/components/shared/status-chip";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Paginated, PipelineRun } from "@/lib/api/types";
import { SIMPLE_PATH, SIMPLE_STAGE } from "@/lib/simple-language";
import { useUiModeStore } from "@/lib/stores/ui-mode";

function caption(run: PipelineRun, simple: boolean): string {
  if (!simple) {
    return `${run.path === "synthetic" ? "Synthetic Foundry" : "BYOD"} · stage: ${run.stage.replace(/_/g, " ")}`;
  }
  if (run.status === "failed") return "Something went wrong — open to see why";
  return `${SIMPLE_PATH[run.path]} · ${SIMPLE_STAGE[run.stage]}`;
}

/** Open list (no card chrome): hairline-divided rows directly on the page. */
export function RecentRuns() {
  const simple = useUiModeStore((s) => s.mode) === "simple";
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Paginated<PipelineRun>>(endpoints.runs.list()),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="section-label">Recent runs</h2>
          <p className="text-sm text-muted-foreground">
            {simple ? "Your latest model builds" : "Latest pipeline activity"}
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/runs">
            View all <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
      <div className="divide-y divide-border/60">
        {!data
          ? Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="my-3 h-14 w-full" />
            ))
          : data.items.slice(0, 4).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="-mx-2 block space-y-2 rounded-lg px-2 py-3.5 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{run.name}</p>
                  <RunStatusChip status={run.status} simple={simple} />
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={run.progress.pct}
                    className="progress-glow h-1.5"
                  />
                  <span className="w-9 text-right text-xs text-muted-foreground">
                    {run.progress.pct}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {caption(run, simple)}
                </p>
              </Link>
            ))}
      </div>
    </section>
  );
}
