# SHIP_PLAN — Real backend on MI300X + Vercel ship

Written 2026-07-09. Executes the decisions made that day with Stelios.
Read `HANDOFF.md` first — this file assumes it. Work the phases **in
order**; do not start a phase before the previous phase's exit gate is
verified. The developer machine is Windows, has **no GPU**, and drives
everything through the local UI + runtime node attach.

## Decisions already made (do not re-litigate)

- **Compute: AMD Developer Cloud MI300X droplet.** $100 credits ≈ 50 h
  at ~$1.99/h. The alternative — an 8 h hosted ROCm notebook (ROCm 7.2 +
  vLLM 0.16.0 + PyTorch 2.9) — was rejected as the deployment target (no
  public ports for REST/WS, ephemeral, 8 h hard cap) and is **held in
  reserve, untouched**, as a free fallback for reproducing ROCm quirks.
- **Nothing gets hosted during development.** The UI runs on the dev
  machine (`npm run dev`, mock mode) and attaches to the droplet at
  runtime: Hardware → "Connect AMD Developer Cloud" → URL + key. Every
  screen and WebSocket switches to the node instantly.
- **Ship target: Vercel** (the Next.js app: landing at `/`, open-source
  console at `/dashboard`). Mock mode is the default visitor experience;
  the real backend is attached at runtime. **Blocker to clear first:**
  Vercel is HTTPS, browsers block `http://`/`ws://` calls from it —
  the droplet needs TLS (Phase 4) before the Vercel deploy (Phase 5).
- Billing runs while the droplet is up: **snapshot/destroy between work
  sessions.** Weights (~90 GB) re-download on a fresh droplet; a snapshot
  avoids that.
- Docker-compose verification stays on the roadmap for judges but is
  **out of scope here** — the production path is droplet + Vercel.

## Budget (≈ $2/h)

| Phase | Est. GPU time | Est. cost |
|---|---|---|
| 2 — bring-up + smoke test | 2–3 h | ~$6 |
| 3 — warm-up + 500-img flagship streaming run | 3–5 h | ~$10 |
| 3 — flagship retrain + evidence capture | 2–3 h | ~$6 |
| 4 — TLS (Caddy) | 1 h | ~$2 |
| 5 — Vercel ship verification | 1–2 h | ~$4 |
| Rehearsal + failure buffer | remainder | ~$70 reserve |

## Phase 0 — Local preflight (free, no droplet yet)

All on the dev machine. Burn zero paid time on avoidable errors.

1. Clean tree, `npm run lint` + `npx tsc --noEmit` in `auto-annotator-ui`
   pass (0 errors).
2. `npm run build` in `auto-annotator-ui` succeeds — this is exactly what
   Vercel will run in Phase 5; fix any prod-build-only breakage now.
3. Backend pytest suite passes in `backend/.venv`
   (`PYTHONIOENCODING=utf-8`).
4. Re-read `backend/deploy_mi300x.sh` — the vLLM-on-ROCm fix (PyPI vllm
   wheels are CUDA-only; use the vLLM-preloaded droplet image or the
   `rocm/vllm` container) is committed as `ced76a6`.

**Exit gate:** lint, tsc, prod build, pytest all green.

## Phase 1 — Create the droplet (user-only step)

1. AMD Developer Cloud → new MI300X instance. **Prefer the
   vLLM-preloaded GPU image** if offered; otherwise plain ROCm/Ubuntu.
2. Add an SSH key; note the public IP.
3. Open inbound TCP 8000 (backend) — and 80/443 for Phase 4 — if the
   image firewalls by default.

**Exit gate:** `ssh` onto the node works; `amd-smi static --asic` (or
`rocm-smi`) shows the MI300X.

## Phase 2 — Backend bring-up on the node (~2–3 h)

On the droplet:

```bash
git clone <repo> && cd <repo>
bash backend/deploy_mi300x.sh        # ROCm stack, streaming .env profile, mints AA_API_KEY
huggingface-cli login                # gated: google/gemma-3-27b-it + SAM 3 checkpoint
# vLLM — REQUIRED flag; 0.9 default grabs ~170 of 192 GB and starves the swarm:
vllm serve google/gemma-3-27b-it --port 8001 --gpu-memory-utilization 0.35
#   (plain ROCm image: use the rocm/vllm container — exact command is
#    printed by deploy_mi300x.sh; do NOT pip install vllm, wheels are CUDA-only)
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
python smoke_test.py                 # picks up AA_API_KEY from .env
```

Then from the dev machine: `npm run dev` (mock mode), Hardware →
"Connect AMD Developer Cloud" → `http://<ip>:8000` + the key printed by
the deploy script.

Known traps (from HANDOFF, all previously hit): `transformers<5` pin is
sacred; `PIPELINE_MODE=streaming` needs `KEEP_MODELS_WARM=true`; SAM 3
checkpoint is gated (YOLOE is the automatic fallback); if the LLM port is
unreachable the Prompt Agent silently degrades to templates — smoke_test
reports which path is live.

**Exit gate:** smoke_test all green on the node **and** the local UI is
attached with a live-updating Mission Control stream.

## Phase 3 — Verification runs + flagship model

First real hardware exercise of the parallel swarm (CPU verified only
the orchestration).

1. **Warm-up run** (small, e.g. 8 images): confirms FLUX/SDXL + SAM 3 +
   vLLM co-reside in VRAM under `KEEP_MODELS_WARM=true`. Watch
   `amd-smi` VRAM; OOM knobs: `GPU_SLOTS`, `MAX_BATCH_SIZE`,
   `MAX_TRAIN_IMAGE_SIZE`, vLLM's 0.35.
2. **Flagship streaming run:** the proven warehouse use case ("our
   warehouse safety cameras need to spot forklifts, wooden pallets and
   workers in safety vests in the aisles"), 500 images, streaming mode,
   `GPU_SLOTS=2`, `AUTO_BATCH=true`. Capture evidence: concurrent-lane
   Mission Control, interleaved agent logs, throughput vs sequential.
3. **Flagship retrain:** 48 img / 60 epochs on `yolo26m` — target:
   beat `model_0006` (yolov10n, mAP50 0.85). Remember `MAX_EPOCHS` in
   `backend/.env` overrides `app/config.py`.
4. Playground inference sanity + "Send to Foundry" active-learning loop
   once. Export one model (.pt + ONNX) and one dataset (COCO) end-to-end.

**Exit gate:** flagship model beats mAP50 0.85; a full streaming run
completed with no OOM; evidence captured (screenshots + metrics).

## Phase 4 — TLS on the droplet (Vercel prerequisite)

1. Hostname: a real (sub)domain pointed at the droplet IP, or zero-cost
   `<ip-with-dashes>.sslip.io` (works with Let's Encrypt).
2. Caddy on the node (proxies REST **and** WebSockets automatically):

   ```
   node.yourdomain.com {
       reverse_proxy localhost:8000
   }
   ```

3. `PUBLIC_BASE_URL=https://node.yourdomain.com` in `backend/.env`
   (`CORS_ORIGINS=*` is already set by the deploy script); restart
   uvicorn (bind it to localhost now — Caddy is the public face; close
   raw port 8000 inbound).
4. Re-run smoke_test against the https URL; re-attach the local UI via
   `https://…` and confirm the WS stream runs over `wss://`.

**Exit gate:** full UI session (run launch + live stream + image
thumbnails via `/files`) over https/wss with raw :8000 closed.

## Phase 5 — Vercel ship

1. Vercel project → import the repo, **Root Directory =
   `auto-annotator-ui`**. Env: `NEXT_PUBLIC_USE_MOCKS=true` (visitors
   get the fully working mock console; real nodes are attached at
   runtime, so no backend URL is baked in).
2. Deploy preview → verify landing, `/dashboard` in mock mode, a full
   simulated run.
3. From the **deployed** site: Hardware → attach
   `https://node.yourdomain.com` + key → verify a real run streams live.
4. `vercel --prod`. Rehearse `auto-annotator-ui/DEMO.md` (Pro mode —
   fresh browsers default to Simple) against the production URL.

**Exit gate:** production URL serves the landing + console; mock mode
works logged-out-cold; real node attach works from the shipped site.

## Session handoff prompt

Paste this to start the implementation session:

> Read HANDOFF.md and SHIP_PLAN.md top to bottom, then execute
> SHIP_PLAN.md phase by phase to get Auto-Annotator production ready. I
> have no local GPU — everything local runs in mock mode; GPU work
> happens on an AMD Developer Cloud MI300X droplet ($100 credits) that I
> create in Phase 1 and you drive by telling me exactly what to run over
> SSH (I'll paste output back). Droplet status: <not created yet | IP:
> ___, AA_API_KEY: ___>. Start with Phase 0 and verify every exit gate
> before moving on; if a gate fails, debug it before proceeding. Don't
> re-open decisions recorded in SHIP_PLAN.md. Keep a running note of
> droplet hours burned. Update SHIP_PLAN.md with a ✅ and date on each
> completed phase so the next session knows where we are.
