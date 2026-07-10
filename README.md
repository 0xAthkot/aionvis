# aionVIS

**One sentence in → deployable detection model out. Zero human labeling.**

aionVIS is an autonomous agent swarm that generates its own training data,
labels it, verifies its own labels, and trains deployable object-detection
models — natively on AMD hardware. Built for the **AMD Developer Hackathon
ACT II (Unicorn Track)** with Claude Fable 5 in 5 days.

```
Prompt Agent (Gemma 4 26B-A4B MoE · vLLM on MI300X)
   └─> Synthesis Agent (FLUX.2-klein / SDXL · diffusers on ROCm)
         └─> Vision Agent (SAM 3 concept segmentation / YOLOE zero-shot)
               └─> Critic Agent (geometric self-check + Gemma 4 VLM semantic spot-check)
                     └─> MLOps Agent (YOLO / RT-DETR / RF-DETR training · PyTorch on ROCm)
```

On a single MI300X the swarm runs as a **parallel pipeline**: synthesis,
vision and critic overlap as producer/consumer streams with every model
resident in the 192 GB of VRAM at once — no load/unload churn.

## Measured on one AMD Instinct MI300X (2026-07-10)

| | |
|---|---|
| 500 images generated → SAM 3-labeled → critic-verified | **7.5 minutes** (~73 img/min, streaming) |
| Verified instances (from ~65k SAM 3 candidates) | **22,718** |
| yolo26m, 60 epochs @ 1024 px | **30 minutes** |
| Result (dense warehouse dataset, ~45 instances/img) | **mAP50 0.764 · mAP50-95 0.611** |
| Total, one sentence → deployable model | **~44 minutes, 0 human labels** |

## Model lineup — every weight is open

| Stage | Model | License |
|---|---|---|
| Scene design + semantic critic | google/gemma-4-26B-A4B-it (MoE, vLLM) | Apache-2.0 |
| Synthesis | black-forest-labs/FLUX.2-klein-4B (or SDXL) | Apache-2.0 (OpenRAIL++) |
| Auto-labeling | facebook/sam3 (or YOLOE) | SAM License / AGPL-3.0 |
| Trainable detectors | YOLOv10/11/26 · RT-DETR · RF-DETR | AGPL-3.0 · Apache-2.0 (RF-DETR) |

Model choices are the user's and are honored verbatim — a node that can't
run the selected generator or labeler **rejects the run with setup steps**
instead of silently substituting.

| Part | What it is |
|---|---|
| [`aionvis-ui/`](aionvis-ui/README.md) | Next.js 16 MLOps Command Center — runs standalone on an in-browser mock, or attaches to any GPU node at runtime (URL + API key, live WebSocket streams) |
| [`backend/`](backend/README.md) | FastAPI + the agent swarm; implements [`BACKEND_CONTRACT.md`](aionvis-ui/BACKEND_CONTRACT.md) |

## Quick start (Docker)

```bash
# Optional: an OpenAI-compatible LLM endpoint, e.g. vLLM serving Gemma
# (prompt design, VLM semantic critic, model cards). Without one the
# swarm degrades gracefully to deterministic fallbacks.
echo "LLM_BASE_URL=http://host.docker.internal:8001/v1" > .env

docker compose up --build
```

- **UI** → http://localhost:3000 — landing page; *Launch console* to sign in
  (any credentials, demo auth)
- **API** → http://localhost:8000/docs

Defaults are CPU-only so it runs on any machine — slow diffusion, but
everything is real. On an AMD MI300X run
[`backend/deploy_mi300x.sh`](backend/deploy_mi300x.sh) instead: it installs
the ROCm stack, the SAM 3 sidecar, mints an API key and prints the
vLLM/Gemma serve command.

## Quick start (native dev)

```bash
# 1. Backend (see backend/README.md for the GPU stack install)
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. Frontend — fully functional on the in-browser mock, no backend needed
cd aionvis-ui && npm run dev     # http://localhost:3000
```

### Isolated model runtimes (sidecars)

Two model families need `transformers>=5`, which conflicts with the pinned
SDXL stack — each runs in its own venv and the backend talks to a worker
process over a line protocol. Runs that select them without the venv are
rejected at launch with these exact instructions:

```bash
cd backend
# RF-DETR training/inference
python -m venv .venv-rfdetr
.venv-rfdetr/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.4
.venv-rfdetr/bin/pip install "rfdetr[train]" onnx onnxsim

# SAM 3 auto-labeling (checkpoint is gated on Hugging Face — request access)
python -m venv .venv-sam3
.venv-sam3/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.4
.venv-sam3/bin/pip install "transformers>=5.5" accelerate pillow numpy scipy
```

(NVIDIA: swap the index for `cu126`; Windows: `Scripts\pip`.)

Demo walkthrough: [`aionvis-ui/DEMO.md`](aionvis-ui/DEMO.md) · Pitch:
[`PITCH.md`](PITCH.md)

## License

MIT — see [LICENSE](LICENSE). Third-party models and libraries keep their
own licenses (table above).
