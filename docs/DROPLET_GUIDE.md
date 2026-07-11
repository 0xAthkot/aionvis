# Run aionVIS on your own AMD MI300X droplet

Everything below was executed and verified live on an AMD Developer Cloud
MI300X droplet (ROCm 7.2.4) — including the traps, which are called out
where they bite.

**Time:** ~30–45 min, mostly model downloads. **Cost:** ~$2/hour —
snapshot or destroy the droplet when you're done; billing runs while it's up.

---

## 1 · Create the droplet

1. AMD Developer Cloud → new **MI300X** instance. Prefer the
   **vLLM-preloaded GPU image** if offered (ships Docker + the ROCm vLLM
   image); plain ROCm/Ubuntu works too.
2. Add your SSH key; note the public IP.
3. If the image firewalls by default, open inbound **TCP 8000** (backend),
   plus **80 + 443** if you want step 6 (TLS).

Check you're on the right hardware:

```bash
ssh root@<droplet-ip>
amd-smi static --asic | head -5     # should show the MI300X
```

> **Trap (vLLM-preloaded image):** a demo Jupyter container squats port
> 8000. Free it: `docker update --restart=no rocm && docker stop rocm`

## 2 · One-shot install

```bash
git clone https://github.com/0xAthkot/aionvis && cd aionvis
bash backend/deploy_mi300x.sh
```

The script verifies the GPU, installs the ROCm torch stack + the SAM 3
sidecar venv, writes a tuned streaming `.env` profile
(`PIPELINE_MODE=streaming`, `GPU_SLOTS=4`, `AUTO_BATCH=true`,
`KEEP_MODELS_WARM=true`), **mints your API key**, and prints three things
you'll need: the endpoint URL, the key, and the exact vLLM `docker run`
command for step 4.

## 3 · Hugging Face access (optional, 2 of 4 models)

```bash
huggingface-cli login
```

- **`facebook/sam3`** (flagship labeler) is manually gated — request access
  on its model page. Without it, simply pick **YOLOE** as the labeler in the
  run wizard (it's a per-run choice); a sam3 run without the checkpoint is
  rejected with the reason — aionVIS never substitutes silently. To make
  YOLOE the node default: `VISION_BACKEND=yoloe` in `backend/.env`.
- **Gemma 4** needs your HF token in the vLLM command (step 4).
- FLUX.2-klein and SDXL are ungated — no account needed.

## 4 · Start the swarm

Backend (first terminal / tmux pane):

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Gemma via vLLM (second pane) — paste the `docker run … vllm/vllm-openai-rocm:v0.23.0`
command **exactly as the deploy script printed it**. Two flags matter:

- `--gpu-memory-utilization 0.50` — required. vLLM's 0.9 default grabs
  ~170 of the 192 GB and starves FLUX, SAM 3 and training.
- The `VLLM_HOST_IP=127.0.0.1` / `GLOO_SOCKET_IFNAME=lo` env vars — they fix
  a Gloo *"Unable to find interface for [0.0.0.0]"* crash under
  `--network host` (hit live on the Developer Cloud).

Gemma is optional: while port 8001 is down, the Prompt Agent uses its
deterministic template designer and the semantic critic is skipped — runs
still complete end to end.

Preflight everything:

```bash
python smoke_test.py     # every endpoint + LLM + inference; picks up the key from .env
```

## 5 · Attach a console (easiest: local over plain HTTP)

On your own machine:

```bash
cd aionvis-ui && npm install && npm run dev    # → http://localhost:3000
```

Console → **Hardware → Connect AMD Developer Cloud** → paste
`http://<droplet-ip>:8000` + the key from step 2 → **Connect**. Every
screen and live WebSocket switches to your node instantly. (This works
over plain HTTP because the local console is HTTP too.)

## 6 · Attach from the hosted console (needs TLS, ~5 min)

[aionvis.vercel.app](https://aionvis.vercel.app) is served over HTTPS, so
browsers block plain `http://`/`ws://` calls to your node (mixed content).
Give the node a certificate with **sslip.io** — no domain, no signup:
`<your-ip-with-dashes>.sslip.io` already resolves to your IP.

```bash
# Caddy (official apt repo):
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

`/etc/caddy/Caddyfile` (dashes, not dots, in the IP):

```
203-0-113-7.sslip.io {
    reverse_proxy localhost:8000
}
```

`sudo systemctl reload caddy` — Caddy obtains the Let's Encrypt cert
automatically (ports 80/443 must be open). Then in `backend/.env` set
`PUBLIC_BASE_URL=https://203-0-113-7.sslip.io`, restart uvicorn bound to
localhost (`--host 127.0.0.1` — Caddy is the public face now, close raw
8000), and attach the hosted console with the `https://…` URL + key.
REST and WebSockets both proxy; the stream runs over `wss://` automatically.

## 7 · The flagship recipe

In the wizard, type the use case —

> *our warehouse safety cameras need to spot forklifts, wooden pallets and
> workers in safety vests in the aisles*

— 500 images, FLUX.2 + SAM 3, `yolo26m`, 60 epochs. On one MI300X this
measured **~38 minutes end to end (~$1.25)**: watch the concurrent agent
lanes in Mission Control, then try the trained model in the playground and
export it (.pt / ONNX).

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| `curl localhost:8000/api/v1/health` → 401 | Backend is **up**; it wants the API key (`Authorization: Bearer <key>`) |
| vLLM: `Unable to find interface for [0.0.0.0]` | You omitted the loopback env vars — use the printed command verbatim |
| sam3 run rejected at creation | Gated checkpoint not accessible — request HF access, or choose YOLOE |
| OOM during a run | Lower `GPU_SLOTS`, `MAX_BATCH_SIZE` or `MAX_TRAIN_IMAGE_SIZE` in `backend/.env` |
| `pip install vllm` fails / CUDA errors | PyPI vLLM wheels are CUDA-only — use the `vllm/vllm-openai-rocm` container |
| Port 8000 already in use (preloaded image) | The demo Jupyter container — `docker update --restart=no rocm && docker stop rocm` |

Done? **Destroy or snapshot the droplet** — it bills hourly.
