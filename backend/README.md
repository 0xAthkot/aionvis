# Auto-Annotator Backend

Real FastAPI implementation of [`../auto-annotator-ui/BACKEND_CONTRACT.md`](../auto-annotator-ui/BACKEND_CONTRACT.md):
the autonomous agent swarm that the Control Plane UI drives.

| Agent | What actually runs |
|---|---|
| Prompt Agent | Gemma on **Fireworks AI** (chat completions); deterministic local fallback without a key |
| Synthesis Agent | **SDXL-Turbo** via HuggingFace diffusers (FLUX.1-schnell on MI300X) |
| Vision Agent | **YOLOE** open-vocabulary segmentation (default) or **SAM 3** (`VISION_BACKEND=sam3`) |
| Critic Agent | **OpenCV** geometric verification — re-derives tight boxes from mask contours, computes IoU, rejects/regenerates |
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
copy .env.example .env          # add FIREWORKS_API_KEY for the real Prompt Agent
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Then point the frontend at it (`auto-annotator-ui/.env.local`):

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
FIREWORKS_API_KEY=...
PUBLIC_BASE_URL=http://<node-ip>:8000
VISION_BACKEND=sam3                 # gated facebook/sam3 — run `huggingface-cli login`
SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
MAX_IMAGES_PER_RUN=500
MAX_EPOCHS=100
```

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
    ├── prompt_agent.py     # Fireworks AI (Gemma)
    ├── synthesis_agent.py  # diffusers SDXL-Turbo / FLUX
    ├── vision_agent.py     # YOLOE / SAM 3 → mask contours
    ├── critic_agent.py     # OpenCV IoU verdicts + box regeneration
    ├── dataset_compiler.py # YOLO dataset + thumbnails + API records
    ├── mlops_agent.py      # Ultralytics training + registry + export
    └── gpu.py              # VRAM flush orchestration
```

State lives in `data/` (gitignored): `state.json`, generated datasets under
`data/files/…` (served at `/files`), run workdirs under `data/runs/…`.
For a clean demo slate, stop the backend and run `python reset_demo.py`
(add `--yes` to skip the prompt) — the next start reseeds the demo org and
projects.
