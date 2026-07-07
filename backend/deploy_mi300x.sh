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
    cat >> .env <<EOF

# --- MI300X profile (appended by deploy_mi300x.sh) ---
PUBLIC_BASE_URL=http://${node_ip}:8000
VISION_BACKEND=sam3
SDXL_MODEL=stabilityai/stable-diffusion-xl-base-1.0
MAX_IMAGES_PER_RUN=500
MAX_EPOCHS=100
EOF
    echo ">> Wrote .env — add FIREWORKS_API_KEY (and run huggingface-cli login for SAM 3)."
else
    echo ">> .env exists, leaving it alone."
fi

echo
echo "Done. Start the backend with:"
echo "  source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000"
echo
echo "Optional — serve Gemma on this GPU (zero API cost):"
echo "  pip install vllm && vllm serve google/gemma-3-27b-it --port 8001"
echo "  then set FIREWORKS_BASE_URL=http://localhost:8001/v1,"
echo "  FIREWORKS_MODEL=google/gemma-3-27b-it, LLM_PROVIDER_LABEL='vLLM · MI300X (local)'"
