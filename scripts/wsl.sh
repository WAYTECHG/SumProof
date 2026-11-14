#!/usr/bin/env bash
# Run any command inside the SumProof WSL environment.
# From Windows:  wsl -d Ubuntu -- bash /mnt/c/<path to>/SumProof/scripts/wsl.sh python -m sumproof.receipts.evaluate --tag smoke --limit 5
set -eo pipefail
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Share the Windows Hugging Face cache (models are stored once): when the repo lives under
# /mnt/<drive>/Users/<name>/..., use that Windows user's cache unless HF_HOME is already set.
if [[ -z "${HF_HOME:-}" && "$PROJECT" =~ ^(/mnt/[a-z]/Users/[^/]+)/ ]]; then
  export HF_HOME="${BASH_REMATCH[1]}/.cache/huggingface"
fi
export TMPDIR="$HOME/.cache/tmp"   # Ubuntu 26.04 keeps /tmp in RAM; large files go to disk
export PYTHONUNBUFFERED=1
source "$HOME/venvs/sumproof/bin/activate"
cd "$PROJECT"
exec "$@"
