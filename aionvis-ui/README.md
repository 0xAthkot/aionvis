# aionVIS — MLOps Command Center

Frontend-first control plane for an autonomous agent swarm that generates,
self-verifies and labels training data, then trains deployable YOLO models
natively on AMD MI300X hardware. Built for the AMD Developer Hackathon ACT II
(Unicorn Track).

**The entire product runs today with no backend.** Every screen talks to a
typed API contract served in-browser by an MSW mock layer, and live behavior
(agent reasoning terminal, stage transitions, VRAM telemetry) comes from a
pipeline simulator that emits the exact WebSocket events the future FastAPI
backend will send.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000 — any credentials sign you in
```

`npm run build` / `npm run lint` must stay clean.

## Try the demo flow

See [DEMO.md](DEMO.md) for the 90-second script. Short version: sign in →
**Foundry** → pick a project, write a scene prompt, preview the Gemma 4
expansion → **Launch autonomous run** → watch Mission Control stream the
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
│   │   ├── types.ts      #   every entity (mirrors future Pydantic models)
│   │   ├── endpoints.ts  #   REST + WS route map
│   │   ├── client.ts     #   typed fetch wrapper
│   │   └── streams.ts    #   StreamSource interface + WsStreamSource (real impl, ready)
│   ├── mocks/            # MSW handlers, seed fixtures, pipeline simulator
│   └── stores/           # Zustand: auth (mock), integrations (localStorage)
├── hooks/                # use-run-stream, use-telemetry, use-launch-run, …
└── config/features.ts    # mock/real switch via env vars
```

Key principle: components only import from `lib/api`. Nothing outside
`lib/mocks` knows the backend is fake.

## Connecting the real backend

The real FastAPI backend (agent swarm: Gemma via vLLM → SDXL-Turbo →
YOLOE/SAM 3 → Gemma-VLM Critic → Ultralytics YOLOv10 training) lives in
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
