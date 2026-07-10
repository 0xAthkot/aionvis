# aionVIS Backend

Real FastAPI implementation of [`../aionvis-ui/BACKEND_CONTRACT.md`](../aionvis-ui/BACKEND_CONTRACT.md):
the autonomous agent swarm that the Control Plane UI drives.

| Agent | What actually runs |
|---|---|
| Prompt Agent | **Gemma via vLLM** (any OpenAI-compatible chat endpoint, `LLM_BASE_URL`); deterministic local fallback when the endpoint is offline |
| Synthesis Agent | **SDXL-Turbo** via HuggingFace diffusers (FLUX.1-schnell on MI300X) |
| Vision Agent | **YOLOE** open-vocabulary segmentation (default) or **SAM 3** (`VISION_BACKEND=sam3`) |
| Critic Agent | **Gemma VLM semantic verification** (via the same vLLM endpoint) — confirms crops actually show the claimed class (cost-capped per run, `SEMANTIC_CRITIC=false` to disable) — on top of pure-numpy geometric checks that re-derive tight boxes from mask contours, compute IoU and reject/regenerate |
| MLOps Agent | **Ultralytics YOLOv10** training with live epoch metrics, `.pt`/ONNX export |

Between stages the orchestrator flushes VRAM (`torch.cuda.empty_cache()` —
which *is* `hip.empty_cache()` on ROCm builds) and the telemetry sampler
reports the real dips: pynvml on NVIDIA, `amd-smi` on AMD.

Runs share the GPU through a queue: one pipeline owns the GPU at a time,
later launches hold `status=queued` (with a live queue-position log) and are
cancellable while waiting. `POST /models/{id}/predict` runs live inference
with any registered model's weights — it yields to CPU when a pipeline run
owns the GPU.

## Run it (local dev, NVIDIA)

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\pip install -r requirements-ml.txt --extra-index-url https://download.pytorch.org/whl/cu126
copy .env.example .env          # point LLM_BASE_URL at a vLLM for the real Prompt Agent
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Then point the frontend at it (`aionvis-ui/.env.local`):

```bash
NEXT_PUBLIC_USE_MOCKS=false
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000
```

No component changes — that's the whole point of the contract.

First run downloads model weights (SDXL-Turbo ~7 GB, YOLOE ~100 MB,
YOLOv10n ~5 MB) into the HuggingFace/Ultralytics caches.

## Deploy on AMD MI300X (Developer Cloud)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ml.txt --extra-index-url https://download.pytorch.org/whl/rocm6.2
cp .env.example .env
```

Recommended `.env` on the MI300X (192 GB VRAM — no offload, bigger models):

```bash
PUBLIC_BASE_URL=http://<node-ip>:8000
VISION_BACKEND=sam3                 # gated facebook/sam3 — run `huggingface-cli login`
SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
MAX_IMAGES_PER_RUN=500
MAX_EPOCHS=100
MAX_BATCH_SIZE=96
MAX_TRAIN_IMAGE_SIZE=1024
KEEP_MODELS_WARM=true               # swarm stays resident in the 192 GB
PIPELINE_MODE=streaming             # synthesis/vision/critic overlap (needs keep-warm)
GPU_SLOTS=2                         # two runs share the card concurrently
AUTO_BATCH=true                     # training sizes its batch to free VRAM
```

Serve **Gemma on the MI300X itself** — zero API spend, every model on AMD
silicon. This matches the `LLM_BASE_URL`/`LLM_MODEL` defaults, and Gemma 3
is multimodal, so the same server powers the Prompt Agent, the semantic
critic VLM, and model cards:

```bash
pip install vllm            # ROCm build
vllm serve google/gemma-3-27b-it --port 8001 --gpu-memory-utilization 0.35
```

`--gpu-memory-utilization 0.35` is required when vLLM shares the card with
the swarm: its 0.9 default would grab ~170 GB of the 192 GB and starve
FLUX, SAM 3 and training.

Without a reachable endpoint the Prompt Agent uses its deterministic
template fallback and the semantic critic is skipped — the pipeline still
runs end to end.

Telemetry automatically switches to `amd-smi` and the hardware page shows
the real MI300X (VRAM, hotspot temp, socket power). The node is detected as
`amd-developer-cloud` when the GPU name contains "MI300".

## Layout

```
app/
├── main.py            # FastAPI app, CORS, /files static, lifespan
├── schemas.py         # Pydantic mirror of types.ts (camelCase wire)
├── routers.py         # every REST route
├── ws.py              # /ws/v1 run-events + telemetry sockets
├── events.py          # in-process pub/sub bus feeding the sockets
├── store.py           # in-memory state + JSON persistence (data/state.json)
├── telemetry.py       # real GPU sampling (pynvml / amd-smi)
├── byod.py            # multipart .zip upload + extraction
├── orchestrator/
│   ├── context.py     # per-run logging/stage/agent-state channel
│   └── pipeline.py    # thread-per-run stage machine
└── agents/
    ├── prompt_agent.py     # Gemma via vLLM (OpenAI-compatible)
    ├── synthesis_agent.py  # diffusers SDXL-Turbo / FLUX
    ├── vision_agent.py     # YOLOE / SAM 3 → mask contours
    ├── critic_agent.py     # geometric IoU verdicts + box regeneration
    ├── geometry.py         # pure-numpy geometry (no cv2 anywhere in app/)
    ├── dataset_compiler.py # YOLO dataset + thumbnails + API records
    ├── mlops_agent.py      # Ultralytics training + registry + export
    └── gpu.py              # VRAM flush orchestration
```

State lives in `data/` (gitignored): `state.json`, generated datasets under
`data/files/…` (served at `/files`), run workdirs under `data/runs/…`.
For a clean demo slate, stop the backend and run `python reset_demo.py`
(add `--yes` to skip the prompt) — the next start reseeds the demo org and
projects.

Before going on stage, run `python smoke_test.py` against the live backend —
a read-only preflight that checks every critical endpoint (REST, Prompt Agent,
playground inference) and prints pass/fail per check.
