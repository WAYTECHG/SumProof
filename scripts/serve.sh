#!/usr/bin/env bash
# Live receipt reader for the web interface (fine-tuned Qwen3.5-4B on the local GPU).
#
#   bash scripts/wsl.sh bash scripts/serve.sh              # greedy reading, ~11 s per receipt
#   SUMPROOF_SAMPLES=4 bash scripts/wsl.sh bash scripts/serve.sh   # best-of-5 with the checker, ~28 s
#
# Then open the interface (npm run dev in web/, or the deployed site) and upload a receipt photo.
# The server listens on http://localhost:8000 (Windows forwards localhost into WSL).
set -eo pipefail
python -m sumproof.api
