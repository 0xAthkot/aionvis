import type { PipelinePath, PipelineStage, RunStatus } from "@/lib/api/types";

/**
 * Simple-mode vocabulary. Same facts, plain words — Pro mode keeps the
 * technical names untouched (Simple-mode doctrine: rename/explain/disclose,
 * never remove).
 */
export const SIMPLE_STAGE: Record<PipelineStage, string> = {
  queued: "Waiting for a GPU",
  prompt_expansion: "Designing scenes",
  synthesis: "Creating images",
  segmentation: "Labeling images",
  critic_review: "Double-checking labels",
  dataset_compile: "Packing the dataset",
  training: "Training the model",
  complete: "Complete",
};

export const SIMPLE_STATUS: Record<RunStatus, string> = {
  queued: "waiting",
  running: "in progress",
  paused: "paused",
  succeeded: "done",
  failed: "needs attention",
  cancelled: "cancelled",
};

export const SIMPLE_PATH: Record<PipelinePath, string> = {
  synthetic: "Built from your description",
  byod: "From your uploaded photos",
};
