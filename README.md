# Auto-Annotator

Autonomous agent swarm that generates, self-verifies and labels training
data, then trains deployable YOLO object-detection models natively on AMD
hardware. Built for the AMD Developer Hackathon ACT II (Unicorn Track).

**One sentence in → deployable `.pt` model out. Zero human labeling.**

```
Prompt Agent (Gemma · Fireworks AI)
   └─> Synthesis Agent (SDXL-Turbo / FLUX · diffusers)
         └─> Vision Agent (SAM 3 / YOLOE zero-shot segmentation)
               └─> Critic Agent (OpenCV geometric verification, IoU verdicts)
                     └─> MLOps Agent (YOLOv10 training · PyTorch on ROCm)
```

The Control Plane streams every stage live — agent states, Critic verdicts,
VRAM orchestration, synthetic images appearing the moment they're generated —
and closes the loop with an **inference playground**: drop a photo on the
model page and watch the just-trained weights detect, with real latency and
device badges.

| Part | What it is |
|---|---|
| [`auto-annotator-ui/`](auto-annotator-ui/README.md) | Next.js 16 MLOps Command Center — runs standalone on an in-browser mock, or against the real backend with one env flip |
| [`backend/`](backend/README.md) | FastAPI + the real agent swarm; implements [`BACKEND_CONTRACT.md`](auto-annotator-ui/BACKEND_CONTRACT.md) |

## Quick start

```bash
# 1. Backend (see backend/README.md for the GPU stack install)
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. Frontend
cd auto-annotator-ui && npm run dev     # http://localhost:3000
```

Demo walkthrough: [`auto-annotator-ui/DEMO.md`](auto-annotator-ui/DEMO.md).
