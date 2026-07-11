"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Boxes, CheckCircle2, Database, OctagonX } from "lucide-react";
import { toast } from "sonner";
import { RunStatusChip } from "@/components/shared/status-chip";
import { AgentRoster } from "@/components/runs/agent-roster";
import { FoundryPreview } from "@/components/runs/foundry-preview";
import { LogTerminal } from "@/components/runs/log-terminal";
import { StageTracker } from "@/components/runs/stage-tracker";
import { VramCard } from "@/components/runs/vram-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { AgentInstance, LogEvent, PipelineRun } from "@/lib/api/types";
import { useUiModeStore } from "@/lib/stores/ui-mode";
import { useRunStream } from "@/hooks/use-run-stream";

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const pro = useUiModeStore((s) => s.mode) === "pro";

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

  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useMutation({
    mutationFn: () => apiPost<PipelineRun>(endpoints.runs.cancel(id), {}),
    onSuccess: () => {
      setConfirmCancel(false);
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
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/runs">
            <ArrowLeft className="size-3.5" />
            All runs
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {run.name}
            </h1>
            <RunStatusChip status={run.status} simple={!pro} />
            <Badge variant="secondary">
              {run.path === "synthetic"
                ? pro
                  ? "Synthetic Foundry"
                  : "Built from your description"
                : pro
                  ? "BYOD"
                  : "From your uploaded photos"}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="cursor-default">
                  {run.pipelineMode === "streaming"
                    ? "Parallel swarm · MI300X"
                    : "Sequential"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                {run.pipelineMode === "streaming"
                  ? "192 GB of HBM3 holds every agent model in VRAM at once, so synthesis, vision and critic work in parallel on one MI300X. Training joins once every label is verified."
                  : "This GPU can't hold every agent model at once, so the agents take turns owning it — each stage loads, works, and releases VRAM for the next."}
              </TooltipContent>
            </Tooltip>
          </div>
          {cancellable && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => setConfirmCancel(true)}
              >
                <OctagonX className="size-3.5" />
                Cancel run
              </Button>
              <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Cancel “{run.name}”?</DialogTitle>
                    <DialogDescription>
                      The pipeline stops where it is: no model will be
                      trained, and {run.progress.pct.toFixed(0)}% of the work
                      done so far is discarded. The GPU is released
                      immediately. This cannot be resumed.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmCancel(false)}
                      disabled={cancel.isPending}
                    >
                      Keep running
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate()}
                    >
                      <OctagonX className="size-3.5" />
                      {cancel.isPending ? "Cancelling…" : "Cancel run"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
        <StageTracker
          path={run.path}
          stage={run.stage}
          status={run.status}
          mode={run.pipelineMode}
          progress={run.progress}
        />
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

      <div className="grid items-start gap-x-10 gap-y-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="section-label">Agent activity</h2>
                <p className="text-sm text-muted-foreground">
                  Reasoning and verification log
                </p>
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
            <LogTerminal
              logs={allLogs}
              className="h-80"
              emptyMessage={
                run.status === "queued"
                  ? "Run is queued — agents haven't produced output yet."
                  : "No log history for this run."
              }
            />
          </section>

          {run.path === "synthetic" && (
            <FoundryPreview
              runId={id}
              active={streaming}
              imagesTotal={run.progress.imagesTotal}
            />
          )}

          <section className="space-y-3">
            <h2 className="section-label">Progress</h2>
            <dl className="grid grid-cols-2 gap-y-5 border-y border-border/70 text-sm sm:grid-cols-4 sm:divide-x sm:divide-border/70">
              <div className="py-4 pr-4 sm:px-8 sm:first:pl-0">
                <dt className="text-xs text-muted-foreground">Images</dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {run.progress.imagesGenerated.toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {run.progress.imagesTotal.toLocaleString()}
                  </span>
                </dd>
              </div>
              <div className="py-4 pr-4 sm:px-8">
                <dt className="text-xs text-muted-foreground">Masks accepted</dt>
                <dd className="text-2xl font-semibold tracking-tight text-emerald-500 tabular-nums">
                  {run.progress.masksAccepted.toLocaleString()}
                </dd>
              </div>
              <div className="py-4 pr-4 sm:px-8">
                <dt className="text-xs text-muted-foreground">Masks rejected</dt>
                <dd className="text-2xl font-semibold tracking-tight text-orange-400 tabular-nums">
                  {run.progress.masksRejected.toLocaleString()}
                </dd>
              </div>
              <div className="py-4 pr-4 sm:px-8">
                <dt className="text-xs text-muted-foreground">Epoch</dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {run.progress.currentEpoch}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {run.progress.totalEpochs}
                  </span>
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="space-y-8 xl:border-l xl:border-border/70 xl:pl-8">
          <VramCard />

          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="section-label">Agent swarm</h2>
              <p className="text-sm text-muted-foreground">
                {run.path === "byod"
                  ? "BYOD runs skip prompt expansion and synthesis"
                  : "Five agents, zero human intervention"}
              </p>
            </div>
            {agents ? (
              <AgentRoster agents={agents} />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}
          </section>

          {pro && (
          <section className="space-y-3">
            <h2 className="section-label">Configuration</h2>
            <dl className="divide-y divide-border/50 text-sm">
              {run.source.path === "synthetic" ? (
                <>
                  <div className="py-2">
                    <dt className="text-muted-foreground">Use case</dt>
                    <dd className="mt-0.5 font-mono text-xs">
                      {run.source.useCase}
                    </dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-muted-foreground">Generator</dt>
                    <dd className="font-mono text-xs uppercase">
                      {run.source.generator}
                    </dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-muted-foreground">Guidance scale</dt>
                    <dd>{run.source.randomization.guidanceScale}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between py-2">
                    <dt className="text-muted-foreground">Archive</dt>
                    <dd className="font-mono text-xs">
                      {run.source.archiveName}
                    </dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-muted-foreground">Images</dt>
                    <dd>{run.source.imageCount.toLocaleString()}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Classes</dt>
                <dd className="font-mono text-xs">
                  {run.targetClasses.join(", ")}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Architecture</dt>
                <dd className="font-mono text-xs uppercase">
                  {run.training.architecture}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Epochs</dt>
                <dd>{run.training.epochs}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Device</dt>
                <dd className="font-mono text-xs">{run.training.device}</dd>
              </div>
              {run.costEstimateUsd !== undefined && (
                <div className="flex justify-between py-2">
                  <dt className="text-muted-foreground">Est. cost</dt>
                  <dd>${run.costEstimateUsd.toFixed(2)}</dd>
                </div>
              )}
            </dl>
          </section>
          )}
        </div>
      </div>
    </main>
  );
}
