# HANDOFF — Auto-Annotator v0.4

Context document for anyone (human or Claude) continuing this project.
Written 2026-07-08 after the v0.4 feature push. Read this top to bottom
before changing code.

## What this is

**Auto-Annotator** — AMD Developer Hackathon ACT II, Unicorn Track. An
autonomous agent swarm (Prompt → Synthesis → Vision → Critic → MLOps) that
turns one sentence into a trained, deployable detection model: it generates
synthetic training images (SDXL), labels them (open-vocab segmentation),
verifies its own labels (geometric + VLM critic), and trains the detector.
Zero human annotation. The competitor to beat is Ultralytics Annotate /
Label Studio ("AI-assisted humans"); our story is "0× humans".

Judging criteria: creativity/originality, completeness, product/market
potential, meaningful AMD platform use. Pitch lives in `PITCH.md`, demo
script in `auto-annotator-ui/DEMO.md`.

## Repo layout

| Path | What |
|---|---|
| `auto-annotator-ui/` | Next.js 16 app: marketing landing at `/`, console at `/dashboard`. Runs standalone on an in-browser mock (MSW) or against the real backend with one env flip. |
| `backend/` | FastAPI + the real agent swarm. Implements `auto-annotator-ui/BACKEND_CONTRACT.md`. |
| `backend/rfdetr_worker.py` | RF-DETR sidecar — runs in its own venv (see below). |
| `docker-compose.yml` | Full stack for judges. **Never tested on a machine with Docker — verify before the demo.** |

## The one rule: contract-first

`auto-annotator-ui/src/lib/api/types.ts` is the single source of truth for
every payload. It is mirrored 1:1 in `backend/app/schemas.py` (Pydantic,
snake_case + camelCase aliases). Every new endpoint/field touches, in order:
**types.ts → endpoints.ts → MSW handlers (`src/lib/mocks/handlers.ts`) →
Pydantic schema → backend route → BACKEND_CONTRACT.md row.** Components may
only import from `src/lib/api` — never from mocks.

## Setup on a fresh Windows machine

Install: **git**, **Node 22+**, **Python 3.12**.

```powershell
# Frontend — works with ZERO backend (in-browser mock)
cd auto-annotator-ui
npm install
npm run dev          # http://localhost:3000 — landing at /, console at /dashboard
```

The UI runs fully on the MSW mock when `NEXT_PUBLIC_USE_MOCKS=true` (see
`.env.local.example` / `README.md`). **This is the recommended mode for
UI work with no GPU** — every screen, run simulation included, works.

```powershell
# Backend — CPU-only install (no NVIDIA GPU needed)
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\pip install -r requirements-ml.txt   # diffusers/transformers pins — do not upgrade
$env:PYTHONIOENCODING='utf-8'                       # REQUIRED on Windows consoles
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

LLM: there are no API keys or third-party LLM services anymore (the old
Fireworks AI integration was removed 2026-07-08). Copy
`backend/.env.example` → `backend/.env`; the Prompt Agent and Semantic
Critic talk to any OpenAI-compatible endpoint at `LLM_BASE_URL` (default:
Gemma via vLLM on localhost:8001 — the MI300X profile). While that endpoint
is unreachable the Prompt Agent degrades to a deterministic template
fallback and the semantic critic is skipped — everything still runs.

Preflight: `backend/smoke_test.py` checks every endpoint + LLM + inference;
run it before any demo. `backend/reset_demo.py` resets demo state.

## Working WITHOUT a local GPU (your situation)

1. **UI / product work:** use mock mode. No backend, no GPU, everything works.
2. **Backend logic work:** the CPU torch install above runs the whole
   pipeline — slowly. Set `MAX_IMAGES_PER_RUN=2` and `MAX_EPOCHS=5` in
   `backend/.env` so a run finishes in minutes. Playground inference on CPU
   is fine (~1 s/image).
3. **Real training / inference — the intended path:** run the backend on a
   remote GPU (AMD Developer Cloud MI300X; credits were expected
   ~2026-07-08). `backend/deploy_mi300x.sh` is the one-shot setup — it also
   mints an `AA_API_KEY` and prints the endpoint + key. Attach the UI **at
   runtime**: Hardware page → "Connect AMD Developer Cloud" → paste URL +
   key → Connect. Every screen and live stream switches to the node — no
   env flip, no rebuild, works even from mock mode. (The env-var route
   still exists for permanent wiring:
   `NEXT_PUBLIC_API_BASE_URL=http://<remote>:8000`,
   `NEXT_PUBLIC_WS_BASE_URL=ws://<remote>:8000`,
   `NEXT_PUBLIC_USE_MOCKS=false` in `auto-annotator-ui/.env.local` — note
   env mode sends no API key, so it's for open same-network nodes only.)
   The MI300X model lineup (decided 2026-07-08): Gemma 3 27B-IT via vLLM
   (the `LLM_BASE_URL` default — Prompt Agent + Semantic Critic + model
   cards; counts for the "Best Use of Gemma" challenge), FLUX.1-schnell
   synthesis (wired; runs default to `generator: "flux"` and fall back to
   SDXL below `FLUX_MIN_VRAM_GB` — before downloading anything), SAM 3
   vision backend (`VISION_BACKEND=sam3`, gated checkpoint; YOLOE
   fallback). Utilization knobs: `MAX_BATCH_SIZE`, `MAX_TRAIN_IMAGE_SIZE`,
   `KEEP_MODELS_WARM` (deploy_mi300x.sh sets 96 / 1024 / true) plus the
   parallel-swarm profile: `PIPELINE_MODE=streaming`, `GPU_SLOTS=2`,
   `AUTO_BATCH=true`.

## What v0.4 can do (all verified live)

- **22 trainable architectures**: YOLOv10/YOLO11/YOLO26 (n·s·m·l·x each),
  RT-DETR (l/x), RF-DETR (nano/small/medium/base/large).
- **5 task types** (`training.task`): detect · segment · obb · pose ·
  classify. Segment/OBB reuse the Critic-verified mask polygons
  (`BoundingBox.polygon`); pose keypoints come from a `yolo11m-pose`
  teacher at compile time; classify trains YOLO-cls on per-class crops cut
  from the verified boxes (metrics: top1/top5; classes follow sorted crop
  folders). Non-detect requires YOLO11/YOLO26.
- **Model exports**: .pt, ONNX, TorchScript, OpenVINO (RF-DETR: .pt + ONNX).
- **Dataset exports**: YOLO, COCO (with segmentation), Pascal VOC, CSV —
  Label Studio format parity.
- **BYOD ingestion, three flavors** (one upload endpoint): plain images
  (swarm labels them); **YOLO/COCO-labeled archives** → audit mode (Vision
  Agent yields, the Critic audits the provided labels, `targetClasses` come
  from the labels — see `label_audit.py`); **videos** (in the zip or bare) →
  ≤ `VIDEO_MAX_FRAMES` evenly-sampled frames each.
- **Dataset analytics** (`GET /datasets/{id}/analytics` + dataset page):
  class distribution, split balance, coverage-weighted label heatmap,
  dimension stats. Mock (`mocks/analytics.ts`) and backend
  (`dataset_analytics.py`) compute identically.
- **Experiment comparison**: tick 2–4 models in the registry →
  `/models/compare` — metric table with best-in-row trophies + overlaid
  mAP/loss/top-1 curves. Pure frontend over `GET /models`.
- **Simple/Pro modes** (Coinbase pattern): capability parity, Simple only
  removes jargon and mandatory decisions. Doctrine: rename/explain/disclose,
  NEVER hide features. Fresh browsers default to Simple; DEMO.md needs Pro.
- **Parallel swarm** (`PIPELINE_MODE=streaming`, the AMD-unique pitch):
  synthesis → vision → critic overlap as bounded producer/consumer streams
  on one card holding the whole swarm resident (requires
  `KEEP_MODELS_WARM=true`); training joins after the streams drain.
  `run.pipelineMode` on the wire; Mission Control shows concurrent lanes;
  `GPU_SLOTS` runs share the card; `AUTO_BATCH` sizes the training batch to
  the VRAM actually free. Sequential mode (default) is exactly the old
  pipeline. Verified on CPU (unit tests, streaming BYOD e2e with
  interleaved logs, 2-slot concurrency, sequential regression); real VRAM
  co-residency and FLUX/SAM3/vLLM concurrency are first exercised on the
  MI300X. Landing page has the two-mode visual; the mock simulates both.
- **API-key auth + runtime node attach** (the credential-day feature):
  `AA_API_KEY` in the backend .env protects `/api/v1` (Bearer / X-API-Key)
  and `/ws/v1` (`?token=`); empty = open for same-machine dev; `/files`
  stays public (img tags can't send headers). The UI attaches a node at
  runtime — Hardware → "Connect AMD Developer Cloud" (also in Settings →
  Integrations): health check, persisted in localStorage, all REST +
  WebSockets switch instantly, Disconnect returns to the local source.
  Verified: 11 pytest cases + a 16-check Playwright e2e that attached a
  keyed local backend from mock mode, launched a real audit run through
  the UI, and streamed it over the authenticated WebSocket.
- Active learning (playground "Send to Foundry" → next run targets it),
  live WebSocket Mission Control, cost estimates, GPU queue.

## RF-DETR sidecar (important)

`rfdetr` requires `transformers>=5`, which **breaks the pinned SDXL stack**
(transformers 5.x mis-sizes the OpenCLIP-bigG encoder under diffusers 0.39).
NEVER `pip install rfdetr` into `backend/.venv`. It lives in
`backend/.venv-rfdetr` (setup commands in README) and the backend shells out
to `rfdetr_worker.py` (tagged-line protocol INFO/EPOCH/RESULT). Missing venv
→ RF-DETR runs are rejected with setup instructions; all else unaffected.

## Hard-won gotchas (each cost real debugging time)

- `transformers` must stay `<5` in the main venv (see above).
- **No first-party `import cv2`** — the swarm's geometry is pure
  numpy/scipy (`app/agents/geometry.py`: RDP simplify, rotating-calipers
  min-area rect, Moore-neighbor mask tracing) and video ingestion is
  imageio/ffmpeg. opencv-python still arrives transitively with
  ultralytics; do not add first-party usages back.
- YOLOE zero-shot is near-blind on: dense PCB macro shots, high-altitude
  aerial views, and the class "pedestrian" (people on bikes → cyclist).
  It is solid on warehouse forklift/pallet/worker. The proven demo prompt:
  "a yellow forklift moving wooden pallets in a busy warehouse aisle with
  workers in safety vests".
- The semantic critic (VLM) will honestly kill a whole run if crops don't
  look like their labels — farm prompts need low side-angle framing.
- YOLO cls confidence is ~0 below ~40 epochs on tiny datasets even when
  mAP50 looks fine; showcase models need ≥60 epochs / 48 images.
  `backend/.env` `MAX_EPOCHS` OVERRIDES `app/config.py`.
- Windows: run Python with `PYTHONIOENCODING=utf-8` (cp1252 crashes on
  em-dashes and lightning's rich tables). `workers=0` for ultralytics
  training in threads. PS 5.1: multi-line commits via `git commit -F file`.
- Turbopack dev cache corrupts on unclean shutdown → delete
  `auto-annotator-ui/.next` and restart.
- Next 16 strict lint: no synchronous setState in effects.
- Chart colors must pass the dataviz validator against `#1c1c1c`;
  class palette in `src/lib/class-colors.ts`.
- An old backend process re-saves `state.json` without newer keys — always
  confirm the running backend is current code before debugging "lost" data.
- rfdetr 1.8: `model.callbacks` is dead code; live epochs are regex-parsed
  from its console tables in `rfdetr_bridge.py`.
- `PIPELINE_MODE=streaming` requires `KEEP_MODELS_WARM=true` — the config
  falls back to sequential with a console warning otherwise. And vLLM on
  the shared card MUST be started with `--gpu-memory-utilization 0.35`:
  its 0.9 default grabs ~170 of the 192 GB and starves FLUX/SAM 3/training.
- `AUTO_BATCH=true` passes ultralytics a fractional batch
  (`0.6 / GPU_SLOTS` of free VRAM, measured at train start); `MAX_BATCH_SIZE`
  only caps integer mode. OOM during training auto-halves and retries once.
- ultralytics 8.4 re-fires `on_fit_epoch_end` during the closing validation
  pass (same epoch number, zeroed losses) — `mlops_agent` dedupes curve
  points by epoch; re-check curves whenever ultralytics is bumped.
- Windows + `GPU_SLOTS>1`: `shutil.copy2` is `CopyFile2`, which throws
  WinError 32 when two concurrent runs copy the same source image —
  `dataset_compiler._copy_shared` streams shared sources instead.

## Open roadmap (in rough priority order)

1. **Docker verification** — compose files exist but were never run
   (no Docker on the dev box). Judges are told to use it. Test it.
2. **MI300X deployment** once AMD credits land — the runbook:
   1. On the node: clone the repo, `bash backend/deploy_mi300x.sh` — it
      installs the ROCm stack, writes the streaming .env profile, mints
      `AA_API_KEY`, and prints the endpoint URL + key.
   2. `vllm serve google/gemma-3-27b-it --port 8001 --gpu-memory-utilization 0.35`
   3. `python smoke_test.py` on the node (picks up the key from .env).
   4. In the console — any machine, mock mode is fine: Hardware →
      "Connect AMD Developer Cloud" → paste URL + key → Connect.
   5. FLUX + SAM 3 warm-up run, then the 500-image flagship run with
      evidence capture. First hardware exercise of the parallel swarm's
      VRAM co-residency (streaming mode, GPU_SLOTS=2, AUTO_BATCH) — the
      CPU box verified only the orchestration.
3. **Flagship retrain**: 48 img / 60 epochs on `yolo26m` (Simple default)
   to beat the current `model_0006` (yolov10n, mAP50 0.85) headline.
4. RF-DETR seg variants; friendlier dataset/model pages in Simple mode;
   demo video recording.

## Getting Claude Code into context

Open a Claude Code session at the repo root. The root `CLAUDE.md` imports
this file automatically. A good first message:

> Read HANDOFF.md, auto-annotator-ui/BACKEND_CONTRACT.md and
> auto-annotator-ui/DEMO.md, then give me a status summary and the next
> steps on the roadmap. I have no local GPU — set me up in mock mode first.

Mention "I can't run local inference" so Claude sets up mock mode / remote
backend instead of trying to install CUDA torch.
