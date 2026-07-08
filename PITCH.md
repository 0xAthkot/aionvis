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
   or regenerates bad labels, then a vision-language model spot-checks
   accepted crops semantically — geometry proves the box fits, the VLM
   proves it's actually a forklift. The swarm QAs itself; typical runs
   reject 2–3× more candidate labels than they accept.
5. **MLOps Agent** trains YOLOv10 on the accepted data, streams live metrics,
   writes its own model card, and exports deployable `.pt`/ONNX weights.

The customer never draws a box. For teams with existing imagery, the same
swarm labels uploaded archives (BYOD path) — that's the Scale AI workflow
without the humans.

And the loop closes: when a trained model misses something in the inference
playground, one click sends that failure back to the Foundry — the next
run's Prompt Agent generates scenarios specifically covering it. The swarm
doesn't just label data; it learns from its models' mistakes.

## Why now, why AMD

**On other GPUs our agents take turns. On one MI300X they work at the same
time.** The swarm's working set is ~110–115 GB — Gemma 3 27B via vLLM,
FLUX.1-schnell, SAM 3, plus training headroom. No NVIDIA card holds that;
even an H100's 80 GB forces the load→use→flush choreography we run in
sequential mode. One MI300X's **192 GB of HBM3 holds the entire swarm
resident**, so the pipeline switches to streaming mode
(`PIPELINE_MODE=streaming`): synthesis, vision and critic overlap as
producer/consumer streams on one device, two runs share the card
(`GPU_SLOTS=2`), and training sizes its batch to the VRAM actually free.
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
| **Auto-Annotator** | **generated from a sentence** | **self-verified by agents** | **no** |

The self-correcting Critic is the moat: synthetic data is easy to generate
and hard to trust. We ship the trust layer.

## Status

Fully functional end to end (this repo): real diffusion, real segmentation,
real Critic verdicts, real YOLOv10 training with live telemetry, inference
playground to prove every model, multi-tenant control plane. Runs today on
a single consumer GPU; designed for, and deploying to, AMD MI300X.
