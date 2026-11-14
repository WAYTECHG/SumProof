"""QLoRA supervised fine-tuning (SFT) of Qwen3.5-4B on CORD-v2 train (800 receipts), 8 GB GPU.

Run (WSL2/Linux):  python -m sumproof.receipts.train_qlora --epochs 1 --out runs/sft
Watch:             tensorboard --logdir runs

This is fine-tuning, not training from scratch: the 4.5B pretrained weights stay
frozen and LoRA adds ~1% trainable parameters.

LoRA targets every language-model projection: the 8 standard attention layers
(q/k/v/o_proj), the 24 Gated DeltaNet layers (in_proj_qkv, in_proj_z, out_proj)
and all 32 MLPs. The vision encoder stays frozen; the regex is anchored on
"language_model" because vision blocks reuse some of the same names.
Loss is computed on the answer tokens only, and logits are produced only for
those positions (logits_to_keep): the 248k-token vocabulary would otherwise need
~1 GB just for the image positions' logits.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

from . import vlm
from .data import LazySplit, load_split
from .metrics import Scores
from .schema import parse_model_output

# Qwen3.5 language-model projections: 8x4 attention + 24x3 Gated DeltaNet + 32x3 MLP = 200 modules.
LM_TARGETS = (
    r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|in_proj_qkv|in_proj_z|out_proj|gate_proj|up_proj|down_proj)"
)


def encode(processor, image, answer: str) -> tuple[dict, torch.Tensor]:
    """Prompt (exactly as at inference) + answer + end token. Returns model inputs and answer ids."""
    prompt = vlm.prompt_text(processor)
    enc = processor(text=[prompt + answer + vlm.answer_suffix(processor)], images=[image], return_tensors="pt")
    prompt_len = processor(text=[prompt], images=[image], return_tensors="pt")["input_ids"].shape[1]
    answer_ids = enc["input_ids"][0, prompt_len:]
    return enc, answer_ids


def answer_loss(model, enc: dict, answer_ids: torch.Tensor) -> torch.Tensor:
    """Cross-entropy on the answer tokens, computing logits only for those positions."""
    n = answer_ids.shape[0]
    out = model(**enc, logits_to_keep=n + 1)
    logits = out.logits[0, :-1].float()  # position t predicts token t+1
    return torch.nn.functional.cross_entropy(logits, answer_ids.to(logits.device))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--limit", type=int, default=None, help="debug: use only N training receipts")
    ap.add_argument("--val-limit", type=int, default=30, help="validation receipts per check (each takes ~15 s)")
    ap.add_argument("--out", default="runs/qlora-cord")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    model, processor = vlm.load()
    model.train()
    model = prepare_model_for_kbit_training(
        model, use_gradient_checkpointing=True, gradient_checkpointing_kwargs={"use_reentrant": False}
    )
    model = get_peft_model(
        model,
        LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, target_modules=LM_TARGETS, task_type="CAUSAL_LM"),
    )
    model.print_trainable_parameters()

    train = LazySplit("train", args.limit)  # decodes one photo at a time (RAM)
    val = list(load_split("validation", args.val_limit))
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    total_steps = math.ceil(len(train) * args.epochs / args.grad_accum)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / max(1, total_steps // 20)) * max(0.0, 1 - s / total_steps)
    )

    # Live dashboard: tensorboard --logdir runs   (then open http://localhost:6006)
    from torch.utils.tensorboard import SummaryWriter

    tb = SummaryWriter(log_dir=str(out / "tb"))
    tb.add_text("config", json.dumps(vars(args)))

    def validate(tag_step: int, epoch: float) -> dict:
        """Greedy extraction on the validation receipts; logged as one point on the val curves."""
        model.eval()
        s = Scores()
        for image, gold in val:
            text, _ = vlm.generate(model, processor, image)[0]
            s.add(parse_model_output(text), gold)
        model.train()
        d = {**s.as_dict(), "epoch": epoch, "step": tag_step}
        for key in ("field_f1", "total_accuracy", "valid_json_rate"):
            tb.add_scalar(f"val/{key}", d[key] or 0.0, tag_step)
        print("val:", d, flush=True)
        return d

    log, val_log, step, micro, t0 = [], [], 0, 0, time.time()
    n_micro = int(len(train) * args.epochs)
    order = []
    while len(order) < n_micro:
        idx = list(range(len(train)))
        random.shuffle(idx)
        order.extend(idx)
    order = order[:n_micro]

    val_log.append(validate(0, 0.0))  # starting point = zero-shot model
    running, t_step = 0.0, time.time()
    for k, i in enumerate(order, 1):
        image, gold = train[i]
        enc, answer_ids = encode(processor, image, gold.to_target())
        loss = answer_loss(model, enc.to(model.device), answer_ids) / args.grad_accum
        loss.backward()
        running += loss.item()
        micro += 1
        if micro % args.grad_accum == 0 or k == len(order):
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            sec_per = (time.time() - t_step) / args.grad_accum
            entry = {"step": step, "epoch": round(k / len(train), 3), "loss": round(running, 4),
                     "lr": sched.get_last_lr()[0], "sec_per_receipt": round(sec_per, 2),
                     "gpu_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2),
                     "min": round((time.time() - t0) / 60, 1)}
            log.append(entry)
            for key in ("loss", "lr", "sec_per_receipt", "gpu_peak_gb"):
                tb.add_scalar(f"train/{key}", entry[key], step)
            print(entry, flush=True)
            (out / "train_log.json").write_text(json.dumps(log, indent=1), encoding="utf-8")
            running, t_step = 0.0, time.time()

        if k % len(train) == 0 or k == len(order):  # end of each epoch
            epoch = round(k / len(train), 2)
            model.save_pretrained(out / f"adapter-epoch{epoch}")  # checkpoint survives a crash
            val_log.append(validate(step, epoch))
            (out / "val_log.json").write_text(json.dumps(val_log, indent=1), encoding="utf-8")

    model.save_pretrained(out / "adapter")
    tb.close()


if __name__ == "__main__":
    main()
