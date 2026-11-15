"""Export the real evaluation results for the web interface (web/public/data).

  python -m sumproof.export_web          # run in the WSL environment (needs `datasets` for the photos)

Writes:
  receipts.json        100 CORD test receipts: fine-tuned + best-of-4 reading, zero-shot reading,
                       human label, the 5 candidates' rule scores, and the checker's verdict
  receipts/<i>.webp    the receipt photos (CORD-v2, CC-BY-4.0), resized for the web
  dashboard.json       every number in the README (receipts, retrieval ladder, FAISS, pgvector,
                       training and validation curves)
  questions.json       index of the 150 FinanceBench questions
  q/<i>.json           per question: routed filings, top-10 of every retrieval method, the analysts'
                       evidence pages and reference answer, the text of every page shown, and the
                       generated answer in each context setting with its grade

  python -m sumproof.export_web dashboard questions   # only these parts (no `datasets` needed)
Nothing is recomputed: these are the outputs the README numbers were measured on.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from .rag.answer import ANSWERS, JUDGEMENTS, SUMMARY, outcomes, parse_citations
from .rag.financebench import parse_doc_name
from .receipts.consistency import check
from .receipts.schema import Receipt, parse_model_output

OUT = Path("web/public/data")
RESULTS = Path("results")
FB = Path("data/financebench")
IMG_WIDTH = 640
PAGE_CHARS = 6000
METHODS = ["bm25", "dense", "hybrid", "routed", "reranked"]


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _checks(data: dict | None) -> list[dict]:
    if data is None:
        return []
    return [{"name": c.name, "passed": c.passed, "expected": c.expected, "found": c.found}
            for c in check(Receipt.model_validate(data)).checks]


def export_receipts() -> None:
    final = _rows(RESULTS / "sft_best4_predictions.jsonl")
    zeroshot = _rows(RESULTS / "zeroshot_predictions.jsonl")
    out = []
    for f, z in zip(final, zeroshot):
        chosen = None
        if f["pred"] is not None:
            # The checker's choice is a candidate whose parsed reading equals the final prediction;
            # among identical readings the reranker breaks ties by log-probability.
            same = [k for k, c in enumerate(f["candidates"])
                    if (r := parse_model_output(c["raw"])) is not None and r.model_dump(exclude_none=True) == f["pred"]]
            if same:
                chosen = max(same, key=lambda k: f["candidates"][k]["logprob"])
        out.append({
            "id": f["index"],
            "image": f"receipts/{f['index']}.webp",
            "pred": f["pred"],
            "gold": f["gold"],
            "zeroshot": z["pred"],
            "flagged": f["flagged"],
            "exact": f["exact"],
            "checks": _checks(f["pred"]),
            "candidates": [{"kind": "greedy" if k == 0 else "sampled", "valid": c["valid"],
                            "consistency": c["consistency"], "logprob": c["logprob"], "chosen": k == chosen}
                           for k, c in enumerate(f["candidates"])],
        })
    (OUT / "receipts.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"receipts.json: {len(out)} receipts, {sum(r['flagged'] for r in out)} flagged for review")


def export_receipt_images() -> None:
    from datasets import load_dataset

    folder = OUT / "receipts"
    folder.mkdir(parents=True, exist_ok=True)
    ds = load_dataset("naver-clova-ix/cord-v2", split="test")
    total = 0
    for i, row in enumerate(ds):
        img = row["image"].convert("RGB")
        if img.width > IMG_WIDTH:
            img = img.resize((IMG_WIDTH, round(img.height * IMG_WIDTH / img.width)))
        path = folder / f"{i}.webp"
        img.save(path, "WEBP", quality=78, method=6)
        total += path.stat().st_size
    print(f"receipts/*.webp: {len(ds)} photos, {total / 1e6:.1f} MB")


def export_dashboard() -> None:
    load = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))
    dash = {
        "receipts": load(RESULTS / "receipts_summary.json"),
        "retrieval": load(RESULTS / "financebench_retrieval.json"),
        "faiss": load(RESULTS / "faiss_benchmark.json"),
        "pgvector": load(RESULTS / "pgvector_benchmark.json"),
        "train_log": load("runs/sft/train_log.json"),
        "val_log": load("runs/sft/val_log.json"),
    }
    if SUMMARY.exists():
        dash["answers"] = load(SUMMARY)
    (OUT / "dashboard.json").write_text(json.dumps(dash), encoding="utf-8")
    print("dashboard.json written")


def export_questions() -> None:
    q = pd.read_parquet(FB / "questions.parquet")
    pages = pd.read_parquet(FB / "pages.parquet")
    rankings = json.loads((RESULTS / "financebench_rankings.json").read_text(encoding="utf-8"))
    (OUT / "q").mkdir(parents=True, exist_ok=True)
    answers = _rows(ANSWERS) if ANSWERS.exists() else []
    result = outcomes([str(a) for a in q.answer], answers, _rows(JUDGEMENTS) if JUDGEMENTS.exists() else [], list(q.question_type))
    generated: dict[int, dict] = {}
    for a in answers:
        cited = [a["rows"][k - 1] for k in parse_citations(a["answer"]) if 1 <= k <= len(a["rows"])]
        generated.setdefault(a["i"], {})[a["mode"]] = {
            "text": a["answer"], "rows": a["rows"], "cited": cited, "outcome": result[(a["i"], a["mode"])],
            "prompt_tokens": a["prompt_tokens"],
        }

    index = []
    for r in rankings:
        row = q.iloc[r["i"]]
        gold = set(r["gold_rows"])
        shown = set(gold)
        methods = {}
        for m in METHODS:
            ids = r[m][:10]
            shown.update(ids[:5])
            methods[m] = [{"row": int(j), "gold": j in gold} for j in ids]
        if "reranker_scores" in r:
            for hit, s in zip(methods["reranked"], r["reranker_scores"]):
                hit["score"] = s
        filings = r["routed_filings"]
        detected = None
        if filings:
            company = parse_doc_name(filings[0])[0]
            years = sorted({y for y in (parse_doc_name(f)[1] for f in filings) if y})
            detected = {"company": row.company if parse_doc_name(row.doc_name)[0] == company else company,
                        "years": years, "filings": filings}
        detail = {
            "i": r["i"], "question": row.question, "company": row.company, "type": row.question_type,
            "answer": row.answer, "justification": row.justification, "doc_link": row.doc_link,
            "gold": [{"row": int(j), "doc": pages.doc_name.iloc[j], "page": int(pages.page.iloc[j])} for j in sorted(gold)],
            "detected": detected,
            "methods": methods,
            "generated": generated.get(r["i"], {}),
            "pages": {str(j): {"doc": pages.doc_name.iloc[j], "page": int(pages.page.iloc[j]),
                               "text": pages.text.iloc[j][:PAGE_CHARS]} for j in sorted(shown)},
        }
        (OUT / "q" / f"{r['i']}.json").write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
        first_hit = lambda m: next((k + 1 for k, h in enumerate(methods[m]) if h["gold"]), None)
        index.append({"i": r["i"], "question": row.question, "company": row.company, "type": row.question_type,
                      "rank": {m: first_hit(m) for m in METHODS},
                      "outcome": {m: g["outcome"] for m, g in generated.get(r["i"], {}).items()}})
    (OUT / "questions.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    size = sum(p.stat().st_size for p in (OUT / "q").glob("*.json"))
    print(f"questions.json + q/*.json: {len(index)} questions, {size / 1e6:.1f} MB")


def main() -> None:
    import sys

    parts = {"receipts": export_receipts, "dashboard": export_dashboard, "questions": export_questions,
             "images": export_receipt_images}
    OUT.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:] or list(parts):
        parts[name]()


if __name__ == "__main__":
    main()
