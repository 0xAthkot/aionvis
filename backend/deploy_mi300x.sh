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
pip install -r requirements-ml.txt --extra-index-url https://download.pytorch.org/whl/rocm6.2

echo "== Torch sees the GPU? =="
python - <<'PY'
import torch
assert torch.cuda.is_available(), "torch.cuda (ROCm/HIP) not available"
print("OK:", torch.cuda.get_device_name(0), "-", torch.version.hip)
PY

echo "== .env =="
if [ ! -f .env ]; then
    cp .env.example .env
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
VISION_BACKEND=sam3
SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
MAX_IMAGES_PER_RUN=500
MAX_EPOCHS=100
# 192 GB: feed the card and keep every stage model resident.
MAX_BATCH_SIZE=96
MAX_TRAIN_IMAGE_SIZE=1024
KEEP_MODELS_WARM=true
# Parallel swarm: synthesis/vision/critic overlap on the resident models,
# two runs share the card, training sizes its batch to the free VRAM.
PIPELINE_MODE=streaming
GPU_SLOTS=2
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
echo "Serve Gemma on this GPU (Prompt Agent + Semantic Critic, zero API cost):"
echo "  If the droplet was created from AMD's vLLM-preloaded image:"
echo "    vllm serve google/gemma-3-27b-it --port 8001 --gpu-memory-utilization 0.35"
echo "  On a plain ROCm image, use the prebuilt container — PyPI vllm wheels"
echo "  are CUDA-only and will NOT work here:"
echo "    docker run -d --network host --device /dev/kfd --device /dev/dri \\"
echo "      --ipc=host -v \$HOME/.cache/huggingface:/root/.cache/huggingface \\"
echo "      rocm/vllm:latest \\"
echo "      vllm serve google/gemma-3-27b-it --port 8001 --gpu-memory-utilization 0.35"
echo "  (--gpu-memory-utilization 0.35 is REQUIRED on the shared card: vLLM's"
echo "  0.9 default would grab ~170 GB and starve FLUX/SAM 3/training."
echo "  Matches the LLM_BASE_URL/LLM_MODEL defaults; without it the backend"
echo "  uses its deterministic template fallback and skips the semantic critic)"
