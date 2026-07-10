"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { CreateRunRequest, PipelineRun } from "@/lib/api/types";

/** Queues a pipeline run and navigates to its detail page. */
export function useLaunchRun() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateRunRequest) =>
      apiPost<PipelineRun>(endpoints.runs.list(), body),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Run queued", {
        description: `${run.name} was handed to the agent swarm.`,
      });
      router.push(`/runs/${run.id}`);
    },
    onError: (err) =>
      toast.error("Launch failed", { description: err.message }),
  });
}
