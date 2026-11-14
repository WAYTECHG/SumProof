"""Turn a training run into one image for the README.

  python -m sumproof.receipts.plot_training runs/qlora-cord
writes runs/qlora-cord/training_curve.png (loss + learning rate, validation F1).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main(run: str) -> None:
    run_dir = Path(run)
    log = json.loads((run_dir / "train_log.json").read_text(encoding="utf-8"))
    val_path = run_dir / "val_log.json"
    val = json.loads(val_path.read_text(encoding="utf-8")) if val_path.exists() else []

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4), constrained_layout=True)
    steps = [e["step"] for e in log]
    ax1.plot(steps, [e["loss"] for e in log], color="#2563eb", linewidth=1.6, label="training loss")
    ax1.set_xlabel("optimizer step")
    ax1.set_ylabel("loss (answer tokens)")
    ax1.set_title("QLoRA training on CORD-v2")
    ax1.grid(alpha=0.25)
    lr_ax = ax1.twinx()
    lr_ax.plot(steps, [e["lr"] for e in log], color="#9ca3af", linewidth=1, linestyle="--", label="learning rate")
    lr_ax.set_ylabel("learning rate", color="#6b7280")
    ax1.legend(loc="upper right", frameon=False)

    if val:
        x = [v["epoch"] for v in val]
        ax2.plot(x, [v["field_f1"] for v in val], marker="o", color="#059669", linewidth=1.8, label="field F1")
        ax2.plot(x, [v["total_accuracy"] or 0 for v in val], marker="s", color="#d97706", linewidth=1.8, label="total accuracy")
        for xi, f1 in zip(x, [v["field_f1"] for v in val]):
            ax2.annotate(f"{f1:.2f}", (xi, f1), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=9)
        ax2.set_xlabel("epoch (0 = before fine-tuning)")
        ax2.set_ylim(0, 1.05)
        ax2.set_title(f"Validation ({val[0]['n']} receipts, greedy)")
        ax2.grid(alpha=0.25)
        ax2.legend(loc="lower right", frameon=False)
    else:
        ax2.set_axis_off()

    out = run_dir / "training_curve.png"
    fig.savefig(out, dpi=150)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "runs/qlora-cord")
