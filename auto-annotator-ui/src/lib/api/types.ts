/**
 * THE CONTRACT.
 *
 * Every entity the Control Plane renders is defined here, and this file is
 * the specification the future FastAPI backend must implement verbatim
 * (mirrored as Pydantic models). The MSW mock layer in `src/lib/mocks`
 * implements exactly these shapes — components never know the difference.
 */

/** ISO-8601 timestamp, e.g. "2026-07-06T12:00:00Z". */
export type ISODateString = string;

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "trial" | "team" | "enterprise";
  createdAt: ISODateString;
}

export interface Member {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "operator" | "viewer";
  avatarUrl?: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string;
  targetClasses: string[];
  createdAt: ISODateString;
}

/** `POST /projects` — classes are slugified server-side ("solder bridge" → "solder_bridge"). */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  targetClasses: string[];
}

// ---------------------------------------------------------------------------
// Pipeline runs
// ---------------------------------------------------------------------------

/** Path A = Synthetic Foundry, Path B = BYOD Enterprise. */
export type PipelinePath = "synthetic" | "byod";

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Stages of the agent pipeline, in execution order. BYOD runs skip
 * `prompt_expansion` and `synthesis`.
 */
export type PipelineStage =
  | "queued"
  | "prompt_expansion"
  | "synthesis"
  | "segmentation"
  | "critic_review"
  | "dataset_compile"
  | "training"
  | "complete";

export const STAGE_ORDER: readonly PipelineStage[] = [
  "queued",
  "prompt_expansion",
  "synthesis",
  "segmentation",
  "critic_review",
  "dataset_compile",
  "training",
  "complete",
] as const;

/** All sliders are 0–1 intensities unless noted. */
export interface DomainRandomizationConfig {
  lightingVariation: number;
  cameraAngleVariation: number;
  backgroundDiversity: number;
  occlusionRate: number;
  /** How many scenario prompts the Prompt Agent expands the base prompt into. */
  scenarioCount: number;
  /** Total images to synthesize. */
  imageCount: number;
  /** Diffusion guidance scale (typically 4–12). */
  guidanceScale: number;
}

export interface SyntheticSourceConfig {
  path: "synthetic";
  basePrompt: string;
  negativePrompt?: string;
  generator: "sdxl" | "flux";
  randomization: DomainRandomizationConfig;
}

export interface ByodSourceConfig {
  path: "byod";
  /** Dataset created by the upload flow. */
  datasetId: string;
  archiveName: string;
  imageCount: number;
}

export type SourceConfig = SyntheticSourceConfig | ByodSourceConfig;

/** Trainable detector families (all via Ultralytics). */
export type Architecture =
  | "yolov10n" | "yolov10s" | "yolov10m" | "yolov10l" | "yolov10x"
  | "yolo11n" | "yolo11s" | "yolo11m" | "yolo11l" | "yolo11x"
  | "yolo26n" | "yolo26s" | "yolo26m" | "yolo26l" | "yolo26x"
  | "rtdetr-l" | "rtdetr-x"
  | "rf-detr-nano" | "rf-detr-small" | "rf-detr-medium"
  | "rf-detr-base" | "rf-detr-large";

/** Weight export targets (`POST /models/{id}/export`); openvino downloads as a zip. */
export type ModelExportFormat = "pt" | "onnx" | "torchscript" | "openvino";

/**
 * What the trained model outputs. segment/obb reuse the Critic-verified mask
 * polygons; pose keypoints come from a pretrained teacher at compile time.
 * Non-detect tasks require YOLO11/YOLO26 (YOLOv10 and RT-DETR are detect-only).
 */
export type TrainingTask = "detect" | "segment" | "obb" | "pose";

export interface TrainingConfig {
  architecture: Architecture;
  /** Defaults to "detect" server-side when omitted. */
  task?: TrainingTask;
  epochs: number;
  imageSize: number;
  batchSize: number;
  /** e.g. "mi300x-0" */
  device: string;
}

export interface RunProgress {
  /** Overall 0–100. */
  pct: number;
  imagesGenerated: number;
  imagesTotal: number;
  masksAccepted: number;
  masksRejected: number;
  currentEpoch: number;
  totalEpochs: number;
  latestLoss?: number;
}

export interface PipelineRun {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  path: PipelinePath;
  status: RunStatus;
  stage: PipelineStage;
  source: SourceConfig;
  training: TrainingConfig;
  targetClasses: string[];
  progress: RunProgress;
  createdBy: string;
  createdAt: ISODateString;
  startedAt?: ISODateString;
  finishedAt?: ISODateString;
  /** Set once the pipeline has compiled a dataset. */
  datasetId?: string;
  /** Set once training has produced weights. */
  modelId?: string;
  costEstimateUsd?: number;
  failureReason?: string;
}

/** A generated image surfaced live while the Synthesis Agent works. */
export interface RunPreviewImage {
  fileName: string;
  url: string;
  /** Scenario prompt that produced this image (synthetic runs). */
  scenario?: string;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentKind = "prompt" | "synthesis" | "vision" | "critic" | "mlops";

export type AgentState =
  | "idle"
  | "thinking"
  | "working"
  | "waiting_gpu"
  | "done"
  | "error";

export interface AgentInstance {
  id: string;
  runId: string;
  kind: AgentKind;
  displayName: string;
  /** Model powering the agent, e.g. "Gemma 4" or "SAM 3". */
  model: string;
  /** Where the model runs, e.g. "Fireworks AI" or "MI300X · local". */
  provider: string;
  state: AgentState;
  currentTask?: string;
  startedAt?: ISODateString;
}

export interface StageTransition {
  runId: string;
  from: PipelineStage;
  to: PipelineStage;
  at: ISODateString;
  durationMs?: number;
  note?: string;
}

export type LogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error"
  /** Critic Agent verdicts — rendered highlighted in the terminal. */
  | "critic"
  /** Stage banners. */
  | "stage"
  /** GPU / VRAM orchestration events, e.g. hip.empty_cache(). */
  | "gpu";

export interface LogEvent {
  id: string;
  runId: string;
  at: ISODateString;
  level: LogLevel;
  agent?: AgentKind;
  message: string;
}

// ---------------------------------------------------------------------------
// Datasets & annotations
// ---------------------------------------------------------------------------

export type DatasetStatus =
  | "uploading"
  | "unlabeled"
  | "labeling"
  | "curating"
  | "ready";

export interface DatasetClass {
  /** YOLO class index. */
  id: number;
  name: string;
  /** Display color, hex. */
  color: string;
  instanceCount: number;
}

export interface Dataset {
  id: string;
  orgId: string;
  projectId?: string;
  name: string;
  origin: PipelinePath;
  status: DatasetStatus;
  imageCount: number;
  labeledCount: number;
  classes: DatasetClass[];
  sizeMb: number;
  createdAt: ISODateString;
  /** Run that produced/consumed this dataset, if any. */
  runId?: string;
}

/** YOLO-normalized box: center x/y and width/height, all 0–1. */
export interface BoundingBox {
  classId: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  confidence?: number;
  /**
   * Simplified mask contour as flat normalized pairs [x1, y1, x2, y2, …].
   * Present on Critic-verified labels; powers segment/obb training + export.
   */
  polygon?: number[];
}

export interface CritiqueRecord {
  verdict: "accepted" | "rejected" | "regenerated";
  reason?: string;
  /** IoU between SAM mask box and Critic's geometric check. */
  iou?: number;
  attempts: number;
  /** e.g. "Critic Agent (Gemma 4 + OpenCV)" */
  critic: string;
}

export interface AnnotatedImage {
  id: string;
  datasetId: string;
  fileName: string;
  width: number;
  height: number;
  url: string;
  thumbnailUrl: string;
  boxes: BoundingBox[];
  split: "train" | "val" | "test";
  curationState: "pending" | "accepted" | "rejected";
  critique?: CritiqueRecord;
}

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

export interface ModelMetrics {
  map50: number;
  map5095: number;
  precision: number;
  recall: number;
  epochsRun: number;
  trainingTimeMin: number;
}

export interface TrainingCurvePoint {
  epoch: number;
  boxLoss: number;
  clsLoss: number;
  map50: number;
  map5095: number;
  precision: number;
  recall: number;
}

export interface HardwareSummary {
  nodeName: string;
  gpu: string;
  vramGb: number;
  rocmVersion: string;
}

export interface ModelArtifact {
  id: string;
  orgId: string;
  runId: string;
  datasetId: string;
  name: string;
  version: number;
  architecture: TrainingConfig["architecture"];
  /** Absent on models trained before tasks existed (= "detect"). */
  task?: TrainingTask;
  fileName: string;
  fileSizeMb: number;
  classes: string[];
  metrics: ModelMetrics;
  curves: TrainingCurvePoint[];
  trainedOn: HardwareSummary;
  status: "training" | "ready" | "archived";
  createdAt: ISODateString;
  /** Markdown model card authored by the LLM after training. */
  modelCard?: string;
}

/**
 * A hard case flagged from the inference playground. The next run in the
 * same project feeds these to the Prompt Agent so new synthetic data covers
 * the observed failures (active learning).
 */
export interface FoundryFeedback {
  id: string;
  projectId: string;
  modelId: string;
  note: string;
  /** Detections the model produced when the case was flagged. */
  detections: number;
  createdAt: ISODateString;
  /** Set once a later run consumed this feedback. */
  consumedByRunId?: string;
}

export interface CreateFeedbackRequest {
  modelId: string;
  note: string;
  detections: number;
}

/**
 * Download a dataset as a training-ready archive (`POST /datasets/{id}/export`).
 * Format parity with Label Studio's CV exports: yolo = images/ + labels/ +
 * data.yaml · coco = instances.json (with segmentation when masks exist) ·
 * voc = Pascal VOC XML per image · csv = one flat annotations.csv.
 */
export interface DatasetExportRequest {
  format: "yolo" | "coco" | "voc" | "csv";
}

/** Result of live inference with a trained model (`POST /models/{id}/predict`). */
export interface PredictionResult {
  /** classId indexes into ModelArtifact.classes. */
  boxes: BoundingBox[];
  latencyMs: number;
  /** Where inference ran, e.g. "cuda:0 · MI300X" or "cpu (GPU busy)". */
  device: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Hardware & telemetry
// ---------------------------------------------------------------------------

export interface HardwareNode {
  id: string;
  name: string;
  gpu: string;
  gpuCount: number;
  vramGb: number;
  rocmVersion: string;
  pytorchVersion: string;
  status: "online" | "busy" | "offline";
  region: string;
  provider: "amd-developer-cloud" | "on-prem";
}

export interface TelemetrySample {
  nodeId: string;
  at: ISODateString;
  vramUsedGb: number;
  vramTotalGb: number;
  gpuUtilPct: number;
  tempC: number;
  powerW: number;
  throughput?: { kind: "img_per_s" | "it_per_s"; value: number };
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export interface DashboardStats {
  activeRuns: number;
  queuedRuns: number;
  modelsTrained: number;
  imagesGenerated: number;
  imagesLabeled: number;
  gpuHoursUsed: number;
  creditsRemainingUsd: number;
}

export interface ApiKey {
  id: string;
  name: string;
  /** First characters shown in the UI, e.g. "aa_live_3f9…". */
  prefix: string;
  createdAt: ISODateString;
  lastUsedAt?: ISODateString;
}

export interface CostEstimate {
  gpuMinutes: number;
  estimatedUsd: number;
  breakdown: { stage: PipelineStage; minutes: number }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  status: number;
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface CreateSyntheticRunRequest {
  projectId: string;
  name: string;
  targetClasses: string[];
  source: SyntheticSourceConfig;
  training: TrainingConfig;
}

export interface CreateByodRunRequest {
  projectId: string;
  name: string;
  targetClasses: string[];
  source: ByodSourceConfig;
  training: TrainingConfig;
}

export type CreateRunRequest = CreateSyntheticRunRequest | CreateByodRunRequest;

export interface CurateImageRequest {
  curationState: "accepted" | "rejected";
}

/** Prompt Agent (Gemma 4) dry-run: expand a base prompt into scenario prompts. */
export interface ExpandPromptRequest {
  basePrompt: string;
  targetClasses: string[];
  randomization: DomainRandomizationConfig;
  /** How many scenarios to return in the preview (backend caps at 12). */
  previewCount?: number;
  /**
   * When set, the project's pending playground feedback (hard cases) is
   * folded into the expansion so the preview matches what the run will do.
   */
  projectId?: string;
}

export interface ExpandPromptResponse {
  /** Sample of the expanded scenario prompts. */
  scenarios: string[];
  /** Total the full run would generate (= randomization.scenarioCount). */
  totalScenarios: number;
  model: string;
  provider: string;
}
