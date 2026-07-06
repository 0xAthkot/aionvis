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

1. `npm run dev`, open http://localhost:3000, sign in (any credentials).
   Real mode: start the backend first (`uvicorn app.main:app --port 8000`).
2. Keep the **Dashboard** open in one tab — its VRAM sparkline moves with the
   pipeline, which makes the intro land.

## The script

**0:00 — Dashboard.** "This is the MLOps Command Center for our agent swarm.
One MI300X node, 192 GB of VRAM, live telemetry." Point at the GPU fleet card
and the stat tiles.

**0:15 — Foundry.** Sidebar → Synthetic Foundry. Pick *PCB Defect Detection*
(classes and run name autofill). Type a scene prompt, e.g.:

> Top-down macro photo of a green printed circuit board on an assembly line
> with visible solder defects

Click **Preview expansion** — "Our Prompt Agent, Gemma 4 on Fireworks AI,
expands one sentence into hundreds of domain-randomized scenarios." Show the
scenarios, drag a randomization slider, note the live cost estimate updating.

**0:40 — Launch.** Click **Launch autonomous run**. "From here, zero human
intervention." You land in Mission Control.

**0:45 — Mission Control.** Narrate as it streams:
- The agent swarm panel: Prompt → Synthesis → Vision (SAM 3) → Critic → MLOps,
  each lighting up as it takes over.
- The terminal: Critic verdicts in color — "REJECT, IoU 0.43, regenerate" —
  *the swarm self-corrects its own labels.*
- The VRAM card: "Watch the `hip.empty_cache()` flush between stages — we
  orchestrate all 192 GB deliberately." The chart cliffs on cue.

*(While training runs, flip briefly to **Hardware** for the full-size VRAM
cliff chart, or to the Dashboard tab showing the same load.)*

**2:15 — Completion.** Toast fires; the green banner appears. Click
**View dataset**: bounding boxes drawn on every image, Critic verdicts on
click, class distribution chart. Then **View model**: mAP ~0.91, training
curves, one-click .pt / ONNX export. "Prompt in, deployable model out."

## One-liners worth landing

- "Roboflow needs your data and your clicks. We need one sentence."
- "Every rejected label you saw was caught by our own Critic — no human QA."
- "This UI is contract-first: the same screens run against the live FastAPI
  backend by flipping one env var."
