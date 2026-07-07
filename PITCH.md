# Auto-Annotator — the pitch

**One sentence in → deployable detection model out. Zero human labeling.**

## The problem

Every company that wants computer vision hits the same wall: training data.
Collecting site imagery takes months, labeling it costs $0.03–$0.10 *per box*
at scale (a modest 100k-image dataset runs $50k+ with QA), and the moment the
camera angle or product changes, you pay again. Data labeling is a
multi-billion-dollar market that exists only because models can't feed
themselves.

## The product

Auto-Annotator is an autonomous agent swarm that feeds them:

1. **Prompt Agent** (LLM) turns one plain-English sentence into hundreds of
   domain-randomized scene descriptions.
2. **Synthesis Agent** (SDXL/FLUX) renders them into photorealistic training
   images.
3. **Vision Agent** (SAM 3 / open-vocabulary segmentation) labels every
   object — no fixed class list, any noun works.
4. **Critic Agent** re-derives every box geometrically (OpenCV) and rejects
   or regenerates bad labels. The swarm QAs itself; typical runs reject 2–3×
   more candidate labels than they accept.
5. **MLOps Agent** trains YOLOv10 on the accepted data, streams live metrics,
   writes its own model card, and exports deployable `.pt`/ONNX weights.

The customer never draws a box. For teams with existing imagery, the same
swarm labels uploaded archives (BYOD path) — that's the Scale AI workflow
without the humans.

## Why now, why AMD

The whole swarm — diffusion model, segmentation model, trainer, and
optionally the LLM itself — fits **resident in one MI300X's 192 GB of VRAM**.
No model juggling, no multi-node orchestration: one box is a complete
data-to-model factory. Our orchestrator schedules the GPU explicitly
(`hip.empty_cache()` between stages, run queue, live VRAM telemetry via
`amd-smi`), so a single MI300X serves a whole team. That's the unit
economics: one GPU-hour of MI300X replaces roughly a thousand dollars of
human labeling.

## Business model

Usage-based: per GPU-minute (the app already meters and quotes every run
before launch — see the cost estimator in the wizard) plus a platform fee
per seat. A 500-image, 100-epoch run is minutes of MI300X time — sellable
at $5–15 with healthy margin against Developer Cloud pricing.

## Competition

| | Data source | Labels | Human in loop |
|---|---|---|---|
| Scale AI / Labelbox | yours | humans | always |
| Roboflow | yours | assisted | yes |
| Synthetic-data studios (3D/CGI) | artists build scenes | rendered | artists |
| **Auto-Annotator** | **generated from a sentence** | **self-verified by agents** | **no** |

The self-correcting Critic is the moat: synthetic data is easy to generate
and hard to trust. We ship the trust layer.

## Status

Fully functional end to end (this repo): real diffusion, real segmentation,
real Critic verdicts, real YOLOv10 training with live telemetry, inference
playground to prove every model, multi-tenant control plane. Runs today on
a single consumer GPU; designed for, and deploying to, AMD MI300X.
