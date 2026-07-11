# Backend Contract

> **Implemented:** the real FastAPI backend lives in [`../backend`](../backend)
> and passes this contract — start it with uvicorn on :8000 and flip the env
> vars below. This document remains the specification.

The specification the FastAPI backend must implement for this frontend to work
unmodified. The single source of truth for every payload shape is
[`src/lib/api/types.ts`](src/lib/api/types.ts) — mirror those interfaces as
Pydantic models 1:1 (camelCase field names on the wire). The route map lives in
[`src/lib/api/endpoints.ts`](src/lib/api/endpoints.ts); the mock implementation
that today serves the UI ([`src/lib/mocks/handlers.ts`](src/lib/mocks/handlers.ts))
is a working reference for exact behavior.

**Connecting the real backend requires zero component changes:**

```bash
NEXT_PUBLIC_USE_MOCKS=false
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000
```

## Conventions

- Base path: `/api/v1`. JSON everywhere.
- Errors: non-2xx with body `{ status, code, message }` (`ApiErrorBody`).
- List endpoints marked *paginated* return `Paginated<T>`:
  `{ items, total, page, pageSize }`, controlled by `?page=&pageSize=`
  (defaults 1 / 50).
- Timestamps are ISO-8601 strings.
- Auth: when the backend runs with `AA_API_KEY` set (any publicly exposed
  node — deploy_mi300x.sh mints one), every `/api/v1` route requires
  `Authorization: Bearer <key>` (or `X-API-Key: <key>`) and returns the
  standard 401 `ApiErrorBody` otherwise; WebSocket routes take the key as
  `?token=<key>` (browsers can't set WS headers) and close with code 1008
  on a bad token. `/files/**` (images, thumbnails, exported weights) stays
  public by design — `<img>` tags and download links can't send headers.
  An empty `AA_API_KEY` leaves the backend open for same-machine dev.
  Besides the root `AA_API_KEY`, any per-person key minted via
  `POST /settings/api-keys` (`aa_live_…`, secret returned once)
  authenticates both REST and WS; `DELETE /settings/api-keys/{id}`
  revokes it immediately — hand each teammate/judge their own key
  instead of sharing the root.
  The UI stores the endpoint + key at runtime (Hardware page → "Connect
  AMD Developer Cloud") and attaches them to every request — no env flip
  or rebuild needed. User login stays mocked client-side; org scoping is
  still single-tenant.

## REST endpoints

### Dashboard
| Method | Path | Request → Response |
|---|---|---|
| GET | `/dashboard/stats` | → `DashboardStats` |

### Tenancy
| Method | Path | Request → Response |
|---|---|---|
| GET | `/organizations` | → `Organization[]` |
| GET | `/organizations/{orgId}/members` | → `Member[]` |
| GET | `/projects` | → `Project[]` |
| POST | `/projects` | `CreateProjectRequest` → `Project` (201; classes slugified, e.g. "solder bridge" → "solder_bridge") |
| GET | `/projects/{id}` | → `Project` |
| DELETE | `/projects/{id}` | → 204. Cascade: the project's runs (logs + files), the datasets/models those runs produced (kept if another surviving run references them), and its feedback. 409 while a run is active. |
| GET | `/projects/{id}/feedback` | → `FoundryFeedback[]` (playground hard cases, newest first) |
| POST | `/projects/{id}/feedback` | `CreateFeedbackRequest` → `FoundryFeedback` (201; consumed by the project's next run) |

### Runs
| Method | Path | Request → Response |
|---|---|---|
| GET | `/runs` | → `Paginated<PipelineRun>` (newest first) |
| POST | `/runs` | `CreateRunRequest` → `PipelineRun` (201, status `queued`) |
| GET | `/runs/{id}` | → `PipelineRun` |
| POST | `/runs/{id}/cancel` | → `PipelineRun` (status `cancelled`) |
| GET | `/runs/{id}/agents` | → `AgentInstance[]` (current states) |
| GET | `/runs/{id}/logs` | → `LogEvent[]` (history; live tail is on the WebSocket) |
| GET | `/runs/{id}/preview` | → `RunPreviewImage[]` (images generated so far; the UI polls ~2 s while running) |
| POST | `/runs/estimate` | `CreateRunRequest` → `CostEstimate` (dry run, no side effects) |

Notes: `CreateRunRequest` is a union on `source.path` (`"synthetic"` |
`"byod"`). BYOD runs skip the `prompt_expansion` and `synthesis` stages. On
success the backend sets `datasetId` and `modelId` on the run.
`source.generator` (`"flux"` | `"sdxl"`) is the user's explicit choice and
is honored verbatim: a node that can't run FLUX (VRAM below
`FLUX_MIN_VRAM_GB`, or no GPU) rejects the run with a 400 at creation —
there is no server-side fallback to SDXL.
`training.architecture` accepts the YOLOv10 / YOLO11 / YOLO26 families
(n·s·m·l·x each) plus `rtdetr-l` / `rtdetr-x` — the `Architecture` union in
types.ts is the source of truth; `/runs/estimate` prices bigger
architectures higher. `training.task` (`detect` default | `segment` | `obb`
| `pose`) picks the model head: segment/obb reuse the Critic-verified mask
polygons, pose keypoints come from a pretrained teacher at compile time,
and non-detect tasks require YOLO11/YOLO26 (400 otherwise). Verified boxes
carry an optional `polygon` (flat normalized pairs).

**Pipeline mode.** The backend sets `PipelineRun.pipelineMode` at run
creation from its hardware config (`PIPELINE_MODE`), never from the request:
`"sequential"` (default — agents take turns owning the GPU) or
`"streaming"` (MI300X — synthesis → vision → critic overlap as
producer/consumer streams on the resident swarm; training still runs last).
The field is optional; runs recorded before it existed mean `"sequential"`.
Stage semantics in streaming mode (the `PipelineStage` enum is unchanged):
`run.stage` is the earliest stage that still has pending items (the
bottleneck stage), and `StageTransition` events still fire in order as each
stage fully drains — so a stage tracker driven by transitions stays correct.
While the overlap is active, `RunProgress.imagesAnnotated` reports Vision
Agent throughput separately from the critic's `masksAccepted`, and all
three middle agents report `state: "working"` concurrently.

**Vision backend.** `CreateRunRequest.visionBackend` (`"sam3" | "yoloe"`,
optional) picks the zero-shot labeler for the run; omitted means the node's
`VISION_BACKEND` default. Honored verbatim, like the generator: a node that
can't run the selection (SAM 3 needs the `.venv-sam3` sidecar runtime and
gated-checkpoint access) rejects the run at creation with a 400 whose
message contains the setup steps — never a silent substitution. The backend
echoes the resolved choice as `PipelineRun.visionBackend` (absent on runs
recorded before the field existed).

### Foundry
| Method | Path | Request → Response |
|---|---|---|
| POST | `/foundry/expand-prompt` | `ExpandPromptRequest` → `ExpandPromptResponse` |
| POST | `/foundry/preview-images` | `PreviewImagesRequest` → `PreviewImagesResponse` |

The Prompt Agent (Gemma 4 via vLLM on the MI300X) takes the USE CASE — what
the model is for, in the user's words ("my drone needs to detect rotten
potatoes") — infers the deployment viewpoint and environment, and designs
the domain-randomized scene prompts itself; `previewCount` caps the sample
returned (UI sends 8, cap at 12). When `projectId` is set, the project's
pending playground feedback (unconsumed `FoundryFeedback`) is folded into
the design so the preview matches what the launched run will generate.
Wire compat: `useCase` replaced the pre-v0.5 `basePrompt` field; the
backend still accepts the old name on input and always serializes the new
one.

`/foundry/preview-images` is the Synthesis Agent's dry-run: it designs
`count` scene prompts (default 3, cap 4) the same way, paints one image
per prompt with the chosen `generator`, and returns `RunPreviewImage[]`
with public `/files/previews/...` URLs. The generator choice is honored
verbatim like a real run — a node that can't run FLUX answers 409 instead
of substituting. Previews are throwaways; the backend keeps only the ~20
most recent preview folders.

### Datasets
| Method | Path | Request → Response |
|---|---|---|
| GET | `/datasets` | → `Paginated<Dataset>` (newest first, `?page=&pageSize=`) |
| GET | `/datasets/{id}` | → `Dataset` |
| GET | `/datasets/{id}/images` | → `Paginated<AnnotatedImage>` |
| GET | `/datasets/{id}/analytics` | → `DatasetAnalytics` (class distribution, split balance, coverage-weighted label heatmap, image dimensions) |
| PATCH | `/datasets/{datasetId}/images/{imageId}` | `CurateImageRequest` → `AnnotatedImage` |
| POST | `/datasets/upload` | `{ archiveName, sizeMb }` → `Dataset` (201) |
| POST | `/datasets/{id}/export` | `DatasetExportRequest` (`{ format: "yolo" \| "coco" \| "voc" \| "csv" }`) → `{ downloadUrl }` (zip; accepted labeled images only; 409 if none; Label Studio format parity) |

Note: `/datasets/upload` accepts both the JSON registration above and a real
multipart upload (field `archive`) — the UI sends multipart with genuine
progress when mocks are off, and the backend extracts the archive for the
pipeline. The archive may contain, in any mix:

- **images** (jpg/png/bmp/webp) — labeled by the swarm as usual;
- **videos** (mp4/mov/avi/mkv/webm) — sampled to ≤ `VIDEO_MAX_FRAMES` evenly
  spaced frames each (`Dataset.videoFrameCount`); a bare video file also
  uploads without zipping;
- **YOLO txt or COCO json annotations** — parsed and recorded as
  `Dataset.importedLabels`; a run on such a dataset runs in **audit mode**:
  the Vision Agent yields, the Critic audits the provided boxes (bounds,
  degenerate area, aspect ratio, duplicates + the VLM semantic spot-check)
  and the run's `targetClasses` are overridden with the labels' class names.

Bounding boxes are YOLO-normalized (`cx cy w h` ∈ 0–1).

### Models
| Method | Path | Request → Response |
|---|---|---|
| GET | `/models` | → `ModelArtifact[]` |
| GET | `/models/{id}` | → `ModelArtifact` |
| POST | `/models/{id}/export` | `{ format: "pt" \| "onnx" \| "torchscript" \| "openvino" }` → `{ downloadUrl }` (openvino downloads as a zipped model dir) |
| POST | `/models/{id}/predict` | multipart (field `image`) → `PredictionResult` (live inference with the trained weights; classify models return one full-frame box carrying the top-1 class + confidence) |

`TrainingConfig.task` accepts `detect · segment · obb · pose · classify`
(non-detect requires YOLO11/YOLO26). `classify` trains on per-class crops cut
from the Critic-verified boxes; its `ModelMetrics` carry `top1`/`top5` and its
curve points carry per-epoch `top1` (mAP/precision/recall are 0), and
`ModelArtifact.classes` follows the sorted crop-folder order.

### Hardware
| Method | Path | Request → Response |
|---|---|---|
| GET | `/hardware/nodes` | → `HardwareNode[]` |
| GET | `/hardware/nodes/{nodeId}/telemetry` | → `TelemetrySample[]` (recent history, ~30 min @ 15 s) |

`HardwareNode.residentModels` lists the models currently held in VRAM when
the node runs with `KEEP_MODELS_WARM` (e.g. `["Gemma 4 26B MoE (vLLM)",
"FLUX.2-klein", "SAM 3"]`) — the "resident swarm" readout. Absent or
empty on sequential nodes that load-and-flush per stage.

### Settings
| Method | Path | Request → Response |
|---|---|---|
| GET | `/settings/api-keys` | → `ApiKey[]` |
| POST | `/settings/api-keys` | `{ name }` → `ApiKey` (201; full secret returned once) |
| DELETE | `/settings/api-keys/{id}` | → 204 |

## WebSocket endpoints

JSON text frames; every message is a tagged union on `kind`. Event payload
types are in [`src/lib/api/streams.ts`](src/lib/api/streams.ts).

### `/ws/v1/runs/{runId}/events` — `RunStreamEvent`

```jsonc
{ "kind": "log",      "payload": LogEvent }          // agent reasoning / critic verdicts / gpu events
{ "kind": "stage",    "payload": StageTransition }   // pipeline stage changed
{ "kind": "agent",    "payload": AgentInstance }     // an agent's state/task changed
{ "kind": "progress", "payload": RunProgress }       // counters + overall pct
{ "kind": "status",   "payload": { "runId", "status": RunStatus } }
```

Expected cadence (what the UI is tuned for): logs up to a few per second;
progress ~1–2/s; agent + stage events on change. `LogEvent.level` includes
`critic` (verdicts, message prefixed `ACCEPT`/`REJECT`), `stage` (banners) and
`gpu` (VRAM orchestration, e.g. `hip.empty_cache()` flushes) — the terminal
color-codes these.

### `/ws/v1/hardware/{nodeId}/telemetry` — `TelemetryStreamEvent`

```jsonc
{ "kind": "telemetry", "payload": TelemetrySample }  // 1 Hz
```

## Consistency requirements

The UI assumes REST and stream views of the same run never disagree:

1. Events must be reflected in subsequent REST reads (the UI refetches
   `GET /runs/{id}` and `/logs` after reconnects and on invalidation).
2. On terminal status (`succeeded`), the run's `datasetId`/`modelId` must
   already resolve — the UI immediately offers navigation to both.
3. `GET /runs/{id}/logs` returns history including lines already streamed;
   the UI dedupes by `LogEvent.id`, so ids must be stable and unique.
4. Cancellation via REST must stop the stream with a final
   `status: cancelled` event.
