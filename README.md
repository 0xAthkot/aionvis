# aionVIS

**One sentence in → deployable detection model out. Zero human labeling.**

**▶ Live demo, no setup: [aionvis.vercel.app](https://aionvis.vercel.app)** — sign in
with any credentials (demo auth). Everything works in the browser, including a
simulated end-to-end run in Mission Control.

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

## What the swarm produces

| | |
|---|---|
| ![Verified labels: forklift, worker, pallet](docs/img/flagship-labeled-1.png) | ![Verified labels: forklift, worker, pallets](docs/img/flagship-labeled-2.png) |

*Two of the 500 FLUX.2-generated images from the flagship run: auto-labeled by
SAM 3, every box verified by the Critic Agent (geometry + Gemma 4 VLM). No
human drew or reviewed a single label — 22,718 were accepted this way, 42,214
rejected.*

![Trained model predicting a tractor at 0.97 confidence](docs/img/playground-tractor.jpg)

*The output side: a swarm-trained model's own prediction in the console's
inference playground.*

## Measured on one AMD Instinct MI300X (2026-07-10)

| | |
|---|---|
| 500 images generated → SAM 3-labeled → critic-verified | **7.5 minutes** (streaming, stages overlapped) |
| Verified instances (from ~65k SAM 3 candidates) | **22,718** |
| yolo26m, 60 epochs @ 1024 px | **30 minutes** |
| Result (dense warehouse dataset, ~45 instances/img) | **mAP50 0.764 · mAP50-95 0.611** |
| Total, one sentence → deployable model | **~38 minutes, 0 human labels** |
| GPU cost at the AMD Developer Cloud $2/h rate | **~$1.25** |

## Setup — three ways in, easiest first

### 1 · Zero install (recommended first look)

Open **[aionvis.vercel.app](https://aionvis.vercel.app)** → *Launch console* →
sign in with any credentials. The console runs on an in-browser mock (MSW):
every screen, wizard, dataset view and a full simulated run work with no
backend and no GPU. If you have a live aionVIS node, attach it at runtime:
**Hardware → Connect AMD Developer Cloud → paste URL + API key** — all REST
and WebSocket traffic switches to the real node instantly.

### 2 · Run the console locally — two commands, no GPU, no config

```bash
cd aionvis-ui
npm install && npm run dev     # → http://localhost:3000
```

Node 22+. Mock mode is the **default** (no `.env` needed) — same experience
as option 1, served locally. Verified on a clean Windows machine.

### 3 · The real thing — full swarm on an AMD MI300X

```bash
# on the node (AMD Developer Cloud MI300X, ROCm):
git clone https://github.com/0xAthkot/aionvis && cd aionvis
bash backend/deploy_mi300x.sh   # one-shot: ROCm torch stack, SAM 3 + RF-DETR
                                # sidecars, streaming .env profile, mints an
                                # API key, prints the vLLM/Gemma container
                                # command and your endpoint URL + key
python backend/smoke_test.py    # preflight: every endpoint + LLM + inference
```

Then attach any console (option 1 or 2) to the node at runtime as above.
The deploy script's printed output is self-contained — endpoint URL, API
key, and the exact vLLM container command. To expose the node to the hosted
console over HTTPS, see **External services** below (sslip.io + Caddy).

### Alternative · Docker (CPU-only reference stack)

```bash
docker compose up --build
# UI → http://localhost:3000   API → http://localhost:8000/docs
```

Defaults are CPU-only so it runs anywhere — slow diffusion, but everything is
real. Optional LLM: point `LLM_BASE_URL` in `.env` at any OpenAI-compatible
endpoint; without one the swarm degrades gracefully to deterministic
fallbacks (runs still complete).

## AMD resource usage

Everything above was built, measured and trained on AMD:

- **AMD Developer Cloud MI300X droplet** (192 GB HBM3, ROCm 7.2.4) — all
  training, inference and the flagship run. No NVIDIA hardware anywhere in
  the pipeline; no third-party LLM APIs (no OpenAI/Fireworks keys).
- **PyTorch on ROCm** — SDXL/FLUX.2 diffusion, SAM 3 segmentation, and
  YOLO / RT-DETR / RF-DETR training.
- **vLLM ROCm container** (`vllm/vllm-openai-rocm:v0.23.0`) serving
  **Gemma 4 26B-A4B-IT** (MoE, 4B active) at `--gpu-memory-utilization 0.50`
  for scene design, the semantic critic and model cards.
- **The MI300X-unique part:** 192 GB lets the *whole* swarm stay resident —
  Gemma 4 (~96 GB) + FLUX.2 (~13 GB) + SAM 3/YOLOE (~8 GB) measured at
  **125 GB warm**, with ~67 GB free for training. Streaming mode overlaps
  synthesis/vision/critic on one card (`PIPELINE_MODE=streaming`,
  `GPU_SLOTS=4`, `AUTO_BATCH=true`); an 80 GB card cannot co-reside this
  stack. Live VRAM telemetry is on the console's Hardware page.

## Main code path

Follow one run through the system:

| Step | Where |
|---|---|
| `POST /api/v1/runs` | [`backend/app/routers.py`](backend/app/routers.py) |
| Orchestration (sequential + streaming modes) | [`backend/app/orchestrator/pipeline.py`](backend/app/orchestrator/pipeline.py) |
| 1 · Use case → scene prompts (Gemma, or deterministic fallback) | [`backend/app/agents/prompt_agent.py`](backend/app/agents/prompt_agent.py) |
| 2 · Image synthesis (FLUX.2 / SDXL) | [`backend/app/agents/synthesis_agent.py`](backend/app/agents/synthesis_agent.py) |
| 3 · Open-vocab labeling (SAM 3 sidecar / YOLOE) | [`backend/app/agents/vision_agent.py`](backend/app/agents/vision_agent.py), [`sam3_bridge.py`](backend/app/agents/sam3_bridge.py) |
| 4 · Label verification (pure-numpy geometry + Gemma VLM) | [`backend/app/agents/critic_agent.py`](backend/app/agents/critic_agent.py), [`geometry.py`](backend/app/agents/geometry.py), [`semantic_critic.py`](backend/app/agents/semantic_critic.py) |
| 5 · Dataset compile → training → export → model card | [`dataset_compiler.py`](backend/app/agents/dataset_compiler.py), [`mlops_agent.py`](backend/app/agents/mlops_agent.py), [`model_card.py`](backend/app/agents/model_card.py) |

The API surface is **contract-first**:
[`aionvis-ui/BACKEND_CONTRACT.md`](aionvis-ui/BACKEND_CONTRACT.md) documents
every endpoint; [`aionvis-ui/src/lib/api/types.ts`](aionvis-ui/src/lib/api/types.ts)
and [`backend/app/schemas.py`](backend/app/schemas.py) are 1:1 mirrors, and the
UI's in-browser mock ([`aionvis-ui/src/lib/mocks/handlers.ts`](aionvis-ui/src/lib/mocks/handlers.ts))
implements the same contract — which is why the console runs identically with
or without a backend.

| Part | What it is |
|---|---|
| [`aionvis-ui/`](aionvis-ui/README.md) | Next.js 16 console — wizard, live Mission Control, dataset analytics, model registry + comparison, inference playground |
| [`backend/`](backend/README.md) | FastAPI + the agent swarm |

## External services

All models are open-weight and self-hosted; the only services involved:

| Service | Role | Notes |
|---|---|---|
| **AMD Developer Cloud** | MI300X droplet the swarm runs on ($2/h) | The only compute used |
| **Vercel** | Hosts the demo console ([aionvis.vercel.app](https://aionvis.vercel.app)) | Frontend only; runs on the in-browser mock until you attach a node |
| **sslip.io** | Zero-signup wildcard DNS: `129-212-179-0.sslip.io` → the droplet IP | Gives Caddy a hostname so Let's Encrypt can issue a cert; no account, stores nothing |
| **Caddy + Let's Encrypt** | TLS proxy on the droplet (REST + WebSockets) | Required: the HTTPS console cannot call plain `http://`/`ws://` (mixed content) |
| **Hugging Face** | Model weights, downloaded on first use | `facebook/sam3` is gated — request access on its model page and `huggingface-cli login`; check each model page for license acceptance |
| **GitHub** | This repo | — |

**No third-party LLM/API services.** The language model is Gemma 4 served by
vLLM on the same MI300X; there are no OpenAI, Anthropic or Fireworks keys
anywhere in the stack. The backend's own API is protected by a self-minted
`AA_API_KEY` (Bearer / X-API-Key / WebSocket `?token=`).

## Model lineup — every weight is open

| Stage | Model | License |
|---|---|---|
| Scene design + semantic critic | google/gemma-4-26B-A4B-it (MoE, vLLM) | Apache-2.0 |
| Synthesis | black-forest-labs/FLUX.2-klein-4B (or SDXL) | Apache-2.0 (OpenRAIL++) |
| Auto-labeling | facebook/sam3 (or YOLOE) | SAM License / AGPL-3.0 |
| Trainable detectors | YOLOv10/11/26 · RT-DETR · RF-DETR | AGPL-3.0 · Apache-2.0 (RF-DETR) |

Model choices are the user's and are honored verbatim — a node that can't
run the selected generator or labeler **rejects the run with setup steps**
instead of silently substituting. 22 trainable architectures across 5 task
types (detect · segment · OBB · pose · classify); exports to .pt, ONNX,
TorchScript, OpenVINO and YOLO/COCO/VOC/CSV datasets.

### Isolated model runtimes (sidecars)

Two model families need `transformers>=5`, which conflicts with the pinned
SDXL stack — each runs in its own venv and the backend talks to a worker
process over a line protocol (`deploy_mi300x.sh` sets both up for you).
Runs that select them without the venv are rejected at launch with these
exact instructions:

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
