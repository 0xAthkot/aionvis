"""Pydantic mirror of the frontend contract.

Source of truth: aionvis-ui/src/lib/api/types.ts — every model here
maps 1:1 onto an interface there. Fields are snake_case in Python and
camelCase on the wire via the alias generator (FastAPI serializes by alias
by default; `populate_by_name` lets server code construct with snake_case).
"""

from typing import Annotated, Generic, Literal, Optional, TypeVar, Union

from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------------

Plan = Literal["trial", "team", "enterprise"]
Role = Literal["owner", "admin", "operator", "viewer"]


class Organization(ApiModel):
    id: str
    name: str
    slug: str
    plan: Plan
    created_at: str


class Member(ApiModel):
    id: str
    org_id: str
    name: str
    email: str
    role: Role
    avatar_url: Optional[str] = None


class Project(ApiModel):
    id: str
    org_id: str
    name: str
    description: str
    target_classes: list[str]
    created_at: str


class CreateProjectRequest(ApiModel):
    name: str
    description: str = ""
    target_classes: list[str]


# ---------------------------------------------------------------------------
# Pipeline runs
# ---------------------------------------------------------------------------

PipelinePath = Literal["synthetic", "byod"]

RunStatus = Literal["queued", "running", "paused", "succeeded", "failed", "cancelled"]

# sequential: agents take turns owning the GPU (default, any card).
# streaming: synthesis → vision → critic overlap as producer/consumer streams
# on a card that holds the whole swarm resident (MI300X). Chosen by the
# backend from hardware config at run creation, never by the user.
PipelineMode = Literal["sequential", "streaming"]

PipelineStage = Literal[
    "queued",
    "prompt_expansion",
    "synthesis",
    "segmentation",
    "critic_review",
    "dataset_compile",
    "training",
    "complete",
]

STAGE_ORDER: list[PipelineStage] = [
    "queued",
    "prompt_expansion",
    "synthesis",
    "segmentation",
    "critic_review",
    "dataset_compile",
    "training",
    "complete",
]


class DomainRandomizationConfig(ApiModel):
    lighting_variation: float
    camera_angle_variation: float
    background_diversity: float
    occlusion_rate: float
    scenario_count: int
    image_count: int
    guidance_scale: float


class SyntheticSourceConfig(ApiModel):
    path: Literal["synthetic"]
    # What the model is FOR, in the user's words ("my drone needs to detect
    # rotten potatoes") — the Prompt Agent designs the scene prompts from it.
    # Accepts the pre-v0.5 wire name "basePrompt" so old state.json loads.
    use_case: str = Field(
        validation_alias=AliasChoices("useCase", "basePrompt", "use_case")
    )
    negative_prompt: Optional[str] = None
    generator: Literal["sdxl", "flux"]
    randomization: DomainRandomizationConfig


class ByodSourceConfig(ApiModel):
    path: Literal["byod"]
    dataset_id: str
    archive_name: str
    image_count: int


SourceConfig = Annotated[
    Union[SyntheticSourceConfig, ByodSourceConfig], Field(discriminator="path")
]

Architecture = Literal[
    "yolov10n", "yolov10s", "yolov10m", "yolov10l", "yolov10x",
    "yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x",
    "yolo26n", "yolo26s", "yolo26m", "yolo26l", "yolo26x",
    "rtdetr-l", "rtdetr-x",
    # Roboflow RF-DETR — trained in an isolated venv (see rfdetr_bridge).
    "rf-detr-nano", "rf-detr-small", "rf-detr-medium",
    "rf-detr-base", "rf-detr-large",
]

# What the trained model outputs. segment/obb reuse the Vision Agent's mask
# polygons; pose keypoints come from a pretrained teacher at compile time;
# classify trains on per-class crops cut from the verified boxes.
# Only YOLO11/YOLO26 ship non-detect heads (YOLOv10 and RT-DETR are detect-only).
TrainingTask = Literal["detect", "segment", "obb", "pose", "classify"]


class TrainingConfig(ApiModel):
    architecture: Architecture
    task: TrainingTask = "detect"
    epochs: int
    image_size: int
    batch_size: int
    device: str


class RunProgress(ApiModel):
    pct: float
    images_generated: int
    images_total: int
    # Streaming mode only: vision throughput, visible separately from the
    # critic's masks_accepted while both agents work concurrently.
    images_annotated: Optional[int] = None
    masks_accepted: int
    masks_rejected: int
    current_epoch: int
    total_epochs: int
    latest_loss: Optional[float] = None


# Which zero-shot labeler annotates the images. Per-run user choice; the
# node's VISION_BACKEND setting is only the default. Honored verbatim —
# a node that can't run the selection rejects the run (no fallback).
VisionBackend = Literal["sam3", "yoloe"]


class PipelineRun(ApiModel):
    id: str
    org_id: str
    project_id: str
    name: str
    path: PipelinePath
    status: RunStatus
    stage: PipelineStage
    # Optional so state.json written before the field existed still loads.
    pipeline_mode: Optional[PipelineMode] = None
    # Resolved at creation (request field or node default); None on old runs.
    vision_backend: Optional[VisionBackend] = None
    source: SourceConfig
    training: TrainingConfig
    target_classes: list[str]
    progress: RunProgress
    created_by: str
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    dataset_id: Optional[str] = None
    model_id: Optional[str] = None
    cost_estimate_usd: Optional[float] = None
    failure_reason: Optional[str] = None


class RunPreviewImage(ApiModel):
    file_name: str
    url: str
    scenario: Optional[str] = None


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

AgentKind = Literal["prompt", "synthesis", "vision", "critic", "mlops"]

AgentState = Literal["idle", "thinking", "working", "waiting_gpu", "done", "error"]


class AgentInstance(ApiModel):
    id: str
    run_id: str
    kind: AgentKind
    display_name: str
    model: str
    provider: str
    state: AgentState
    current_task: Optional[str] = None
    started_at: Optional[str] = None


class StageTransition(ApiModel):
    run_id: str
    from_: PipelineStage = Field(alias="from")
    to: PipelineStage
    at: str
    duration_ms: Optional[int] = None
    note: Optional[str] = None


LogLevel = Literal["debug", "info", "warn", "error", "critic", "stage", "gpu"]


class LogEvent(ApiModel):
    id: str
    run_id: str
    at: str
    level: LogLevel
    agent: Optional[AgentKind] = None
    message: str


# ---------------------------------------------------------------------------
# Datasets & annotations
# ---------------------------------------------------------------------------

DatasetStatus = Literal["uploading", "unlabeled", "labeling", "curating", "ready"]


class DatasetClass(ApiModel):
    id: int
    name: str
    color: str
    instance_count: int


class ImportedLabels(ApiModel):
    """Set when a BYOD archive included YOLO/COCO annotation files; a run on
    such a dataset audits the provided labels instead of labeling from scratch."""

    format: Literal["yolo", "coco"]
    class_names: list[str]
    box_count: int


class Dataset(ApiModel):
    id: str
    org_id: str
    project_id: Optional[str] = None
    name: str
    origin: PipelinePath
    status: DatasetStatus
    image_count: int
    labeled_count: int
    classes: list[DatasetClass]
    size_mb: float
    created_at: str
    run_id: Optional[str] = None
    imported_labels: Optional[ImportedLabels] = None
    # BYOD archives with videos: how many frames were extracted from them.
    video_frame_count: Optional[int] = None


class BoundingBox(ApiModel):
    class_id: int
    cx: float
    cy: float
    w: float
    h: float
    confidence: Optional[float] = None
    # Simplified mask contour as flat normalized pairs [x1, y1, x2, y2, …];
    # present on Critic-verified labels, powers segment/obb training + export.
    polygon: Optional[list[float]] = None


class SplitStat(ApiModel):
    split: Literal["train", "val", "test"]
    images: int
    instances: int


class DimensionStat(ApiModel):
    width: int
    height: int
    count: int


class DatasetAnalytics(ApiModel):
    """Aggregate label statistics (GET /datasets/{id}/analytics)."""

    dataset_id: str
    class_distribution: list[DatasetClass]
    splits: list[SplitStat]
    # Row-major heatmap_size² grid of annotation spatial density, 0–1
    # (each box adds its coverage to the cells it overlaps; max-normalized).
    heatmap_size: int
    heatmap: list[float]
    dimensions: list[DimensionStat]
    mean_box_area: float
    boxes_per_image: float


class CritiqueRecord(ApiModel):
    verdict: Literal["accepted", "rejected", "regenerated"]
    reason: Optional[str] = None
    iou: Optional[float] = None
    attempts: int
    critic: str


class AnnotatedImage(ApiModel):
    id: str
    dataset_id: str
    file_name: str
    width: int
    height: int
    url: str
    thumbnail_url: str
    boxes: list[BoundingBox]
    split: Literal["train", "val", "test"]
    curation_state: Literal["pending", "accepted", "rejected"]
    critique: Optional[CritiqueRecord] = None


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------


class ModelMetrics(ApiModel):
    map50: float
    map5095: float
    precision: float
    recall: float
    epochs_run: int
    training_time_min: float
    # Classification models only (task="classify"): top-1/top-5 accuracy.
    top1: Optional[float] = None
    top5: Optional[float] = None


class TrainingCurvePoint(ApiModel):
    epoch: int
    box_loss: float
    cls_loss: float
    map50: float
    map5095: float
    precision: float
    recall: float
    # Classification models only: per-epoch top-1 accuracy.
    top1: Optional[float] = None


class HardwareSummary(ApiModel):
    node_name: str
    gpu: str
    vram_gb: float
    rocm_version: str


class ModelArtifact(ApiModel):
    id: str
    org_id: str
    run_id: str
    dataset_id: str
    name: str
    version: int
    architecture: Architecture
    task: TrainingTask = "detect"
    file_name: str
    file_size_mb: float
    classes: list[str]
    metrics: ModelMetrics
    curves: list[TrainingCurvePoint]
    trained_on: HardwareSummary
    status: Literal["training", "ready", "archived"]
    created_at: str
    # Markdown card written by the LLM after training (None if unavailable).
    model_card: Optional[str] = None


# ---------------------------------------------------------------------------
# Hardware & telemetry
# ---------------------------------------------------------------------------


class HardwareNode(ApiModel):
    id: str
    name: str
    gpu: str
    gpu_count: int
    vram_gb: float
    rocm_version: str
    pytorch_version: str
    status: Literal["online", "busy", "offline"]
    region: str
    provider: Literal["amd-developer-cloud", "on-prem"]
    # Models held resident in VRAM (KEEP_MODELS_WARM); absent/empty on
    # sequential nodes that load-and-flush per stage.
    resident_models: Optional[list[str]] = None


class Throughput(ApiModel):
    kind: Literal["img_per_s", "it_per_s"]
    value: float


class TelemetrySample(ApiModel):
    node_id: str
    at: str
    vram_used_gb: float
    vram_total_gb: float
    gpu_util_pct: float
    temp_c: float
    power_w: float
    throughput: Optional[Throughput] = None


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------


class DashboardStats(ApiModel):
    active_runs: int
    queued_runs: int
    models_trained: int
    images_generated: int
    images_labeled: int
    gpu_hours_used: float


class ApiKey(ApiModel):
    id: str
    name: str
    prefix: str
    created_at: str
    last_used_at: Optional[str] = None
    # Full secret; only present in the POST response ("returned once").
    secret: Optional[str] = None


class CostBreakdownItem(ApiModel):
    stage: PipelineStage
    minutes: float


class CostEstimate(ApiModel):
    gpu_minutes: float
    estimated_usd: float
    breakdown: list[CostBreakdownItem]


T = TypeVar("T")


class Paginated(ApiModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class ApiErrorBody(ApiModel):
    status: int
    code: str
    message: str


# ---------------------------------------------------------------------------
# Request payloads
# ---------------------------------------------------------------------------


class CreateRunRequest(ApiModel):
    project_id: str
    name: str
    target_classes: list[str]
    source: SourceConfig
    training: TrainingConfig
    # Omitted -> the node's VISION_BACKEND default.
    vision_backend: Optional[VisionBackend] = None


class CurateImageRequest(ApiModel):
    curation_state: Literal["accepted", "rejected"]


class ExpandPromptRequest(ApiModel):
    use_case: str = Field(
        validation_alias=AliasChoices("useCase", "basePrompt", "use_case")
    )
    target_classes: list[str]
    randomization: DomainRandomizationConfig
    preview_count: Optional[int] = None
    # When set, the project's pending playground feedback (hard cases) is
    # folded into the expansion so the preview matches what the run will do.
    project_id: Optional[str] = None


class ExpandPromptResponse(ApiModel):
    scenarios: list[str]
    total_scenarios: int
    model: str
    provider: str


class UploadRegisterRequest(ApiModel):
    archive_name: str
    size_mb: float


class ExportRequest(ApiModel):
    format: Literal["pt", "onnx", "torchscript", "openvino"]


class DatasetExportRequest(ApiModel):
    format: Literal["yolo", "coco", "voc", "csv"]


class ExportResponse(ApiModel):
    download_url: str


class PredictionResult(ApiModel):
    """Result of live inference with a trained model (POST /models/{id}/predict)."""

    boxes: list[BoundingBox]
    latency_ms: float
    device: str
    width: int
    height: int


class CreateApiKeyRequest(ApiModel):
    name: str


class FoundryFeedback(ApiModel):
    """A hard case flagged from the playground; seeds the next run's scenarios."""

    id: str
    project_id: str
    model_id: str
    note: str
    detections: int
    created_at: str
    consumed_by_run_id: Optional[str] = None


class CreateFeedbackRequest(ApiModel):
    model_id: str
    note: str
    detections: int = 0
