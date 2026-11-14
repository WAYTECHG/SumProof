#!/usr/bin/env bash
# One-time setup of the GPU training environment inside WSL2 Ubuntu.
# Run from Ubuntu:  bash /mnt/c/<path to>/SumProof/scripts/setup_wsl.sh
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # the repo this script lives in
VENV=$HOME/venvs/sumproof          # Linux filesystem: much faster than /mnt/c for Python files

# Ubuntu 26.04 mounts /tmp in RAM (tmpfs, ~half of WSL memory). The PyTorch + CUDA
# wheels (~4 GB) overflow it, so pip unpacks on the real disk instead.
export TMPDIR=$HOME/.cache/tmp
mkdir -p "$TMPDIR"

echo "== GPU visible inside WSL? =="
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv

echo "== system packages =="
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip python3-dev build-essential git

echo "== Python environment =="
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip wheel
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
# requirements-gpu.txt includes flash-linear-attention, the Triton kernels for Qwen3.5's Gated DeltaNet layers.
pip install -r "$PROJECT/requirements.txt" -r "$PROJECT/requirements-gpu.txt"
# Optional fused causal conv; needs a compiler. Qwen3.5 falls back to PyTorch if this fails.
pip install causal-conv1d --no-build-isolation || echo "causal-conv1d not installed (optional)"

# Share the Windows Hugging Face cache so CORD and the model are stored once on disk:
# when the repo lives under /mnt/<drive>/Users/<name>/..., use that Windows user's cache.
re='^(/mnt/[a-z]/Users/[^/]+)/'
if [[ "$PROJECT" =~ $re ]] && ! grep -q "HF_HOME=" "$HOME/.bashrc"; then
  echo "export HF_HOME=${BASH_REMATCH[1]}/.cache/huggingface" >> "$HOME/.bashrc"
fi
grep -q "alias sumproof-env" "$HOME/.bashrc" || echo "alias sumproof-env='source $VENV/bin/activate && cd $PROJECT'" >> "$HOME/.bashrc"

echo "== check =="
python - <<'PY'
import torch, transformers, importlib.util
print("torch", torch.__version__, "| CUDA", torch.cuda.is_available(), torch.cuda.get_device_name(0))
print("transformers", transformers.__version__)
for mod in ("triton", "fla", "causal_conv1d", "bitsandbytes", "peft"):
    print(f"{mod:14s}", "ok" if importlib.util.find_spec(mod) else "MISSING")
PY
echo "Done. Open a new Ubuntu tab, type: sumproof-env"
