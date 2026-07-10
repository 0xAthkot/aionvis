"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createRunStream } from "@/lib/api/streams";
import type { AgentInstance, LogEvent, PipelineRun } from "@/lib/api/types";

/**
 * Subscribes to a run's event stream while `enabled`, feeding events into the
 * TanStack Query cache (so every widget reading the run updates live) and
 * returning the live log tail for the terminal.
 */
export function useRunStream(runId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [liveLogs, setLiveLogs] = useState<LogEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const stream = createRunStream(runId);

    const unsubscribe = stream.subscribe((event) => {
      switch (event.kind) {
        case "log":
          setLiveLogs((prev) => [...prev.slice(-400), event.payload]);
          break;
        case "progress":
          queryClient.setQueryData<PipelineRun>(
            ["run", runId],
            (old) => old && { ...old, progress: event.payload },
          );
          break;
        case "stage":
          queryClient.setQueryData<PipelineRun>(
            ["run", runId],
            (old) => old && { ...old, stage: event.payload.to },
          );
          break;
        case "agent":
          queryClient.setQueryData<AgentInstance[]>(
            ["run-agents", runId],
            (old) =>
              old?.map((a) => (a.kind === event.payload.kind ? event.payload : a)),
          );
          break;
        case "status": {
          queryClient.setQueryData<PipelineRun>(
            ["run", runId],
            (old) => old && { ...old, status: event.payload.status },
          );
          if (event.payload.status === "succeeded") {
            // Completion mints dataset + model artifacts — refresh everything.
            queryClient.invalidateQueries({ queryKey: ["run", runId] });
            queryClient.invalidateQueries({ queryKey: ["runs"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
            queryClient.invalidateQueries({ queryKey: ["datasets"] });
            queryClient.invalidateQueries({ queryKey: ["models"] });
            toast.success("Run complete", {
              description: "Model trained and registered — see the Model Registry.",
            });
          }
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      stream.close();
    };
  }, [runId, enabled, queryClient]);

  return { liveLogs };
}
