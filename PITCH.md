# aionVIS — the pitch

**One sentence in → deployable detection model out. Zero human labeling.**

## The problem

Every company that wants computer vision hits the same wall: training data.
Collecting site imagery takes months, labeling it costs $0.03–$0.10 *per box*
at scale (a modest 100k-image dataset runs $50k+ with QA), and the moment the
camera angle or product changes, you pay again. Data labeling is a
multi-billion-dollar market that exists only because models can't feed
themselves.

## The product

aionVIS is an autonomous agent swarm that feeds them:

1. **Prompt Agent** (LLM) takes the use case in the customer's words — "my
   drone needs to detect rotten potatoes" — infers the deployment viewpoint
   and environment, and designs hundreds of domain-randomized scene prompts
   itself. Nobody writes a diffusion prompt.
2. **Synthesis Agent** (SDXL/FLUX) renders them into photorealistic training
   images.
3. **Vision Agent** (SAM 3 / open-vocabulary segmentation) labels every
   object — no fixed class list, any noun works.
4. **Critic Agent** re-derives every box from pure mask geometry and rejects
   or regenerates bad labels, then a vision-language model (Gemma) spot-checks
   accepted crops semantically — geometry proves the box fits, the VLM
   proves it's actually a forklift. The swarm QAs itself; typical runs
   reject 2–3× more candidate labels than they accept.
5. **MLOps Agent** trains the detector on the accepted data — 22 architectures
   (YOLOv10/11/26, RT-DETR, RF-DETR) across 5 task types — streams live
   metrics, writes its own model card, and exports deployable `.pt`/ONNX
   weights.

The customer never draws a box. For teams with existing imagery, the same
swarm labels uploaded archives (BYOD path) — that's the Scale AI workflow
without the humans.

And the loop closes: when a trained model misses something in the inference
playground, one click sends that failure back to the Foundry — the next
run's Prompt Agent generates scenarios specifically covering it. The swarm
doesn't just label data; it learns from its models' mistakes.

## Why now, why AMD

**On other GPUs our agents take turns. On one MI300X they work at the same
time.** The warm swarm measures **125 GB** on the live node — Gemma 4 26B MoE
via vLLM, FLUX.2-klein, SAM 3 — leaving ~67 GB for training. No 80 GB card
holds that; an H100 forces the load→use→flush choreography we run in
sequential mode. One MI300X's **192 GB of HBM3 holds the entire swarm
resident**, so the pipeline switches to streaming mode
(`PIPELINE_MODE=streaming`): synthesis, vision and critic overlap as
producer/consumer streams on one device, four runs share the card
(`GPU_SLOTS=4`), and training sizes its batch to the VRAM actually free.
Our orchestrator schedules the GPU explicitly either way (run queue, live
VRAM telemetry via `amd-smi`), so a single MI300X serves a whole team.
That's the unit economics: one GPU-hour of MI300X replaces roughly a
thousand dollars of human labeling.

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
| **aionVIS** | **generated from a sentence** | **self-verified by agents** | **no** |

The self-correcting Critic is the moat: synthetic data is easy to generate
and hard to trust. We ship the trust layer.

## Status — deployed, measured, live

Running on an AMD Developer Cloud **MI300X today**, not "designed for" one:
real diffusion, real open-vocab segmentation, real Critic verdicts, real
training with live telemetry, an inference playground to prove every model,
and a multi-tenant control plane. Two runs off that node:

| | Warehouse safety | Hot Wheels (toy cars) |
|---|---|---|
| Images (synthetic, zero human labels) | 500 | 5,000 |
| Verified labels | 22,718 accepted / 42,214 rejected | 6,027 accepted / 3,273 rejected |
| Model | yolo26m, 60 epochs | yolo26n, 40 epochs |
| Accuracy | mAP50 **0.764** · mAP50-95 0.611 | mAP50 **0.960** · mAP50-95 0.946 |
| Wall clock · GPU cost | ~38 min · **~$1.25** | ~44 min training · **~$1.47** |

The console is public at [aionvis.com](https://aionvis.com) — click through
the simulated swarm, or attach your own MI300X node with a URL and an API key.
