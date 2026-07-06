"""Every REST route from BACKEND_CONTRACT.md / endpoints.ts, 1:1."""

import secrets

from fastapi import APIRouter, HTTPException, Request
from starlette.datastructures import UploadFile

from . import telemetry
from .agents.prompt_agent import prompt_agent
from .config import settings
from .events import bus
from .orchestrator.pipeline import pipeline
from .schemas import (
    AgentInstance,
    AnnotatedImage,
    ApiKey,
    CostBreakdownItem,
    CostEstimate,
    CreateApiKeyRequest,
    CreateRunRequest,
    CurateImageRequest,
    DashboardStats,
    Dataset,
    ExpandPromptRequest,
    ExpandPromptResponse,
    ExportRequest,
    ExportResponse,
    HardwareNode,
    LogEvent,
    Member,
    ModelArtifact,
    Organization,
    Paginated,
    PipelineRun,
    PipelineStage,
    Project,
    RunProgress,
    TelemetrySample,
    UploadRegisterRequest,
)
from .store import now_iso, store

router = APIRouter(prefix="/api/v1")


def _not_found(resource: str, resource_id: str) -> HTTPException:
    return HTTPException(404, f"{resource} '{resource_id}' not found")


def _paginate(items: list, page: int, page_size: int) -> dict:
    start = (page - 1) * page_size
    return {
        "items": items[start : start + page_size],
        "total": len(items),
        "page": page,
        "pageSize": page_size,
    }


# --- dashboard ---------------------------------------------------------------


@router.get("/dashboard/stats")
def dashboard_stats() -> DashboardStats:
    runs = list(store.runs.values())
    images_generated = sum(
        r.progress.images_generated for r in runs if r.path == "synthetic"
    )
    images_labeled = sum(d.labeled_count for d in store.datasets.values())
    gpu_hours = store.gpu_seconds_used / 3600
    return DashboardStats(
        active_runs=sum(r.status in ("running", "paused") for r in runs),
        queued_runs=sum(r.status == "queued" for r in runs),
        models_trained=sum(m.status == "ready" for m in store.models.values()),
        images_generated=images_generated,
        images_labeled=images_labeled,
        gpu_hours_used=round(gpu_hours, 2),
        credits_remaining_usd=round(
            500.0 - gpu_hours * 60 * settings.gpu_usd_per_min, 2
        ),
    )


# --- tenancy -------------------------------------------------------------------


@router.get("/organizations")
def organizations() -> list[Organization]:
    return store.organizations


@router.get("/organizations/{org_id}/members")
def members(org_id: str) -> list[Member]:
    return [m for m in store.members if m.org_id == org_id]


@router.get("/projects")
def projects() -> list[Project]:
    return store.projects


@router.get("/projects/{project_id}")
def project(project_id: str) -> Project:
    for p in store.projects:
        if p.id == project_id:
            return p
    raise _not_found("Project", project_id)


# --- runs ----------------------------------------------------------------------


@router.get("/runs")
def list_runs(page: int = 1, pageSize: int = 50) -> Paginated[PipelineRun]:
    runs = sorted(store.runs.values(), key=lambda r: r.created_at, reverse=True)
    return Paginated[PipelineRun].model_validate(_paginate(runs, page, pageSize))


@router.post("/runs", status_code=201)
def create_run(body: CreateRunRequest) -> PipelineRun:
    if not any(p.id == body.project_id for p in store.projects):
        raise _not_found("Project", body.project_id)
    if body.source.path == "byod" and body.source.dataset_id not in store.datasets:
        raise _not_found("Dataset", body.source.dataset_id)
    org = store.organizations[0]
    run = PipelineRun(
        id=store.next_id("run"),
        org_id=org.id,
        project_id=body.project_id,
        name=body.name,
        path=body.source.path,
        status="queued",
        stage="queued",
        source=body.source,
        training=body.training,
        target_classes=body.target_classes,
        progress=RunProgress(
            pct=0,
            images_generated=0,
            images_total=(
                min(body.source.randomization.image_count, settings.max_images_per_run)
                if body.source.path == "synthetic"
                else body.source.image_count
            ),
            masks_accepted=0,
            masks_rejected=0,
            current_epoch=0,
            total_epochs=min(body.training.epochs, settings.max_epochs),
        ),
        created_by="member_1",
        created_at=now_iso(),
        cost_estimate_usd=_estimate(body).estimated_usd,
        dataset_id=body.source.dataset_id if body.source.path == "byod" else None,
    )
    store.runs[run.id] = run
    store.run_logs[run.id] = []
    store.save()
    pipeline.launch(run.id)
    return run


@router.post("/runs/estimate")
def estimate_run(body: CreateRunRequest) -> CostEstimate:
    return _estimate(body)


def _estimate(body: CreateRunRequest) -> CostEstimate:
    """Heuristic dry-run pricing; mirrors the stage plan the orchestrator runs."""
    epochs = min(body.training.epochs, settings.max_epochs)
    if body.source.path == "synthetic":
        images = min(body.source.randomization.image_count, settings.max_images_per_run)
        stages: list[tuple[PipelineStage, float]] = [
            ("prompt_expansion", 0.4),
            ("synthesis", images * 4 / 60),
            ("segmentation", images * 1.5 / 60),
            ("critic_review", images * 0.5 / 60),
            ("dataset_compile", 0.3),
            ("training", epochs * images * 0.02),
        ]
    else:
        images = body.source.image_count
        stages = [
            ("segmentation", images * 1.5 / 60),
            ("critic_review", images * 0.5 / 60),
            ("dataset_compile", 0.3),
            ("training", epochs * images * 0.02),
        ]
    total_min = sum(m for _, m in stages)
    return CostEstimate(
        gpu_minutes=round(total_min, 1),
        estimated_usd=round(total_min * settings.gpu_usd_per_min, 2),
        breakdown=[
            CostBreakdownItem(stage=s, minutes=round(m, 2)) for s, m in stages
        ],
    )


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> PipelineRun:
    run = store.runs.get(run_id)
    if run is None:
        raise _not_found("Run", run_id)
    return run


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> PipelineRun:
    run = store.runs.get(run_id)
    if run is None:
        raise _not_found("Run", run_id)
    pipeline.request_cancel(run_id)
    return run


@router.get("/runs/{run_id}/agents")
def run_agents(run_id: str) -> list[AgentInstance]:
    if run_id not in store.runs:
        raise _not_found("Run", run_id)
    return pipeline.agents_for(run_id)


@router.get("/runs/{run_id}/logs")
def run_logs(run_id: str) -> list[LogEvent]:
    if run_id not in store.runs:
        raise _not_found("Run", run_id)
    return store.run_logs.get(run_id, [])


# --- foundry ---------------------------------------------------------------------


@router.post("/foundry/expand-prompt")
async def expand_prompt(body: ExpandPromptRequest) -> ExpandPromptResponse:
    preview = min(body.preview_count or 8, 12)
    scenarios = await prompt_agent.expand_async(
        base_prompt=body.base_prompt,
        target_classes=body.target_classes,
        randomization=body.randomization,
        count=preview,
    )
    return ExpandPromptResponse(
        scenarios=scenarios,
        total_scenarios=body.randomization.scenario_count,
        model=prompt_agent.model_label,
        provider=prompt_agent.provider_label,
    )


# --- datasets --------------------------------------------------------------------


@router.get("/datasets")
def datasets() -> list[Dataset]:
    return sorted(store.datasets.values(), key=lambda d: d.created_at, reverse=True)


@router.get("/datasets/{dataset_id}")
def dataset(dataset_id: str) -> Dataset:
    ds = store.datasets.get(dataset_id)
    if ds is None:
        raise _not_found("Dataset", dataset_id)
    return ds


@router.get("/datasets/{dataset_id}/images")
def dataset_images(
    dataset_id: str, page: int = 1, pageSize: int = 50
) -> Paginated[AnnotatedImage]:
    if dataset_id not in store.datasets:
        raise _not_found("Dataset", dataset_id)
    images = store.images.get(dataset_id, [])
    return Paginated[AnnotatedImage].model_validate(_paginate(images, page, pageSize))


@router.patch("/datasets/{dataset_id}/images/{image_id}")
def curate_image(
    dataset_id: str, image_id: str, body: CurateImageRequest
) -> AnnotatedImage:
    for img in store.images.get(dataset_id, []):
        if img.id == image_id:
            img.curation_state = body.curation_state
            store.save()
            return img
    raise _not_found("Image", image_id)


@router.post("/datasets/upload", status_code=201)
async def upload_dataset(request: Request) -> Dataset:
    """BYOD upload.

    Accepts either the contract's JSON registration { archiveName, sizeMb }
    (creates an empty shell the UI flow expects) or a real multipart .zip
    upload (field name "archive") which is extracted for the pipeline.
    """
    from .byod import register_archive_shell, save_archive  # avoid cycle at import

    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/"):
        form = await request.form()
        archive = form.get("archive")
        if not isinstance(archive, UploadFile):
            raise HTTPException(400, "multipart field 'archive' (a .zip) is required")
        return await save_archive(archive)
    body = UploadRegisterRequest.model_validate(await request.json())
    return register_archive_shell(body.archive_name, body.size_mb)


# --- models ----------------------------------------------------------------------


@router.get("/models")
def models() -> list[ModelArtifact]:
    return sorted(store.models.values(), key=lambda m: m.created_at, reverse=True)


@router.get("/models/{model_id}")
def model(model_id: str) -> ModelArtifact:
    artifact = store.models.get(model_id)
    if artifact is None:
        raise _not_found("Model", model_id)
    return artifact


@router.post("/models/{model_id}/export")
def export_model(model_id: str, body: ExportRequest) -> ExportResponse:
    artifact = store.models.get(model_id)
    if artifact is None:
        raise _not_found("Model", model_id)
    from .agents.mlops_agent import export_artifact

    url = export_artifact(artifact, body.format)
    return ExportResponse(download_url=url)


# --- hardware --------------------------------------------------------------------


@router.get("/hardware/nodes")
def hardware_nodes() -> list[HardwareNode]:
    return [telemetry.build_node(busy=pipeline.any_active())]


@router.get("/hardware/nodes/{node_id}/telemetry")
def hardware_telemetry(node_id: str) -> list[TelemetrySample]:
    if node_id != telemetry.NODE_ID:
        raise _not_found("Node", node_id)
    return list(bus.telemetry_history)


# --- settings --------------------------------------------------------------------


@router.get("/settings/api-keys")
def api_keys() -> list[ApiKey]:
    return [
        k.model_copy(update={"secret": None}) for k in store.api_keys.values()
    ]


@router.post("/settings/api-keys", status_code=201)
def create_api_key(body: CreateApiKeyRequest) -> ApiKey:
    secret = f"aa_live_{secrets.token_hex(16)}"
    key = ApiKey(
        id=store.next_id("key"),
        name=body.name,
        prefix=secret[:11] + "…",
        created_at=now_iso(),
        secret=secret,
    )
    store.api_keys[key.id] = key
    store.save()
    return key


@router.delete("/settings/api-keys/{key_id}", status_code=204)
def revoke_api_key(key_id: str) -> None:
    if key_id not in store.api_keys:
        raise _not_found("API key", key_id)
    del store.api_keys[key_id]
    store.save()
