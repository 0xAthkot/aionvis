# aionVIS Backend

Real FastAPI implementation of [`../aionvis-ui/BACKEND_CONTRACT.md`](../aionvis-ui/BACKEND_CONTRACT.md):
the autonomous agent swarm that the Control Plane UI drives.

| Agent | What actually runs |
|---|---|
| Prompt Agent | **Gemma via vLLM** (any OpenAI-compatible chat endpoint, `LLM_BASE_URL`); deterministic local fallback when the endpoint is offline |
| Synthesis Agent | **SDXL-Turbo** via HuggingFace diffusers (FLUX.2-klein on MI300X) — the wizard's generator choice is honored verbatim |
| Vision Agent | **SAM 3** concept segmentation (`.venv-sam3` sidecar) or **YOLOE** open-vocab — a per-run user choice (`visionBackend`), rejected with setup steps if the node can't run it |
| Critic Agent | **Gemma VLM semantic verification** (via the same vLLM endpoint) — confirms crops actually show the claimed class (cost-capped per run, `SEMANTIC_CRITIC=false` to disable) — on top of pure-numpy geometric checks that re-derive tight boxes from mask contours, compute IoU and reject/regenerate |
| MLOps Agent | **YOLOv10/11/26, RT-DETR, RF-DETR** training with live epoch metrics; `.pt`/ONNX/TorchScript/OpenVINO export |

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

One-shot, verified live on the Developer Cloud: `bash deploy_mi300x.sh`
(ROCm torch via `--index-url` — an `--extra-index-url` would let PyPI's
CUDA build win — plus the SAM 3 sidecar, the streaming `.env` profile
below, and a minted `AA_API_KEY`).

Recommended `.env` on the MI300X (192 GB VRAM — no offload, bigger models):

```bash
PUBLIC_BASE_URL=http://<node-ip>:8000
VISION_BACKEND=sam3                 # gated facebook/sam3 — run `huggingface-cli login`
SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
MAX_IMAGES_PER_RUN=100000
MAX_EPOCHS=1000
MAX_BATCH_SIZE=96
MAX_TRAIN_IMAGE_SIZE=1024
KEEP_MODELS_WARM=true               # swarm stays resident in the 192 GB
PIPELINE_MODE=streaming             # synthesis/vision/critic overlap (needs keep-warm)
GPU_SLOTS=4                         # four runs share the card concurrently
AUTO_BATCH=true                     # training sizes its batch to free VRAM
```

Serve **Gemma 4 on the MI300X itself** — zero API spend, every model on AMD
silicon. Gemma 4 is multimodal, so the same server powers the Prompt Agent,
the semantic critic VLM, and model cards. Use the vLLM ROCm **container**
(PyPI vllm wheels are CUDA-only); `deploy_mi300x.sh` prints the full
`docker run` command:

```bash
# inside the vllm/vllm-openai-rocm container (see deploy_mi300x.sh)
vllm serve google/gemma-4-26B-A4B-it --port 8001 --gpu-memory-utilization 0.50
```

`--gpu-memory-utilization 0.50` is required when vLLM shares the card with
the swarm: its 0.9 default would grab ~170 GB of the 192 GB and starve
FLUX, SAM 3 and training. (0.50 is the live MI300X profile — the warm
swarm measures ~125 GB resident with ~67 GB left for training.)

Without a reachable endpoint the Prompt Agent uses its deterministic
template fallback and the semantic critic is skipped — the pipeline still
runs end to end.

Telemetry automatically switches to `amd-smi` and the hardware page shows
the real MI300X (VRAM, hotspot temp, socket power). The node is detected as
`amd-developer-cloud` when the GPU name contains "MI300".

## Isolated model runtimes (sidecars)

SAM 3 and RF-DETR need `transformers>=5`, which breaks the pinned SDXL stack.
Each runs in its own venv, and the backend talks to a worker process over a
line protocol. `deploy_mi300x.sh` builds the SAM 3 sidecar for you; RF-DETR is
opt-in. Selecting either without its venv doesn't fail silently: the run is
rejected at launch with exactly these commands.

```bash
cd backend
# RF-DETR training/inference
python -m venv .venv-rfdetr
.venv-rfdetr/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.4
.venv-rfdetr/bin/pip install "rfdetr[train]" onnx onnxsim

# SAM 3 auto-labeling (checkpoint is gated on Hugging Face, request access)
python -m venv .venv-sam3
.venv-sam3/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.4
.venv-sam3/bin/pip install "transformers>=5.5" accelerate pillow numpy scipy
```

(Other GPUs: swap the ROCm index for the matching PyTorch build, e.g. `cu126`;
Windows: `Scripts\pip`.)

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
    ├── synthesis_agent.py  # diffusers SDXL / FLUX.2-klein
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
