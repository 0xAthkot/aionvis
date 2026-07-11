#!/usr/bin/env bash
# One-shot setup for AMD Developer Cloud (MI300X, Ubuntu + ROCm image).
# Run from the repo root:  bash backend/deploy_mi300x.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "== GPU check =="
amd-smi static --asic 2>/dev/null | head -5 || rocm-smi --showproductname || {
    echo "No AMD GPU visible — is this an MI300X instance?"; exit 1; }

echo "== Python env =="
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip

echo "== Dependencies (ROCm wheels) =="
pip install -r requirements.txt
# torch MUST come from the ROCm index with --index-url: with --extra-index-url
# pip prefers PyPI's newer version, which is a CUDA build on Linux.
# Verified on the AMD Developer Cloud MI300X (ROCm 7.2.4 host) 2026-07-10.
pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.4
pip install -r requirements-ml.txt

echo "== Torch sees the GPU? =="
python - <<'PY'
import torch
assert torch.cuda.is_available(), "torch.cuda (ROCm/HIP) not available"
print("OK:", torch.cuda.get_device_name(0), "-", torch.version.hip)
PY

echo "== SAM 3 sidecar (.venv-sam3: transformers 5, isolated from SDXL) =="
# facebook/sam3 is MANUALLY GATED on Hugging Face — request access for the
# node's HF account first, or sam3 runs fail with the 403 reason (by design:
# the user's labeler choice is honored verbatim, never substituted).
if [ ! -f .venv-sam3/bin/python ]; then
    python3 -m venv .venv-sam3
    .venv-sam3/bin/pip install --upgrade pip
    .venv-sam3/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.4
    .venv-sam3/bin/pip install 'transformers>=5.5' accelerate pillow numpy scipy
fi
.venv-sam3/bin/python -c 'from transformers import Sam3Model; print("SAM 3 sidecar OK")'

echo "== .env =="
if [ ! -f .env ]; then
    cp .env.example .env
    # Drop the template's empty AA_API_KEY= so the appended real key is the
    # only occurrence (first-match .env readers otherwise see an empty key).
    sed -i '/^AA_API_KEY=$/d' .env
    node_ip=$(hostname -I | awk '{print $1}')
    # The key the Control Plane's "Connect AMD Developer Cloud" form takes.
    aa_key="aa_node_$(openssl rand -hex 24)"
    cat >> .env <<EOF

# --- MI300X profile (appended by deploy_mi300x.sh) ---
PUBLIC_BASE_URL=http://${node_ip}:8000
# Protects /api/v1 + /ws/v1 on this public node; paste into the UI to attach.
AA_API_KEY=${aa_key}
# Allow the console to attach from anywhere (it authenticates with the key).
CORS_ORIGINS=*
# Node DEFAULT labeler (each run may override via visionBackend). sam3 runs
# in the .venv-sam3 sidecar this script installs; the checkpoint is gated —
# request access on HF or sam3 runs fail with the reason (no fallback).
VISION_BACKEND=sam3
SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
# FLUX.2 klein: Apache-2.0, ungated, ~13 GB — the flux wizard choice.
FLUX_MODEL=black-forest-labs/FLUX.2-klein-4B
# Gemma 4 MoE (Apache-2.0): near-31B quality, 4B active params — serve with
# vLLM at --gpu-memory-utilization 0.50 (see the echo at the end).
LLM_MODEL=google/gemma-4-26B-A4B-it
MAX_IMAGES_PER_RUN=500
MAX_EPOCHS=100
# 192 GB: feed the card and keep every stage model resident.
MAX_BATCH_SIZE=96
MAX_TRAIN_IMAGE_SIZE=1024
KEEP_MODELS_WARM=true
# Parallel swarm: synthesis/vision/critic overlap on the resident models,
# four runs share the card, training sizes its batch to the free VRAM.
PIPELINE_MODE=streaming
GPU_SLOTS=4
AUTO_BATCH=true
# Local vLLM has no per-token cost — audit more crops per run.
SEMANTIC_CRITIC_MAX_CHECKS=32
EOF
    echo ">> Wrote .env (run huggingface-cli login for SAM 3 + gated Gemma)."
else
    echo ">> .env exists, leaving it alone."
    aa_key=$(grep '^AA_API_KEY=' .env | cut -d= -f2-)
    node_ip=$(hostname -I | awk '{print $1}')
fi

echo
echo "Done. Start the backend with:"
echo "  source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000"
echo
echo "== Attach the Control Plane (no rebuild needed) =="
echo "  In the UI: Hardware -> Connect AMD Developer Cloud"
echo "    API endpoint:  http://${node_ip}:8000"
echo "    Access token:  ${aa_key:-<AA_API_KEY from backend/.env>}"
echo "  The console switches every screen + live stream to this node."
echo
echo "Serve Gemma 4 on this GPU (Prompt Agent + Semantic Critic, zero API cost):"
echo "  Use the vLLM ROCm container (PyPI vllm wheels are CUDA-only). The"
echo "  loopback env vars fix a Gloo 'Unable to find interface for [0.0.0.0]'"
echo "  crash under --network host (hit live on the Developer Cloud 2026-07-10):"
echo "    docker run -d --name vllm-gemma --restart unless-stopped \\"
echo "      --network host --device /dev/kfd --device /dev/dri --ipc host \\"
echo "      --group-add video --security-opt seccomp=unconfined \\"
echo "      -e HF_TOKEN=<your hf token> -e VLLM_HOST_IP=127.0.0.1 \\"
echo "      -e GLOO_SOCKET_IFNAME=lo -e NCCL_SOCKET_IFNAME=lo \\"
echo "      -v \$HOME/.cache/huggingface:/root/.cache/huggingface \\"
echo "      vllm/vllm-openai-rocm:v0.23.0 \\"
echo "      --model google/gemma-4-26B-A4B-it --port 8001 \\"
echo "      --gpu-memory-utilization 0.50"
echo "  (0.50 is the ceiling on the shared card: vLLM's 0.9 default would grab"
echo "  ~170 GB and starve FLUX/SAM 3/training. Matches the LLM_MODEL default;"
echo "  while port 8001 is down the backend uses its deterministic template"
echo "  fallback and skips the semantic critic)"
