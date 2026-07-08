# Parallel Swarm Plan — `PIPELINE_MODE=streaming`

Implementation plan for the MI300X parallel-agents feature. Written
2026-07-08, to be executed in a fresh session. Read HANDOFF.md first; this
document assumes its context and follows the repo's contract-first rule.

## Why (the judge story)

The swarm's resident working set is ~110–115 GB (Gemma 3 27B via vLLM
~65–70 GB, FLUX.1-schnell pipeline ~33 GB, SAM 3 + fallbacks + headroom).
No single NVIDIA card holds that — even an H100 (80 GB) forces the
load→use→flush choreography we run today. One MI300X (192 GB) holds the
entire swarm simultaneously, so agents can work **in parallel on one
device**. That is the unique-AMD-advantage demo: *"On other GPUs our
agents take turns. On one MI300X they work at the same time."*

## The one rule of this feature

**Two modes, one config switch, zero behavior change by default.**

- `PIPELINE_MODE=sequential` (default) — exactly today's pipeline. This is
  the mode for the RTX 4060, CPU boxes, and any GPU that can't hold the
  swarm. Do not regress it; every existing test must pass untouched.
- `PIPELINE_MODE=streaming` — producer/consumer overlap of synthesis →
  vision → critic, all models resident (requires `KEEP_MODELS_WARM=true`).
  Training still runs last (it needs the full compiled dataset — the
  trainer joins after the streams drain). Set by `deploy_mi300x.sh`.

Everything below is gated on that setting. Simple-mode doctrine applies:
the mode is explained, never a user decision — the backend picks it from
hardware config.

## 1. Contract changes (types.ts → schemas.py, in this order)

| Change | Where | Notes |
|---|---|---|
| `PipelineMode = "sequential" \| "streaming"` | types.ts + schemas.py | new type |
| `PipelineRun.pipelineMode?: PipelineMode` | both | set by backend at run creation from settings; optional so old state.json loads |
| `RunProgress.imagesAnnotated?: number` | both | vision throughput becomes visible separately from critic's masksAccepted in streaming mode |
| `HardwareNode.residentModels?: string[]` | both | e.g. `["Gemma 3 27B (vLLM)", "FLUX.1-schnell", "SAM 3"]`; powers the "resident swarm" readout |

Stage semantics in streaming mode (document in BACKEND_CONTRACT.md, do
NOT change the `PipelineStage` enum): `run.stage` = the earliest stage
that still has pending items (the bottleneck stage); `StageTransition`
events still fire in order when a stage fully drains. Mission Control's
existing stage tracker stays correct under this definition.

## 2. Backend

### 2.1 Config (`app/config.py`)
```python
pipeline_mode: str = "sequential"   # "streaming" on the MI300X
gpu_slots: int = 1                  # concurrent runs sharing the card
auto_batch: bool = False            # fractional ultralytics batch sizing
```
Validation: `streaming` requires `keep_models_warm` — log a warning and
fall back to sequential if not (never crash the server on config).

### 2.2 Guardrails first (independent, ship before streaming)
- **Auto-batch** (`mlops_agent.py`): when `auto_batch` and device != cpu,
  pass ultralytics a fractional batch `min(0.6 / settings.gpu_slots, …)`
  instead of an int — ultralytics measures free VRAM at train start
  (after the warm swarm claimed its share) and sizes the batch to fit.
  Works on ROCm (`torch.cuda.mem_get_info` is HIP-backed). `MAX_BATCH_SIZE`
  stays the ceiling for int mode.
- **OOM retry net** (`mlops_agent.py`): catch `torch.cuda.OutOfMemoryError`
  around `model.train(...)`, halve the batch (or fraction), flush, retry
  **once**, log clearly. A run degrades instead of dying.
- **vLLM flag** (`deploy_mi300x.sh` + backend/README): the serve line must
  be `vllm serve google/gemma-3-27b-it --port 8001 --gpu-memory-utilization 0.35`
  — vLLM's 0.9 default would grab ~170 GB and starve the swarm.

### 2.3 Agent refactors (make per-item APIs explicit)
- `vision_agent`: `_load_yoloe/_load_sam3` already return
  `(annotate_one, teardown)` closures — promote to a small session object
  `vision_agent.start(ctx, prompts) -> VisionSession` with
  `.annotate_one(path)` / `.close()`. Both modes use it.
- `critic_agent`: extract the per-image body of `review()` into
  `review_one(ctx, ann) -> ReviewedImage` (pure, updates progress
  counters); `review()` becomes a loop over it. Semantic `spot_check`
  stays a batch pass at the end in both modes (it samples across the
  whole run).
- `synthesis_agent.generate` gains an optional `on_image(path, scenario)`
  callback fired per image (in addition to on_progress).

### 2.4 Streaming orchestrator (`orchestrator/pipeline.py`)
New `_streaming_stages(ctx, workdir) -> list[ReviewedImage]`:
- Three threads + two `queue.Queue(maxsize=4)` (bounded so a stalled
  consumer applies backpressure instead of buffering the whole run):
  `synth → q1 → vision → q2 → critic(collect)`.
- Synthesis thread = today's generate loop pushing each finished image.
  Vision thread opens ONE VisionSession, consumes q1, pushes annotations,
  bumps `progress.images_annotated`. Critic thread consumes q2 via
  `review_one`, collects the ReviewedImage list in arrival order.
- Sentinel `None` flows down the queues on completion. Cancellation:
  every loop checks `ctx.cancel_event`; on exception in any thread, set a
  shared `failure` slot, drain/poison the queues, join all, re-raise the
  first exception (preserve today's failure semantics).
- Agent states: synth/vision/critic all `working` concurrently — this is
  the Mission Control money shot. `ctx` publishing is thread-safe (see
  context.py docstring) but VERIFY log-id uniqueness under concurrent
  `ctx.log` calls — `_log_seq` increments must be locked.
- Stage bookkeeping: enter `synthesis` at start; fire transitions
  `synthesis→segmentation` when the synth thread finishes,
  `segmentation→critic_review` when vision drains, then semantic
  spot-check → compile → training exactly as today. `_pct` in streaming:
  overall = weighted mean of the three per-image fractions.
- BYOD in streaming mode: vision+critic overlap (skip synth thread).
  Audit-mode runs stay sequential (they're instant — no benefit).
- `_worker` dispatch: `if settings.pipeline_mode == "streaming" and run
  is eligible → _streaming_stages else` today's path. Eligibility:
  synthetic or unlabeled BYOD.

### 2.5 Concurrent runs
- `Semaphore(1)` → `Semaphore(settings.gpu_slots)`; queue-position log
  copy adapts ("position 2 of a 2-slot GPU"). Playground inference: when
  `gpu_slots > 1`, don't force CPU while a pipeline is active (the card
  has room) — gate the existing `gpu_busy` demotion on `gpu_slots == 1`.

### 2.6 Residency readout
- `telemetry.build_node()`: populate `resident_models` from
  `synthesis_agent._warm_pipe`, `vision_agent._warm_models`, and a cached
  `prompt_agent.available` probe (label from `settings.llm_model`).

## 3. MSW mock + simulator (demo parity — judges see this first)

- Mock hardware node is an MI300X → mock runs get
  `pipelineMode: "streaming"` and `residentModels` on the node fixture.
- `simulator.ts`: add a streaming flavor — during the overlap phase set
  prompt→done, then synthesis+vision+critic all `working` with
  interleaved logs (`imagesGenerated`, new `imagesAnnotated`,
  `masksAccepted` advancing as staggered counters ~1–2s apart), stage
  transitions on drain, trainer last. Sequential simulation stays for
  BYOD-audit runs so both modes are demoable in the browser.

## 4. Dashboard / Mission Control UI

- `runs/[id]` header: mode badge — `Parallel swarm · MI300X` vs
  `Sequential`, with a tooltip explaining why (VRAM).
- `stage-tracker.tsx`: streaming variant — during the overlap phase show
  the three middle stages as simultaneous mini progress lanes
  (generated / annotated / verified counts from RunProgress) instead of
  one active chip; collapse back to the linear tracker for compile →
  training. Sequential rendering unchanged.
- `agent-roster.tsx`: no changes needed (already per-agent states) —
  verify it reads well with 3 concurrent `working` agents.
- `gpu-fleet-card.tsx` (dashboard) + hardware page: "Resident swarm"
  chip row from `HardwareNode.residentModels`; empty/absent → hidden
  (sequential nodes).

## 5. Landing page — agents section two-mode visual

`src/components/landing/agent-pipeline.tsx` gets a mode toggle (two tabs
or an auto-cycling switch, respect `motion-reduce`):
- **"Any GPU — agents take turns"**: the current linear chain animation,
  one agent active at a time (today's component, unchanged as mode A).
- **"One MI300X — the swarm works in parallel"**: Prompt hands off, then
  Synthesis / Vision / Critic render as peer NODES working concurrently —
  pulsing simultaneously with animated flow edges between them (CSS only,
  no new deps) — feeding a join into the MLOps trainer node at the end
  (the trainer explicitly waits: caption "trains once every label is
  verified"). Sub-caption: "192 GB HBM3 holds the entire swarm resident —
  Gemma 3 27B, FLUX, SAM 3 — at once."
- Copy note for the section header: this is the AMD-unique-advantage
  pitch; keep the exact line "On other GPUs our agents take turns. On one
  MI300X they work at the same time."

## 6. Docs
- BACKEND_CONTRACT.md: new fields + streaming stage semantics note.
- HANDOFF.md: capability bullet + gotchas (vLLM `--gpu-memory-utilization
  0.35`; streaming requires keep-warm; auto-batch fraction / gpu_slots).
- `.env.example` + `deploy_mi300x.sh` profile: `PIPELINE_MODE=streaming`,
  `GPU_SLOTS=2`, `AUTO_BATCH=true`.
- PITCH.md / DEMO.md: one beat for the parallel-swarm moment (hardware
  page telemetry + Mission Control all-agents-working shot).

## 7. Verification on the GPU-less dev box (all of this runs on CPU)

1. `tsc --noEmit`, `npm run lint`, `python smoke_test.py` — unchanged green.
2. **Unit**: queue orchestration test with stubbed agents (monkeypatch
   synthesis/vision/critic with fast fakes; assert ordering, backpressure,
   cancellation mid-stream, exception propagation, log-id uniqueness).
3. **Sequential regression**: rerun the labeled-zip audit run and classify
   run (see HANDOFF "What v0.4 can do") — identical results.
4. **Streaming e2e on CPU**: 4-image unlabeled BYOD run with
   `PIPELINE_MODE=streaming` (downloads YOLOE ~100 MB + MobileCLIP
   ~570 MB once; ~1 s/image CPU) — assert vision/critic overlap in the
   log timeline (interleaved agent tags) and a succeeded run.
5. **GPU_SLOTS=2**: launch two audit runs simultaneously; both must run
   concurrently (no queue log) and both succeed.
6. Mock mode: streaming simulation renders in Mission Control; landing
   toggle renders both modes; dataviz not applicable (no new charts).
7. What CANNOT be verified locally (list honestly in the commit): real
   VRAM co-residency, FLUX/SAM3/vLLM concurrency, auto-batch sizing on
   ROCm — first exercised on the MI300X.

## 8. Execution order for the session

1. Contract fields (types → schemas) + config + docs rows.
2. Guardrails (auto-batch, OOM retry, vLLM flag) — commit 1.
3. Agent refactors + streaming orchestrator + GPU_SLOTS + residency —
   backend verify (steps 2–5) — commit 2.
4. MSW/simulator + Mission Control UI + landing two-mode visual —
   frontend verify — commit 3.
5. HANDOFF/PITCH/DEMO updates, delete this plan file (it's done) —
   commit 4.
