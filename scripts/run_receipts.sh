#!/usr/bin/env bash
# Receipt pipeline: fine-tune, then the four evaluation rows of the README table.
#
#   bash scripts/wsl.sh bash scripts/run_receipts.sh               # train + evaluate
#   bash scripts/wsl.sh bash scripts/run_receipts.sh --eval-only   # evaluate the saved epoch-1 adapter
#   bash scripts/wsl.sh bash scripts/run_receipts.sh --eval-only --from 2   # skip evaluations already done
#
# Progress log: results/run_receipts.log      Dashboard: tensorboard --logdir runs
set -eo pipefail
LOG=results/run_receipts.log
mkdir -p results
step() { echo "=== $(date '+%H:%M:%S') $*" | tee -a "$LOG"; }
eval_filter() { grep --line-buffered -E "^[0-9]+/100|seconds_per|field_f1|Error|error" | tee -a "$LOG"; }

FROM=1
[[ "$2" == "--from" ]] && FROM="$3"
run() { [[ "$1" -ge "$FROM" ]]; }   # run evaluation number $1 only if it is at or after --from

if [[ "$1" == "--eval-only" ]]; then
  # Training stopped at step 165/200 (out of RAM); the epoch-1 checkpoint scored val F1 0.977.
  ADAPTER=runs/sft/adapter-epoch1.0
  step "Eval-only mode, adapter: $ADAPTER"
else
  ADAPTER=runs/sft/adapter
  step "SFT: QLoRA fine-tune, 2 epochs on 800 receipts"
  python -m sumproof.receipts.train_qlora --epochs 2 --val-limit 30 --out runs/sft 2>&1 \
    | grep --line-buffered -E "^\{|^val:|trainable|Error|error" | tee -a "$LOG"
fi

if run 1; then step "Eval 1/4: fine-tuned, greedy"
python -m sumproof.receipts.evaluate --tag sft --adapter "$ADAPTER" 2>&1 | eval_filter; fi

if run 2; then step "Eval 2/4: fine-tuned + verifier-guided best-of-4"
python -m sumproof.receipts.evaluate --tag sft_best4 --adapter "$ADAPTER" --samples 4 2>&1 | eval_filter; fi

if run 3; then step "Eval 3/4: zero-shot, greedy"
python -m sumproof.receipts.evaluate --tag zeroshot 2>&1 | eval_filter; fi

if run 4; then step "Eval 4/4: zero-shot + verifier-guided best-of-4"
python -m sumproof.receipts.evaluate --tag zeroshot_best4 --samples 4 2>&1 | eval_filter; fi

python -m sumproof.receipts.plot_training runs/sft | tee -a "$LOG"
step "ALL DONE"
