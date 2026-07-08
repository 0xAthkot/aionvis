# 90-Second Demo Script

Golden path for judges. Two ways to run it:

- **Mock mode** (`NEXT_PUBLIC_USE_MOCKS=true`): no backend, ~90 s simulated
  pipeline, reset anytime with a hard refresh (state is per-tab). Safest for
  a stage with no GPU.
- **Real mode** (`.env.local` pointing at the FastAPI backend in
  [`../backend`](../backend/README.md)): the swarm actually generates
  SDXL images, segments them, critiques the boxes and trains YOLOv10.
  A 24-image / 12-epoch run takes ~4 min on an RTX 4060 (weights must be
  pre-downloaded — do one warm-up run first); the MI300X eats far bigger
  runs. The Warehouse Safety project demos best in real mode (zero-shot
  detection is strongest on forklifts/pallets/workers).

## Setup (before you present)

1. `npm run dev`, open http://localhost:3000 — the landing page (worth 5
   seconds on screen by itself) — then **Launch console** and sign in (any
   credentials). Real mode: start the backend first
   (`uvicorn app.main:app --port 8000`), then run the preflight:
   `python backend/smoke_test.py` — every check must pass before you present.
2. Keep the **Dashboard** open in one tab — its VRAM sparkline moves with the
   pipeline, which makes the intro land.

> **Simple vs Pro:** a fresh browser starts in **Simple mode** — the same
> console in plain language (Coinbase Simple/Advanced pattern): every tab,
> every architecture, agent terminal and GPU telemetry included, but the
> knobs live behind "More options" with tuned defaults. This script uses
> **Pro** (every knob up front): flip the toggle in the top bar once, it
> persists. The switch itself is a great beat — "same engine, two cockpits:
> novices describe a scene, ML engineers grab every dial."

## The script

**0:00 — Dashboard.** "This is the MLOps Command Center for our agent swarm.
One MI300X node, 192 GB of VRAM, live telemetry." Point at the GPU fleet card
and the stat tiles.

**0:15 — Foundry.** Sidebar → Synthetic Foundry. Pick *Warehouse Safety*
in real mode (*PCB Defect Detection* reads well in mock mode); classes and
run name autofill. Type the USE CASE — the job, not a picture:

> Our warehouse safety cameras need to spot forklifts, stacked wooden
> pallets and workers in orange safety vests in the aisles

Click **Preview scenes** — "You told it what the model is FOR. Our Prompt
Agent, Gemma 4 served by vLLM on the MI300X, works out the camera
viewpoint and the environment, then designs hundreds of domain-randomized
scenes itself — nobody here writes a diffusion prompt." Show the scenes,
drag a randomization slider, note the live cost estimate updating.

**0:40 — Launch.** Click **Launch autonomous run**. "From here, zero human
intervention." You land in Mission Control.

**0:45 — Mission Control.** Narrate as it streams:
- **The parallel-swarm moment** (the AMD money shot): the header badge
  reads **Parallel swarm · MI300X**, and the stage tracker splits into
  three simultaneous lanes — Generated / Annotated / Verified counters all
  advancing at once while Synthesis, Vision *and* Critic show "Working"
  together. *"On other GPUs our agents take turns. On one MI300X they work
  at the same time — 192 GB holds the whole swarm resident."*
- The agent swarm panel: Prompt hands off, then three agents run
  concurrently; the MLOps trainer joins only once every label is verified.
- The **live foundry preview**: synthetic images appear in the grid the moment
  the diffusion model produces them — *"this data did not exist four seconds
  ago."*
- The terminal: Critic verdicts in color — "REJECT, IoU 0.43, regenerate" —
  *the swarm self-corrects its own labels.*
- The VRAM card: "Watch the `hip.empty_cache()` flush between stages — we
  orchestrate all 192 GB deliberately." The chart cliffs on cue.
- (Optional flex: launch a second run mid-pipeline — it queues behind the
  first with a live queue position instead of fighting for VRAM.)

*(While training runs, flip briefly to **Hardware** for the full-size VRAM
cliff chart and the **Resident swarm** chip row — Gemma 3 27B, FLUX, SAM 3
held in VRAM at once — or to the Dashboard tab showing the same load.)*

**2:15 — Completion.** Toast fires; the green banner appears. Click
**View dataset**: bounding boxes drawn on every image, Critic verdicts on
click, class distribution chart — and one-click **YOLO / COCO** archive
export ("your data is never locked in"). Then **View model**: training
curves and one-click .pt / ONNX export.

**The closer — Inference playground.** On the model page, drop a photo of a
forklift into the playground. Real inference on the weights the swarm just
trained: boxes, class labels, single-digit-millisecond latency, device badge.
"Prompt in, deployable model out — and here it is, deployed."

**The encore — close the loop.** Find (or claim) a miss, type it into
**Send to Foundry** — e.g. *"worker crouching behind a pallet jack, mostly
hidden"* — and flag it. Back in the Foundry with the same project selected:
an amber **Active learning** panel now lists that hard case, and clicking
**Preview expansion** shows the Prompt Agent writing scenarios that target
it verbatim. "The swarm doesn't just label data — it learns from its own
model's mistakes. That's the flywheel."

## One-liners worth landing

- "Roboflow needs your data and your clicks. We need one sentence."
- "On other GPUs our agents take turns. On one MI300X they work at the
  same time."
- "Ninety seconds ago this model didn't exist. Neither did its training data."
- "Every rejected label you saw was caught by our own Critic — no human QA."
- "One click on a failure, and the next dataset is built to fix it."
- "This UI is contract-first: the same screens run against the live FastAPI
  backend by flipping one env var."
