"""Every REST route from BACKEND_CONTRACT.md / endpoints.ts, 1:1."""

import secrets
from pathlib import Path

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
    CreateFeedbackRequest,
    CreateProjectRequest,
    CreateRunRequest,
    CurateImageRequest,
    DashboardStats,
    Dataset,
    DatasetAnalytics,
    DatasetExportRequest,
    ExpandPromptRequest,
    ExpandPromptResponse,
    ExportRequest,
    ExportResponse,
    FoundryFeedback,
    HardwareNode,
    LogEvent,
    Member,
    ModelArtifact,
    Organization,
    Paginated,
    PipelineRun,
    PredictionResult,
    PipelineStage,
    PreviewImagesRequest,
    PreviewImagesResponse,
    Project,
    RunPreviewImage,
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


@router.post("/projects", status_code=201)
def create_project(body: CreateProjectRequest) -> Project:
    name = body.name.strip()
    # YOLO-friendly class slugs, same shape as the seeded projects.
    classes = [c.strip().lower().replace(" ", "_")
               for c in body.target_classes if c.strip()]
    if not name or not classes:
        raise HTTPException(400, "name and at least one target class are required")
    project = Project(
        id=store.next_id("proj"), org_id=store.organizations[0].id,
        name=name[:80], description=body.description.strip()[:300],
        target_classes=classes[:8], created_at=now_iso(),
    )
    store.projects.append(project)
    store.save()
    return project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    """Cascade-delete a project: its runs (logs, workdirs, generated
    files), the datasets and models those runs produced — unless another
    surviving run references them — and its playground feedback. Refused
    (409) while any of the project's runs is still active."""
    import shutil

    from .config import DATA_DIR

    if not any(p.id == project_id for p in store.projects):
        raise _not_found("Project", project_id)
    doomed = [r for r in store.runs.values() if r.project_id == project_id]
    active = [r.id for r in doomed if r.status in ("queued", "running", "paused")]
    if active:
        raise HTTPException(
            409, f"Project has active runs ({', '.join(active)}) — cancel "
                 "them before deleting.")

    surviving = [r for r in store.runs.values() if r.project_id != project_id]
    keep_ds = {r.dataset_id for r in surviving if r.dataset_id}
    keep_models = {r.model_id for r in surviving if r.model_id}

    def rm(path: Path) -> None:
        shutil.rmtree(path, ignore_errors=True)

    for r in doomed:
        store.runs.pop(r.id, None)
        store.run_logs.pop(r.id, None)
        rm(DATA_DIR / "runs" / r.id)
        rm(DATA_DIR / "files" / "runs" / r.id)
        if r.dataset_id and r.dataset_id not in keep_ds:
            store.datasets.pop(r.dataset_id, None)
            store.images.pop(r.dataset_id, None)
            rm(DATA_DIR / "files" / "datasets" / r.dataset_id)
            rm(DATA_DIR / "byod" / r.dataset_id)
        if r.model_id and r.model_id not in keep_models:
            store.models.pop(r.model_id, None)
            rm(DATA_DIR / "files" / "models" / r.model_id)
            rm(DATA_DIR / "predictions" / r.model_id)
    store.feedback = {
        fid: f for fid, f in store.feedback.items()
        if f.project_id != project_id
    }
    store.projects = [p for p in store.projects if p.id != project_id]
    store.save()


@router.get("/projects/{project_id}/feedback")
def project_feedback(project_id: str) -> list[FoundryFeedback]:
    return sorted(
        (f for f in store.feedback.values() if f.project_id == project_id),
        key=lambda f: f.created_at, reverse=True,
    )


@router.post("/projects/{project_id}/feedback", status_code=201)
def create_feedback(project_id: str, body: CreateFeedbackRequest) -> FoundryFeedback:
    if not any(p.id == project_id for p in store.projects):
        raise _not_found("Project", project_id)
    if body.model_id not in store.models:
        raise _not_found("Model", body.model_id)
    fb = FoundryFeedback(
        id=store.next_id("fb"), project_id=project_id, model_id=body.model_id,
        note=body.note.strip()[:300], detections=body.detections,
        created_at=now_iso(),
    )
    store.feedback[fb.id] = fb
    store.save()
    return fb


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
    if (body.training.task != "detect"
            and not body.training.architecture.startswith(("yolo11", "yolo26"))):
        raise HTTPException(
            400, f"{body.training.task} needs a YOLO11 or YOLO26 architecture "
                 "— YOLOv10, RT-DETR and RF-DETR ship detection heads only")
    if body.training.architecture.startswith("rf-detr"):
        from .agents.rfdetr_bridge import SETUP_HINT, available

        if not available():
            raise HTTPException(400, SETUP_HINT)
    if body.source.path == "synthetic" and body.source.generator == "flux":
        # The generator is the user's explicit choice — a node that can't
        # honor it rejects the run instead of silently substituting SDXL.
        from .agents.synthesis_agent import flux_supported

        ok, why = flux_supported()
        if not ok:
            raise HTTPException(
                400, f"{settings.flux_model} can't run here: {why}. Pick "
                     "SDXL for this node, or attach a GPU with more VRAM.")
    # The labeler is the user's explicit choice too — reject if this node
    # can't honor it instead of silently substituting (audit runs have no
    # vision stage, so BYOD label-audit datasets are exempt below).
    vision_backend = body.vision_backend or settings.vision_backend
    if vision_backend == "sam3":
        from .agents.sam3_bridge import SETUP_HINT as SAM3_HINT, available as sam3_available

        if not sam3_available():
            raise HTTPException(400, SAM3_HINT)
    target_classes = body.target_classes
    audit_mode = False
    if body.source.path == "byod":
        # Imported-label datasets are audited: the labels' class ids define
        # the class list, so the run trains on exactly those names.
        imported = store.datasets[body.source.dataset_id].imported_labels
        if imported:
            target_classes = imported.class_names
            audit_mode = True
    # Streaming overlaps synthesis/vision/critic on the resident swarm.
    # Audit runs stay sequential — they're near-instant, no overlap to win.
    pipeline_mode = ("streaming"
                     if settings.pipeline_mode == "streaming" and not audit_mode
                     else "sequential")
    org = store.organizations[0]
    run = PipelineRun(
        id=store.next_id("run"),
        org_id=org.id,
        project_id=body.project_id,
        name=body.name,
        path=body.source.path,
        status="queued",
        stage="queued",
        pipeline_mode=pipeline_mode,
        vision_backend=vision_backend,
        source=body.source,
        training=body.training,
        target_classes=target_classes,
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


def _arch_factor(arch: str) -> float:
    """Relative training cost vs a nano YOLO; transformers are ~3×."""
    if arch.startswith("rf-detr"):
        return 4.5 if arch.endswith("large") else 3.0
    if arch.startswith("rtdetr"):
        return 3.0 if arch.endswith("l") else 4.5
    return {"n": 1.0, "s": 1.3, "m": 1.8, "l": 2.5, "x": 3.5}.get(arch[-1], 1.0)


def _estimate(body: CreateRunRequest) -> CostEstimate:
    """Heuristic dry-run pricing; mirrors the stage plan the orchestrator
    runs. Constants calibrated 2026-07-11 against real MI300X streaming
    runs (flagship 500 img / 60 ep / yolo26m: 37.5 min total, 30.2 min
    training; 50 img / 30 ep / yolo11n: 2-5 min): FLUX.2-klein ≈ 1.5 s and
    full SDXL ≈ 5 s per image, and a training epoch costs a fixed ~3 s of
    validation overhead plus ~0.03 s per image scaled by architecture."""
    epochs = min(body.training.epochs, settings.max_epochs)
    factor = _arch_factor(body.training.architecture)

    def train_min(images: int) -> float:
        return epochs * (0.05 + images * 0.0005 * factor)

    if body.source.path == "synthetic":
        images = min(body.source.randomization.image_count, settings.max_images_per_run)
        gen_s = 1.5 if getattr(body.source, "generator", "sdxl") == "flux" else 5.0
        stages: list[tuple[PipelineStage, float]] = [
            ("prompt_expansion", 0.3),
            ("synthesis", images * gen_s / 60),
            ("segmentation", images * 0.3 / 60),
            ("critic_review", images * 0.2 / 60),
            ("dataset_compile", 0.3),
            ("training", train_min(images)),
        ]
    else:
        images = body.source.image_count
        stages = [
            ("segmentation", images * 0.3 / 60),
            ("critic_review", images * 0.2 / 60),
            ("dataset_compile", 0.3),
            ("training", train_min(images)),
        ]
    total_min = sum(m for _, m in stages)
    return CostEstimate(
        gpu_minutes=round(total_min, 1),
        estimated_usd=round(total_min * settings.gpu_usd_per_min, 2),
        usd_per_hour=round(settings.gpu_usd_per_min * 60, 2),
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


@router.get("/runs/{run_id}/preview")
def run_preview(run_id: str) -> list[RunPreviewImage]:
    """Images the Synthesis Agent has produced so far (poll while running)."""
    import json as _json

    from .config import DATA_DIR

    if run_id not in store.runs:
        raise _not_found("Run", run_id)
    manifest_path = DATA_DIR / "files" / "runs" / run_id / "preview.json"
    if not manifest_path.exists():
        return []
    entries = _json.loads(manifest_path.read_text(encoding="utf-8"))
    base = f"{settings.public_base_url}/files/runs/{run_id}"
    return [
        RunPreviewImage(
            file_name=e["fileName"],
            url=f"{base}/{e['fileName']}",
            scenario=e.get("scenario"),
        )
        for e in entries
    ]


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: str) -> None:
    """Delete one run and what it produced: its logs, workdirs and generated
    files, plus its dataset and model — unless another surviving run
    references them. Active runs must be cancelled first (409)."""
    import shutil

    from .config import DATA_DIR

    run = store.runs.get(run_id)
    if run is None:
        raise _not_found("Run", run_id)
    if run.status in ("queued", "running", "paused"):
        raise HTTPException(409, "Run is active — cancel it before deleting.")

    surviving = [r for r in store.runs.values() if r.id != run_id]
    keep_ds = {r.dataset_id for r in surviving if r.dataset_id}
    keep_models = {r.model_id for r in surviving if r.model_id}

    def rm(path: Path) -> None:
        shutil.rmtree(path, ignore_errors=True)

    store.runs.pop(run_id, None)
    store.run_logs.pop(run_id, None)
    rm(DATA_DIR / "runs" / run_id)
    rm(DATA_DIR / "files" / "runs" / run_id)
    if run.dataset_id and run.dataset_id not in keep_ds:
        store.datasets.pop(run.dataset_id, None)
        store.images.pop(run.dataset_id, None)
        rm(DATA_DIR / "files" / "datasets" / run.dataset_id)
        rm(DATA_DIR / "byod" / run.dataset_id)
    if run.model_id and run.model_id not in keep_models:
        store.models.pop(run.model_id, None)
        rm(DATA_DIR / "files" / "models" / run.model_id)
        rm(DATA_DIR / "predictions" / run.model_id)
    store.save()


# --- foundry ---------------------------------------------------------------------


@router.post("/foundry/expand-prompt")
async def expand_prompt(body: ExpandPromptRequest) -> ExpandPromptResponse:
    preview = min(body.preview_count or 8, 12)
    hard_cases = [
        f.note for f in store.feedback.values()
        if f.project_id == body.project_id and f.consumed_by_run_id is None
    ] if body.project_id else []
    scenarios = await prompt_agent.expand_async(
        use_case=body.use_case,
        target_classes=body.target_classes,
        randomization=body.randomization,
        count=preview,
        hard_cases=hard_cases,
    )
    return ExpandPromptResponse(
        scenarios=scenarios,
        total_scenarios=body.randomization.scenario_count,
        model=prompt_agent.model_label,
        provider=prompt_agent.provider_label,
    )


@router.post("/foundry/preview-images")
async def preview_images(body: PreviewImagesRequest) -> PreviewImagesResponse:
    """Synthesis dry-run for the builder: design a few scene prompts, paint
    one image each, and serve them from /files — before any run exists."""
    import shutil
    import uuid

    from fastapi.concurrency import run_in_threadpool

    from .agents.synthesis_agent import flux_supported, synthesis_agent
    from .config import DATA_DIR

    if body.generator == "flux":
        ok, why = flux_supported()
        if not ok:
            raise HTTPException(409, f"FLUX cannot run here — {why}")

    count = max(1, min(body.count or 3, 4))
    scenarios = await prompt_agent.expand_async(
        use_case=body.use_case,
        target_classes=body.target_classes,
        randomization=body.randomization,
        count=count,
        hard_cases=[],
    )
    scenarios = (scenarios or [body.use_case])[:count]

    previews_root = DATA_DIR / "files" / "previews"
    # Previews are throwaways — keep only the most recent handful around.
    if previews_root.exists():
        stale = sorted(
            (d for d in previews_root.iterdir() if d.is_dir()),
            key=lambda d: d.stat().st_mtime,
        )[:-19]
        for old in stale:
            shutil.rmtree(old, ignore_errors=True)

    token = uuid.uuid4().hex[:10]
    try:
        paths, model_id = await run_in_threadpool(
            synthesis_agent.preview, body.generator, scenarios,
            previews_root / token,
        )
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    base = f"{settings.public_base_url}/files/previews/{token}"
    return PreviewImagesResponse(
        images=[
            RunPreviewImage(file_name=p.name, url=f"{base}/{p.name}", scenario=s)
            for p, s in zip(paths, scenarios)
        ],
        model=model_id,
    )


# --- datasets --------------------------------------------------------------------


@router.get("/datasets")
def datasets(page: int = 1, pageSize: int = 50) -> Paginated[Dataset]:
    items = sorted(store.datasets.values(), key=lambda d: d.created_at, reverse=True)
    return Paginated[Dataset].model_validate(_paginate(items, page, pageSize))


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


@router.get("/datasets/{dataset_id}/analytics")
def dataset_analytics(dataset_id: str) -> DatasetAnalytics:
    ds = store.datasets.get(dataset_id)
    if ds is None:
        raise _not_found("Dataset", dataset_id)
    from .agents.dataset_analytics import compute_analytics

    return compute_analytics(ds, store.images.get(dataset_id, []))


@router.post("/datasets/{dataset_id}/export")
def export_dataset_route(dataset_id: str, body: DatasetExportRequest) -> ExportResponse:
    ds = store.datasets.get(dataset_id)
    if ds is None:
        raise _not_found("Dataset", dataset_id)
    from .agents.dataset_export import export_dataset

    try:
        url = export_dataset(ds, store.images.get(dataset_id, []), body.format)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return ExportResponse(download_url=url)


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

    try:
        url = export_artifact(artifact, body.format)
    except Exception as exc:  # exporter deps install on demand and can fail
        raise HTTPException(502, f"{body.format} export failed: {exc}")
    return ExportResponse(download_url=url)


@router.post("/models/{model_id}/predict")
async def predict(model_id: str, request: Request) -> PredictionResult:
    """Live inference with the trained weights (multipart field "image")."""
    import uuid

    from .agents.mlops_agent import run_inference
    from .config import DATA_DIR

    artifact = store.models.get(model_id)
    if artifact is None:
        raise _not_found("Model", model_id)
    form = await request.form()
    image = form.get("image")
    if not isinstance(image, UploadFile):
        raise HTTPException(400, "multipart field 'image' is required")
    suffix = Path(image.filename or "upload.jpg").suffix.lower() or ".jpg"
    if suffix not in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
        raise HTTPException(400, f"unsupported image type '{suffix}'")
    pred_dir = DATA_DIR / "predictions" / model_id
    pred_dir.mkdir(parents=True, exist_ok=True)
    image_path = pred_dir / f"{uuid.uuid4().hex}{suffix}"
    image_path.write_bytes(await image.read())
    try:
        import asyncio

        result = await asyncio.to_thread(run_inference, artifact, image_path)
    finally:
        image_path.unlink(missing_ok=True)
    return PredictionResult.model_validate(result)


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
