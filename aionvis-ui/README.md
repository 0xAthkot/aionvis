# aionVIS — MLOps Command Center

Frontend-first control plane for an autonomous agent swarm that generates,
self-verifies and labels training data, then trains deployable YOLO models
natively on AMD MI300X hardware. Built for the AMD Developer Hackathon ACT II
(Unicorn Track).

**The entire product runs with or without a backend.** Every screen talks to
a typed API contract; in demo mode an in-browser MSW layer serves it, and live
behavior (agent reasoning terminal, stage transitions, VRAM telemetry) comes
from a pipeline simulator that emits the exact WebSocket events the real
FastAPI swarm in [`../backend`](../backend/README.md) sends. Attach a live
MI300X node at runtime and the same screens stream from it.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Mock mode is the default. On the login page take **"Explore with simulated
data"** — no account, no GPU — or sign in with a node's endpoint URL + API key
to drive the real swarm on an AMD MI300X.

`npm run build` / `npm run lint` must stay clean.

## Try the demo flow

Enter the
console → **Foundry** → pick a project, say what the model is *for* (the use
case, not a diffusion prompt), preview the scenes the Gemma 4 Prompt Agent
designs → **Launch autonomous run** → watch Mission Control stream the
pipeline (synthesis → SAM 3 → Critic → training) while VRAM flushes between
stages → completion links to the minted dataset (bbox curation grid) and the
registered model (metrics + curves).

## Architecture

```
src/
├── app/                  # Next 16 App Router: login + (app) shell routes
├── components/           # layout, dashboard, foundry, datasets, runs, registry, ui (shadcn)
├── lib/
│   ├── api/              # ★ THE CONTRACT
│   │   ├── types.ts      #   every entity (mirrored 1:1 in backend/app/schemas.py)
│   │   ├── endpoints.ts  #   REST + WS route map
│   │   ├── client.ts     #   typed fetch wrapper
│   │   └── streams.ts    #   StreamSource interface + WsStreamSource (real impl, ready)
│   ├── mocks/            # MSW handlers, seed fixtures, pipeline simulator
│   └── stores/           # Zustand: auth (mock), integrations (localStorage)
├── hooks/                # use-run-stream, use-telemetry, use-launch-run, …
└── config/features.ts    # mock/real switch via env vars
```

Key principle: components only import from `lib/api`. Nothing outside
`lib/mocks` knows whether it is talking to the simulator or a live MI300X.

## Connecting the real backend

The real FastAPI backend (agent swarm: Gemma 4 via vLLM → FLUX.2-klein/SDXL →
SAM 3/YOLOE → Gemma-VLM Critic → YOLO/RT-DETR/RF-DETR training) lives in
[`../backend`](../backend/README.md) and implements
[BACKEND_CONTRACT.md](BACKEND_CONTRACT.md). Start it, then:

```bash
NEXT_PUBLIC_USE_MOCKS=false
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000
```

No component changes required — the fetch wrapper re-targets and
`WsStreamSource` replaces the simulator behind the same interface.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · shadcn/ui ·
TanStack Query · Zustand · Recharts · MSW
