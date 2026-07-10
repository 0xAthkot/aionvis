# aionVIS

Autonomous agent swarm that generates, self-verifies and labels training
data, then trains deployable YOLO object-detection models natively on AMD
hardware. Built for the AMD Developer Hackathon ACT II (Unicorn Track).

**One sentence in → deployable `.pt` model out. Zero human labeling.**

```
Prompt Agent (Gemma · vLLM on MI300X)
   └─> Synthesis Agent (SDXL-Turbo / FLUX · diffusers)
         └─> Vision Agent (SAM 3 / YOLOE zero-shot segmentation)
               └─> Critic Agent (Gemma VLM semantic spot-check + geometric self-check)
                     └─> MLOps Agent (YOLOv10 training · PyTorch on ROCm)
```

The Control Plane streams every stage live — agent states, Critic verdicts,
VRAM orchestration, synthetic images appearing the moment they're generated —
and closes the loop with an **inference playground**: drop a photo on the
model page and watch the just-trained weights detect, with real latency and
device badges. Missed detection? **Flag it** — the next run's Prompt Agent
generates scenarios covering exactly that failure (active learning, one
click).

| Part | What it is |
|---|---|
| [`aionvis-ui/`](aionvis-ui/README.md) | Next.js 16 MLOps Command Center — runs standalone on an in-browser mock, or against the real backend with one env flip |
| [`backend/`](backend/README.md) | FastAPI + the real agent swarm; implements [`BACKEND_CONTRACT.md`](aionvis-ui/BACKEND_CONTRACT.md) |

## Quick start (Docker — recommended for judges)

```bash
# Optional: an OpenAI-compatible LLM endpoint, e.g. vLLM serving Gemma
# (LLM prompt expansion, VLM semantic critic, model cards). Without one
# the swarm degrades gracefully to deterministic fallbacks.
echo "LLM_BASE_URL=http://host.docker.internal:8001/v1" > .env

docker compose up --build
```

- **UI** → http://localhost:3000 — landing page; *Launch console* to sign in
  (any credentials, demo auth)
- **API** → http://localhost:8000/docs

Defaults are CPU-only so it runs on any machine — the diffusion model is
slow on CPU but everything is real. On an NVIDIA box rebuild the backend
with `TORCH_INDEX=https://download.pytorch.org/whl/cu126` and uncomment
`gpus: all` in `docker-compose.yml`; on an AMD MI300X use
[`backend/deploy_mi300x.sh`](backend/deploy_mi300x.sh) instead.

## Quick start (native dev)

```bash
# 1. Backend (see backend/README.md for the GPU stack install)
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. Frontend
cd aionvis-ui && npm run dev     # http://localhost:3000
```

### Optional: RF-DETR architectures

Roboflow's RF-DETR needs `transformers>=5`, which conflicts with the pinned
SDXL stack, so it runs in its own venv and the backend shells out to
[`backend/rfdetr_worker.py`](backend/rfdetr_worker.py). One-time setup:

```bash
cd backend
python -m venv .venv-rfdetr
.venv-rfdetr/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
.venv-rfdetr/Scripts/pip install "rfdetr[train]" onnx onnxsim
```

Without it, RF-DETR runs are rejected at launch with these instructions;
every other architecture works as normal.

Demo walkthrough: [`aionvis-ui/DEMO.md`](aionvis-ui/DEMO.md).
