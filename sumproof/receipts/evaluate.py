"""Produce the results table for the README and resume.

Run on the 100-receipt CORD-v2 test split:
  python -m sumproof.receipts.evaluate --tag zeroshot
  python -m sumproof.receipts.evaluate --tag qlora      --adapter runs/qlora-cord/adapter
  python -m sumproof.receipts.evaluate --tag qlora_cgr  --adapter runs/qlora-cord/adapter --samples 4

Every run also measures how well "breaks an accounting rule" predicts "the
extraction has an error" (the human-review flag), and seconds per receipt.
All predictions are saved so you can show failure cases in interviews.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from . import vlm
from .consistency import check
from .data import load_split
from .metrics import Scores, exact_match


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--samples", type=int, default=0, help="extra sampled candidates for CGR (0 = greedy)")
    ap.add_argument("--split", default="test")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", default="results")
    args = ap.parse_args()

    model, processor = vlm.load(args.adapter)
    scores, greedy_scores = Scores(), Scores()
    flag = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    rows, t0 = [], time.time()
    data = list(load_split(args.split, args.limit))

    for n, (image, gold) in enumerate(data, 1):
        pred, candidates = vlm.extract(model, processor, image, n_samples=args.samples)
        scores.add(pred, gold)
        greedy_scores.add(candidates[0][0], gold)

        flagged = pred is None or not check(pred).consistent
        wrong = not exact_match(pred, gold)
        flag[("tp" if wrong else "fp") if flagged else ("fn" if wrong else "tn")] += 1

        rows.append({
            "index": n - 1,
            "pred": pred.model_dump(exclude_none=True) if pred else None,
            "gold": gold.model_dump(exclude_none=True),
            "flagged": flagged,
            "exact": not wrong,
            "candidates": [
                {"logprob": round(lp, 4), "valid": r is not None, "consistency": check(r).score if r else None, "raw": t}
                for r, lp, t in candidates
            ],
        })
        if n % 10 == 0:
            print(f"{n}/{len(data)}  {scores.as_dict()}", flush=True)

    secs = (time.time() - t0) / len(data)
    precision = flag["tp"] / (flag["tp"] + flag["fp"]) if flag["tp"] + flag["fp"] else 0.0
    recall = flag["tp"] / (flag["tp"] + flag["fn"]) if flag["tp"] + flag["fn"] else 0.0
    result = {
        "tag": args.tag,
        "adapter": args.adapter,
        "samples": args.samples,
        "split": args.split,
        "metrics": scores.as_dict(),
        "greedy_metrics": greedy_scores.as_dict(),
        "review_flag": {**flag, "precision": round(precision, 4), "recall": round(recall, 4),
                        "flag_rate": round((flag["tp"] + flag["fp"]) / len(data), 4)},
        "seconds_per_receipt": round(secs, 2),
    }
    out = Path(args.out)
    out.mkdir(exist_ok=True)
    (out / f"{args.tag}.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    (out / f"{args.tag}_predictions.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
