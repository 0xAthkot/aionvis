"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { runStatusVariant } from "@/components/dashboard/recent-runs";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Paginated, PipelineRun } from "@/lib/api/types";
import { SIMPLE_STAGE, SIMPLE_STATUS } from "@/lib/simple-language";
import { useUiModeStore } from "@/lib/stores/ui-mode";

export default function RunsPage() {
  const simple = useUiModeStore((s) => s.mode) === "simple";
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Paginated<PipelineRun>>(endpoints.runs.list()),
  });

  return (
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Runs
            <HelpTip>
              A run is one complete model build — from designing scenes to
              training — carried out by the agent swarm. Open one to watch it
              work.
            </HelpTip>
          </span>
        }
        description={
          simple
            ? "Every model build, in progress and finished."
            : "Every pipeline execution across the organization."
        }
      />

      {data && data.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(
            [
              ["running", "bg-primary"],
              ["queued", "bg-muted-foreground"],
              ["succeeded", "bg-emerald-500"],
              ["failed", "bg-destructive"],
            ] as const
          ).map(([status, dot]) => {
            const count = data.items.filter((r) => r.status === status).length;
            return (
              <span
                key={status}
                className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-muted-foreground"
              >
                <span className={`size-1.5 rounded-full ${dot}`} />
                {count} {simple ? SIMPLE_STATUS[status] : status}
              </span>
            );
          })}
        </div>
      )}

      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.items.length === 0 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed">
          <p className="text-sm text-muted-foreground">
            {simple
              ? "Nothing yet — build your first model."
              : "No runs yet — launch one from the Synthetic Foundry or a dataset."}
          </p>
          <Button asChild>
            <Link href="/foundry">
              <FlaskConical className="size-4" />
              {simple ? "Build a model" : "Launch run"}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm shadow-black/10">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Run</TableHead>
                <TableHead>{simple ? "Source" : "Path"}</TableHead>
                <TableHead>{simple ? "Doing now" : "Stage"}</TableHead>
                <TableHead className="w-44">Progress</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      href={`/runs/${run.id}`}
                      className="font-medium hover:underline"
                    >
                      {run.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {run.path === "synthetic"
                        ? simple
                          ? "Described"
                          : "Synthetic"
                        : simple
                          ? "Uploaded"
                          : "BYOD"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {simple ? (
                      SIMPLE_STAGE[run.stage]
                    ) : (
                      <span className="capitalize">
                        {run.stage.replace(/_/g, " ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={run.progress.pct} className="h-1.5" />
                      <span className="w-9 text-right text-xs text-muted-foreground">
                        {run.progress.pct}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={runStatusVariant[run.status]}>
                      {simple ? SIMPLE_STATUS[run.status] : run.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
