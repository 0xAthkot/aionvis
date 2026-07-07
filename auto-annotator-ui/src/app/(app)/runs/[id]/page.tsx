"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Boxes, CheckCircle2, Database, OctagonX } from "lucide-react";
import { toast } from "sonner";
import { runStatusVariant } from "@/components/dashboard/recent-runs";
import { AgentRoster } from "@/components/runs/agent-roster";
import { FoundryPreview } from "@/components/runs/foundry-preview";
import { LogTerminal } from "@/components/runs/log-terminal";
import { StageTracker } from "@/components/runs/stage-tracker";
import { VramCard } from "@/components/runs/vram-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { AgentInstance, LogEvent, PipelineRun } from "@/lib/api/types";
import { useRunStream } from "@/hooks/use-run-stream";

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api<PipelineRun>(endpoints.runs.get(id)),
  });
  const { data: agents } = useQuery({
    queryKey: ["run-agents", id],
    queryFn: () => api<AgentInstance[]>(endpoints.runs.agents(id)),
  });
  const { data: logs } = useQuery({
    queryKey: ["run-logs", id],
    queryFn: () => api<LogEvent[]>(endpoints.runs.logs(id)),
  });

  const cancel = useMutation({
    mutationFn: () => apiPost<PipelineRun>(endpoints.runs.cancel(id), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", id] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Run cancelled");
    },
  });

  const streaming =
    !!run && (run.status === "running" || run.status === "queued");
  const { liveLogs } = useRunStream(id, streaming);

  // History from REST + live tail from the stream, deduped by id (a refetch
  // of the history can overlap lines the stream already delivered).
  const allLogs = useMemo(() => {
    const seen = new Set<string>();
    return [...(logs ?? []), ...liveLogs].filter((log) => {
      if (seen.has(log.id)) return false;
      seen.add(log.id);
      return true;
    });
  }, [logs, liveLogs]);

  if (!run) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  const cancellable = run.status === "running" || run.status === "queued";

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/runs">
            <ArrowLeft className="size-3.5" />
            All runs
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{run.name}</h1>
            <Badge variant={runStatusVariant[run.status]}>{run.status}</Badge>
            <Badge variant="secondary">
              {run.path === "synthetic" ? "Synthetic Foundry" : "BYOD"}
            </Badge>
          </div>
          {cancellable && (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <OctagonX className="size-3.5" />
              Cancel run
            </Button>
          )}
        </div>
        <StageTracker path={run.path} stage={run.stage} status={run.status} />
        {run.failureReason && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {run.failureReason}
          </div>
        )}
        {run.status === "succeeded" && run.modelId && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="size-4" />
              Model trained and registered — dataset frozen and versioned.
            </div>
            <div className="flex gap-2">
              {run.datasetId && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/datasets/${run.datasetId}`}>
                    <Database className="size-3.5" />
                    View dataset
                  </Link>
                </Button>
              )}
              <Button size="sm" asChild>
                <Link href={`/models/${run.modelId}`}>
                  <Boxes className="size-3.5" />
                  View model
                </Link>
              </Button>
            </div>
          </div>
        )}
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1.5">
                  <CardTitle>Agent activity</CardTitle>
                  <CardDescription>
                    Reasoning and verification log
                  </CardDescription>
                </div>
                {streaming ? (
                  <Badge variant="outline" className="gap-1.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    Live
                  </Badge>
                ) : (
                  <Badge variant="outline">Log history</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <LogTerminal
                logs={allLogs}
                className="h-80"
                emptyMessage={
                  run.status === "queued"
                    ? "Run is queued — agents haven't produced output yet."
                    : "No log history for this run."
                }
              />
            </CardContent>
          </Card>

          {run.path === "synthetic" && (
            <FoundryPreview
              runId={id}
              active={streaming}
              imagesTotal={run.progress.imagesTotal}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Images</dt>
                  <dd className="text-lg font-semibold">
                    {run.progress.imagesGenerated.toLocaleString()}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}/ {run.progress.imagesTotal.toLocaleString()}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Masks accepted</dt>
                  <dd className="text-lg font-semibold text-emerald-500">
                    {run.progress.masksAccepted.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Masks rejected</dt>
                  <dd className="text-lg font-semibold text-orange-400">
                    {run.progress.masksRejected.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Epoch</dt>
                  <dd className="text-lg font-semibold">
                    {run.progress.currentEpoch}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}/ {run.progress.totalEpochs}
                    </span>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <VramCard />

          <Card>
            <CardHeader>
              <CardTitle>Agent swarm</CardTitle>
              <CardDescription>
                {run.path === "byod"
                  ? "BYOD runs skip prompt expansion and synthesis"
                  : "Five agents, zero human intervention"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agents ? (
                <AgentRoster agents={agents} />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {run.source.path === "synthetic" ? (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Base prompt</dt>
                      <dd className="mt-0.5 font-mono text-xs">
                        {run.source.basePrompt}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Generator</dt>
                      <dd className="font-mono text-xs uppercase">
                        {run.source.generator}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Guidance scale</dt>
                      <dd>{run.source.randomization.guidanceScale}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Archive</dt>
                      <dd className="font-mono text-xs">
                        {run.source.archiveName}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Images</dt>
                      <dd>{run.source.imageCount.toLocaleString()}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Classes</dt>
                  <dd className="font-mono text-xs">
                    {run.targetClasses.join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Architecture</dt>
                  <dd className="font-mono text-xs uppercase">
                    {run.training.architecture}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Epochs</dt>
                  <dd>{run.training.epochs}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Device</dt>
                  <dd className="font-mono text-xs">{run.training.device}</dd>
                </div>
                {run.costEstimateUsd !== undefined && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Est. cost</dt>
                    <dd>${run.costEstimateUsd.toFixed(2)}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
