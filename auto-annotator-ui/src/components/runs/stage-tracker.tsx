"use client";

import { Check } from "lucide-react";
import type { PipelinePath, PipelineStage, RunStatus } from "@/lib/api/types";
import { STAGE_ORDER } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const stageLabels: Partial<Record<PipelineStage, string>> = {
  prompt_expansion: "Prompt expansion",
  synthesis: "Synthesis",
  segmentation: "Segmentation",
  critic_review: "Critic review",
  dataset_compile: "Compile",
  training: "Training",
};

/** Pipeline stages for a path, without the queued/complete bookends. */
export function stagesForPath(path: PipelinePath): PipelineStage[] {
  return STAGE_ORDER.filter((s) => {
    if (s === "queued" || s === "complete") return false;
    if (path === "byod" && (s === "prompt_expansion" || s === "synthesis"))
      return false;
    return true;
  });
}

export function StageTracker({
  path,
  stage,
  status,
}: {
  path: PipelinePath;
  stage: PipelineStage;
  status: RunStatus;
}) {
  const stages = stagesForPath(path);
  const currentIdx =
    stage === "complete" ? stages.length : stages.indexOf(stage);

  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {stages.map((s, i) => {
        const done = i < currentIdx || status === "succeeded";
        const current =
          i === currentIdx && status !== "succeeded" && stage !== "complete";
        const failedHere = current && status === "failed";

        return (
          <li key={s} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "mx-2 h-px w-6",
                  done ? "bg-primary/60" : "bg-border",
                )}
              />
            )}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-[10px]",
                  done && "border-primary/60 bg-primary/15 text-primary",
                  current && !failedHere &&
                    "border-primary bg-primary text-primary-foreground",
                  current && status === "running" && "animate-pulse",
                  failedHere && "border-destructive bg-destructive/15 text-destructive",
                  !done && !current && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-xs",
                  current ? "font-medium" : "text-muted-foreground",
                )}
              >
                {stageLabels[s] ?? s}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
