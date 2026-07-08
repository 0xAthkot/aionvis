"use client";

import { Check, ImagePlus, ScanEye, ShieldCheck } from "lucide-react";
import type {
  PipelineMode,
  PipelinePath,
  PipelineStage,
  RunProgress,
  RunStatus,
} from "@/lib/api/types";
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

/** The stages that overlap as concurrent streams in streaming mode. */
const OVERLAP_STAGES: PipelineStage[] = [
  "synthesis",
  "segmentation",
  "critic_review",
];

/** Pipeline stages for a path, without the queued/complete bookends. */
export function stagesForPath(path: PipelinePath): PipelineStage[] {
  return STAGE_ORDER.filter((s) => {
    if (s === "queued" || s === "complete") return false;
    if (path === "byod" && (s === "prompt_expansion" || s === "synthesis"))
      return false;
    return true;
  });
}

function StageChip({
  label,
  index,
  done,
  current,
  failed,
  pulse,
}: {
  label: string;
  index: number;
  done: boolean;
  current: boolean;
  failed: boolean;
  pulse: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-full border text-[10px]",
          done && "border-primary/60 bg-primary/15 text-primary",
          current && !failed &&
            "border-primary bg-primary text-primary-foreground",
          pulse && "animate-pulse",
          failed && "border-destructive bg-destructive/15 text-destructive",
          !done && !current && "border-border text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : index + 1}
      </span>
      <span
        className={cn(
          "text-xs",
          current ? "font-medium" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <div className={cn("mx-2 h-px w-6", done ? "bg-primary/60" : "bg-border")} />
  );
}

/**
 * Streaming overlap: the middle stages render as simultaneous mini progress
 * lanes (generated / annotated / verified) instead of one active chip.
 */
function OverlapLanes({
  path,
  progress,
}: {
  path: PipelinePath;
  progress: RunProgress;
}) {
  const total = Math.max(1, progress.imagesTotal);
  const lanes = [
    ...(path === "synthetic"
      ? [
          {
            key: "synthesis",
            icon: ImagePlus,
            label: "Generated",
            count: `${progress.imagesGenerated.toLocaleString()} / ${progress.imagesTotal.toLocaleString()}`,
            frac: progress.imagesGenerated / total,
          },
        ]
      : []),
    {
      key: "segmentation",
      icon: ScanEye,
      label: "Annotated",
      count: `${(progress.imagesAnnotated ?? 0).toLocaleString()} / ${progress.imagesTotal.toLocaleString()}`,
      frac: (progress.imagesAnnotated ?? 0) / total,
    },
    {
      key: "critic_review",
      icon: ShieldCheck,
      label: "Verified",
      count: `${progress.masksAccepted.toLocaleString()} labels`,
      // The critic trails vision by definition; its lane tracks the
      // annotated stream it consumes.
      frac: (progress.imagesAnnotated ?? 0) / total,
    },
  ];

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">
        <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        Parallel — agents streaming concurrently
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          return (
            <div key={lane.key} className="min-w-28">
              <div className="flex items-center gap-1.5 text-xs">
                <Icon className="size-3.5 text-primary" />
                <span className="text-muted-foreground">{lane.label}</span>
                <span className="font-medium tabular-nums">{lane.count}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.min(100, lane.frac * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StageTracker({
  path,
  stage,
  status,
  mode,
  progress,
}: {
  path: PipelinePath;
  stage: PipelineStage;
  status: RunStatus;
  mode?: PipelineMode;
  progress?: RunProgress;
}) {
  const stages = stagesForPath(path);
  const currentIdx =
    stage === "complete" ? stages.length : stages.indexOf(stage);

  // Streaming runs show the overlap lanes while any middle stage still has
  // pending items; the tracker collapses back to linear for compile →
  // training (and for every sequential run).
  const overlapActive =
    mode === "streaming" &&
    status === "running" &&
    !!progress &&
    OVERLAP_STAGES.includes(stage);

  if (overlapActive) {
    const before = stages.filter((s) => !OVERLAP_STAGES.includes(s) &&
      stages.indexOf(s) < stages.indexOf("dataset_compile"));
    const after: PipelineStage[] = ["dataset_compile", "training"];
    return (
      <div className="flex flex-wrap items-center gap-y-2">
        {before.map((s, i) => (
          <div key={s} className="flex items-center">
            {i > 0 && <Connector done />}
            <StageChip
              label={stageLabels[s] ?? s}
              index={i}
              done
              current={false}
              failed={false}
              pulse={false}
            />
          </div>
        ))}
        {before.length > 0 && <Connector done />}
        <OverlapLanes path={path} progress={progress} />
        {after.map((s) => (
          <div key={s} className="flex items-center">
            <Connector done={false} />
            <StageChip
              label={stageLabels[s] ?? s}
              index={stages.indexOf(s)}
              done={false}
              current={false}
              failed={false}
              pulse={false}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {stages.map((s, i) => {
        const done = i < currentIdx || status === "succeeded";
        const current =
          i === currentIdx && status !== "succeeded" && stage !== "complete";
        const failedHere = current && status === "failed";

        return (
          <li key={s} className="flex items-center">
            {i > 0 && <Connector done={done} />}
            <StageChip
              label={stageLabels[s] ?? s}
              index={i}
              done={done}
              current={current}
              failed={failedHere}
              pulse={current && status === "running"}
            />
          </li>
        );
      })}
    </ol>
  );
}
