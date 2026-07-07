"""Pydantic mirror of the frontend contract.

Source of truth: auto-annotator-ui/src/lib/api/types.ts — every model here
maps 1:1 onto an interface there. Fields are snake_case in Python and
camelCase on the wire via the alias generator (FastAPI serializes by alias
by default; `populate_by_name` lets server code construct with snake_case).
"""

from typing import Annotated, Generic, Literal, Optional, TypeVar, Union

from pydantic import BaseModel, ConfigDict, Field
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


# ---------------------------------------------------------------------------
# Pipeline runs
# ---------------------------------------------------------------------------

PipelinePath = Literal["synthetic", "byod"]

RunStatus = Literal["queued", "running", "paused", "succeeded", "failed", "cancelled"]

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
    base_prompt: str
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

Architecture = Literal["yolov10n", "yolov10s", "yolov10m", "yolov10l", "yolov10x"]


class TrainingConfig(ApiModel):
    architecture: Architecture
    epochs: int
    image_size: int
    batch_size: int
    device: str


class RunProgress(ApiModel):
    pct: float
    images_generated: int
    images_total: int
    masks_accepted: int
    masks_rejected: int
    current_epoch: int
    total_epochs: int
    latest_loss: Optional[float] = None


class PipelineRun(ApiModel):
    id: str
    org_id: str
    project_id: str
    name: str
    path: PipelinePath
    status: RunStatus
    stage: PipelineStage
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


class BoundingBox(ApiModel):
    class_id: int
    cx: float
    cy: float
    w: float
    h: float
    confidence: Optional[float] = None


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


class TrainingCurvePoint(ApiModel):
    epoch: int
    box_loss: float
    cls_loss: float
    map50: float
    map5095: float
    precision: float
    recall: float


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
    file_name: str
    file_size_mb: float
    classes: list[str]
    metrics: ModelMetrics
    curves: list[TrainingCurvePoint]
    trained_on: HardwareSummary
    status: Literal["training", "ready", "archived"]
    created_at: str


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
    credits_remaining_usd: float


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


class CurateImageRequest(ApiModel):
    curation_state: Literal["accepted", "rejected"]


class ExpandPromptRequest(ApiModel):
    base_prompt: str
    target_classes: list[str]
    randomization: DomainRandomizationConfig
    preview_count: Optional[int] = None


class ExpandPromptResponse(ApiModel):
    scenarios: list[str]
    total_scenarios: int
    model: str
    provider: str


class UploadRegisterRequest(ApiModel):
    archive_name: str
    size_mb: float


class ExportRequest(ApiModel):
    format: Literal["pt", "onnx"]


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
