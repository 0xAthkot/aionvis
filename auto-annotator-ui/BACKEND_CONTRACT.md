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
- Auth: TBD (the UI currently mocks login). Reserve `Authorization: Bearer`
  handling; every route below is org-scoped by the authenticated principal.

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
`training.architecture` accepts the YOLOv10 / YOLO11 / YOLO26 families
(n·s·m·l·x each) plus `rtdetr-l` / `rtdetr-x` — the `Architecture` union in
types.ts is the source of truth; `/runs/estimate` prices bigger
architectures higher. `training.task` (`detect` default | `segment` | `obb`
| `pose`) picks the model head: segment/obb reuse the Critic-verified mask
polygons, pose keypoints come from a pretrained teacher at compile time,
and non-detect tasks require YOLO11/YOLO26 (400 otherwise). Verified boxes
carry an optional `polygon` (flat normalized pairs).

### Foundry
| Method | Path | Request → Response |
|---|---|---|
| POST | `/foundry/expand-prompt` | `ExpandPromptRequest` → `ExpandPromptResponse` |

The Prompt Agent (Gemma 4 via Fireworks AI) expands the base prompt into
domain-randomized scenario prompts; `previewCount` caps the sample returned
(UI sends 8, cap at 12). When `projectId` is set, the project's pending
playground feedback (unconsumed `FoundryFeedback`) is folded into the
expansion so the preview matches what the launched run will generate.

### Datasets
| Method | Path | Request → Response |
|---|---|---|
| GET | `/datasets` | → `Dataset[]` |
| GET | `/datasets/{id}` | → `Dataset` |
| GET | `/datasets/{id}/images` | → `Paginated<AnnotatedImage>` |
| PATCH | `/datasets/{datasetId}/images/{imageId}` | `CurateImageRequest` → `AnnotatedImage` |
| POST | `/datasets/upload` | `{ archiveName, sizeMb }` → `Dataset` (201) |
| POST | `/datasets/{id}/export` | `DatasetExportRequest` (`{ format: "yolo" \| "coco" \| "voc" \| "csv" }`) → `{ downloadUrl }` (zip; accepted labeled images only; 409 if none; Label Studio format parity) |

Note: `/datasets/upload` accepts both the JSON registration above and a real
multipart upload (field `archive`, a .zip of images) — the UI sends multipart
with genuine progress when mocks are off, and the backend extracts the archive
for the pipeline. Bounding boxes are YOLO-normalized (`cx cy w h` ∈ 0–1).

### Models
| Method | Path | Request → Response |
|---|---|---|
| GET | `/models` | → `ModelArtifact[]` |
| GET | `/models/{id}` | → `ModelArtifact` |
| POST | `/models/{id}/export` | `{ format: "pt" \| "onnx" \| "torchscript" \| "openvino" }` → `{ downloadUrl }` (openvino downloads as a zipped model dir) |
| POST | `/models/{id}/predict` | multipart (field `image`) → `PredictionResult` (live inference with the trained weights) |

### Hardware
| Method | Path | Request → Response |
|---|---|---|
| GET | `/hardware/nodes` | → `HardwareNode[]` |
| GET | `/hardware/nodes/{nodeId}/telemetry` | → `TelemetrySample[]` (recent history, ~30 min @ 15 s) |

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
