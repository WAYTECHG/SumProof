"""RAG answer generation on FinanceBench: from "find the page" to "answer with a citation".

Retrieval is already done (results/financebench_rankings.json, the reranked pages per question).
This module asks Qwen3.5-4B to answer each of the 150 analyst questions in four settings, then a
model from a different family (IBM Granite 4.2 8B) grades every answer against the analysts'
reference answer. Using a different family avoids a model grading its own writing.

Settings (each question is answered once per setting):
  closed     no pages: what the model "knows" (and how often it makes numbers up)
  top5       the 5 best reranked pages: standard RAG
  adaptive   confidence-gated context: softmax the reranker scores of the top 5 pages and keep
             the best pages until they hold 90% of the probability (1 to 5 pages). The 90% is
             fixed in advance, like nucleus sampling, not tuned on these questions.
  oracle     the analysts' own evidence pages: the ceiling if retrieval were perfect

  python -m sumproof.rag.answer generate [--limit N] [--modes closed,top5,adaptive,oracle]
  python -m sumproof.rag.answer judge    [--limit N]
  python -m sumproof.rag.answer report

Both steps append to JSONL files and skip work already done, so a stopped run resumes.
Generation and judging run in separate processes so each model has the 8 GB GPU to itself.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import time
from pathlib import Path

RANKINGS = Path("results/financebench_rankings.json")
ANSWERS = Path("results/rag_answers.jsonl")
JUDGEMENTS = Path("results/rag_judgements.jsonl")
SUMMARY = Path("results/rag_answer_eval.json")
JUDGE_MODEL = "ibm-granite/granite-4.2-8b"
MODES = ("closed", "top5", "adaptive", "oracle")
TOP_K = 5
MASS = 0.9
PAGE_CHARS = 6000  # a long 10-K page is ~10k characters; the cap keeps 5 pages under ~8k tokens
NOT_FOUND = "Not found in the provided pages."
DONT_KNOW = "I don't know."

RAG_SYSTEM = (
    "You answer questions about companies' SEC filings for a financial analyst, using only the numbered "
    "filing pages you are given. Give the answer first, in one to three sentences, with numbers and units. "
    "If a calculation is needed, show it in one short line. End with a line 'Source: [n]' naming the page "
    f"you used. If the pages do not contain the answer, reply exactly: {NOT_FOUND}"
)
CLOSED_SYSTEM = (
    "You answer questions about companies' SEC filings for a financial analyst. Give the answer first, in one "
    "to three sentences, with numbers and units. If a calculation is needed, show it in one short line. "
    f"If you do not know, reply exactly: {DONT_KNOW}"
)
JUDGE_PROMPT = """You are grading an answer to a question about a company's financial filing, by comparing it with the reference answer written by a financial analyst.

Question: {question}

Reference answer: {reference}

Candidate answer: {candidate}

Grading rules:
- A number is correct if it is within 1% of the reference, or equal to it when rounded to the reference's precision (for example 8.738 matches a reference of 8.70, and 0.664 matches 0.66). The same amount in other units (for example $1.58 billion vs $1,577 million) is correct.
- The candidate may add detail, but it must not contradict the reference.
- For questions that ask for an explanation or a judgement, the candidate is correct if it reaches the same conclusion as the reference and its key figures agree; it does not need to list every reason the reference gives.

Explain in at most two sentences, then end with one word on its own line: CORRECT or INCORRECT."""


# ---------- choosing the pages ----------

def adaptive_k(scores: list[float], mass: float = MASS, k_max: int = TOP_K) -> int:
    """Smallest k whose softmax over the top-k_max reranker scores reaches `mass` (at least 1)."""
    s = scores[:k_max]
    if not s:
        return 0
    m = max(s)
    w = [math.exp(v - m) for v in s]
    total, acc = sum(w), 0.0
    for k, v in enumerate(w, 1):
        acc += v / total
        if acc >= mass - 1e-9:
            return k
    return len(s)


def select_pages(mode: str, rank: dict) -> list[int]:
    """Page rows (into pages.parquet) given to the model in each setting."""
    if mode == "closed":
        return []
    if mode == "top5":
        return rank["reranked"][:TOP_K]
    if mode == "adaptive":
        return rank["reranked"][: adaptive_k(rank["reranker_scores"])]
    if mode == "oracle":
        return list(dict.fromkeys(rank["gold_rows"]))[:TOP_K]
    raise ValueError(mode)


def page_label(doc: str, page: int) -> str:
    """'3M_2018_10K', 59 -> '3M 2018 10K, page 60' (pages are stored 0-based)."""
    return f"{doc.replace('_', ' ')}, page {page + 1}"


def build_messages(question: str, pages: list[tuple[str, int, str]]) -> list[dict]:
    """Chat messages for one question. `pages` holds (doc_name, page, text) in rank order."""
    if not pages:
        return [{"role": "system", "content": CLOSED_SYSTEM}, {"role": "user", "content": f"Question: {question}"}]
    blocks = [f"[{n}] {page_label(doc, page)}\n{text[:PAGE_CHARS].strip()}" for n, (doc, page, text) in enumerate(pages, 1)]
    user = "Filing pages:\n\n" + "\n\n".join(blocks) + f"\n\nQuestion: {question}"
    return [{"role": "system", "content": RAG_SYSTEM}, {"role": "user", "content": user}]


# ---------- reading the answers ----------

def is_refusal(text: str) -> bool:
    t = text.strip().lower()
    return t.startswith(NOT_FOUND.lower().rstrip(".")) or t.startswith(DONT_KNOW.lower().rstrip("."))


def parse_citations(text: str) -> list[int]:
    """1-based page numbers cited as [n] (in the Source line, or anywhere if there is none)."""
    m = re.search(r"source[s]?\s*:(.*)$", text, flags=re.I | re.S)
    if m:  # the Source line may drop the brackets: "Source: 1" or "Source: [1], [3]"
        return sorted({int(n) for n in re.findall(r"(?<![\d.,])(\d{1,2})(?![\d.,%])", m.group(1))})
    return sorted({int(n) for n in re.findall(r"\[(\d{1,2})\]", text)})


_NUM = re.compile(r"\(?-?\$?\s?\d[\d,]*\.?\d*\)?\s*(%|percent|billion|million|thousand|bn|mn|m\b|b\b)?", re.I)
_SCALE = {"billion": 1e3, "bn": 1e3, "b": 1e3, "million": 1.0, "mn": 1.0, "m": 1.0, "thousand": 1e-3}


def numbers(text: str) -> list[float]:
    """Numbers in a text, scaled to millions when a unit word follows (percent values kept as is)."""
    out = []
    for m in _NUM.finditer(text):
        raw = m.group(0)
        digits = re.sub(r"[^\d.\-]", "", raw.split("%")[0])
        if not digits or digits in {".", "-"}:
            continue
        try:
            v = float(digits)
        except ValueError:
            continue
        if raw.strip().startswith("(") and raw.strip().endswith(")"):
            v = -abs(v)
        unit = (m.group(1) or "").lower()
        out.append(v * _SCALE.get(unit, 1.0))
    return out


def stated_numbers(answer: str) -> list[float]:
    """Numbers in the answer's first sentence that has one: the figure the answer actually states.

    The prompt asks for the answer first. Checking every number in the text would accept an answer
    whose working happens to contain the right figure while its stated result is wrong.
    """
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", answer.strip()):
        nums = [v for v in numbers(re.sub(r"\b(?:FY|fiscal\s+)?(?:19|20)\d{2}\b", " ", sentence)) if v]
        if nums:
            return nums
    return []


def numeric_match(candidate: str, reference: str, tol: float = 0.01) -> bool | None:
    """Rule-based check for one-number answers: None when the reference has no number."""
    ref = numbers(reference)
    if not ref:
        return None
    target = ref[0]
    for v in stated_numbers(candidate):
        for scaled in (v, v * 1e3, v / 1e3):  # units the text did not name (e.g. "$1.6" meaning billions)
            if abs(scaled - target) <= max(tol * abs(target), 0.006):
                return True
    return False


def reference_number(q_type: str, reference: str) -> float | None:
    """The single figure a metric question asks for, when its reference answer starts with it."""
    if q_type != "metrics-generated" or not re.match(r"\s*\(?-?\$?\s?\d", reference):
        return None
    nums = numbers(reference)
    return nums[0] if nums else None


def verdict_from(reply: str) -> str:
    """CORRECT / INCORRECT from the judge's reply: the last verdict word after its reasoning."""
    final = reply.split("</think>")[-1]
    found = re.findall(r"\b(INCORRECT|CORRECT)\b", final.upper())
    return found[-1] if found else "UNCLEAR"


# ---------- data ----------

def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _append(path: Path, rec: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _load_data():
    from .financebench import load

    q, pages = load()
    rankings = json.loads(RANKINGS.read_text(encoding="utf-8"))
    return q, pages, rankings


# ---------- step 1: answers (Qwen3.5-4B) ----------

def generate(modes: list[str], limit: int | None) -> None:
    import torch

    from ..receipts import vlm

    q, pages, rankings = _load_data()
    done = {(r["i"], r["mode"]) for r in _load_jsonl(ANSWERS)}
    todo = [(i, m) for m in modes for i in range(len(q))[:limit] if (i, m) not in done]
    print(f"{len(todo)} answers to write ({len(done)} already done)")
    if not todo:
        return
    model, processor = vlm.load(None)  # base Qwen3.5-4B: the receipt adapter is not used here

    for n, (i, mode) in enumerate(todo, 1):
        rows = select_pages(mode, rankings[i])
        ctx = [(pages.doc_name.iloc[r], int(pages.page.iloc[r]), pages.text.iloc[r]) for r in rows]
        msgs = build_messages(q.question.iloc[i], ctx)
        chat = processor.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        inputs = processor(text=[chat], return_tensors="pt").to(model.device)
        t0 = time.perf_counter()
        with torch.inference_mode():
            out = model.generate(**inputs, max_new_tokens=384, do_sample=False)
        gen = out[0, inputs["input_ids"].shape[1]:]
        text = processor.decode(gen, skip_special_tokens=True).strip()
        rec = {
            "i": i,
            "mode": mode,
            "rows": rows,
            "answer": text,
            "prompt_tokens": int(inputs["input_ids"].shape[1]),
            "answer_tokens": int(gen.shape[0]),
            "seconds": round(time.perf_counter() - t0, 2),
        }
        _append(ANSWERS, rec)
        print(f"{n}/{len(todo)} q{i} {mode}: {rec['prompt_tokens']} tok in, {rec['seconds']}s | {text[:90]!r}", flush=True)


# ---------- step 2: grading (IBM Granite 4.2 8B) ----------

def judge(limit: int | None) -> None:
    """Grade every non-refusal answer.

    Metric questions whose reference is one figure are decided by numeric_match (objective). Every
    answer is also graded by Granite, which reasons first and then gives a verdict; on the metric
    questions that verdict is only stored, to measure how often the model judge agrees with the rule.
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    q, _, _ = _load_data()
    answers = [a for a in _load_jsonl(ANSWERS) if limit is None or a["i"] < limit]
    done = {(j["i"], j["mode"]) for j in _load_jsonl(JUDGEMENTS)}
    todo = [a for a in answers if (a["i"], a["mode"]) not in done and not is_refusal(a["answer"])]
    print(f"{len(todo)} answers to grade (refusals are not graded)")
    if not todo:
        return
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    tok = AutoTokenizer.from_pretrained(JUDGE_MODEL)
    model = AutoModelForCausalLM.from_pretrained(JUDGE_MODEL, quantization_config=bnb, dtype=torch.bfloat16, device_map="cuda:0")
    model.eval()

    for n, a in enumerate(todo, 1):
        row = q.iloc[a["i"]]
        prompt = JUDGE_PROMPT.format(question=row.question, reference=row.answer, candidate=a["answer"])
        enc = tok.apply_chat_template(
            [{"role": "user", "content": prompt}], add_generation_prompt=True, return_tensors="pt", return_dict=True,
            enable_thinking=False,  # full reasoning took 23-63 s per grade; a short rationale before the verdict is enough
        ).to(model.device)
        t0 = time.perf_counter()
        with torch.inference_mode():
            out = model.generate(**enc, max_new_tokens=320, do_sample=False)
        reply = tok.decode(out[0, enc["input_ids"].shape[1]:], skip_special_tokens=False)
        model_verdict = verdict_from(reply)
        ref = reference_number(row.question_type, str(row.answer))
        if ref is not None:
            verdict, method = ("CORRECT" if numeric_match(a["answer"], str(row.answer)) else "INCORRECT"), "rule"
        else:
            verdict, method = model_verdict, "judge"
        _append(JUDGEMENTS, {
            "i": a["i"], "mode": a["mode"], "verdict": verdict, "method": method, "judge_verdict": model_verdict,
            "seconds": round(time.perf_counter() - t0, 1), "raw": reply.split("</think>")[-1].strip()[:300],
        })
        print(f"{n}/{len(todo)} q{a['i']} {a['mode']}: {verdict} ({method}; judge said {model_verdict})", flush=True)


# ---------- step 3: report ----------

def regrade(refs: list[str], answers: list[dict], judgements: list[dict]) -> list[dict]:
    """Recompute rule verdicts from the saved answer text, so a change to the rule needs no GPU rerun."""
    text = {(a["i"], a["mode"]): a["answer"] for a in answers}
    return [
        {**j, "verdict": "CORRECT" if numeric_match(text[(j["i"], j["mode"])], refs[j["i"]]) else "INCORRECT"}
        if j.get("method") == "rule" and (j["i"], j["mode"]) in text
        else j
        for j in judgements
    ]


def outcomes(refs: list[str], answers: list[dict], judgements: list[dict]) -> dict[tuple[int, str], str]:
    """'correct' | 'wrong' | 'refused' | 'ungraded' for every (question, setting): shared by report and web export."""
    verdict = {(j["i"], j["mode"]): j["verdict"] for j in regrade(refs, answers, judgements)}
    out = {}
    for a in answers:
        key = (a["i"], a["mode"])
        out[key] = "refused" if is_refusal(a["answer"]) else {"CORRECT": "correct", "INCORRECT": "wrong"}.get(verdict.get(key), "ungraded")
    return out


def summarize(q_types: list[str], refs: list[str], answers: list[dict], judgements: list[dict], rankings: list[dict]) -> dict:
    judgements = regrade(refs, answers, judgements)
    result = outcomes(refs, answers, judgements)
    out: dict = {"judge": JUDGE_MODEL, "generator": "Qwen/Qwen3.5-4B (4-bit, no thinking)", "modes": {}}
    for mode in MODES:
        recs = [a for a in answers if a["mode"] == mode]
        if not recs:
            continue
        n = len(recs)
        status = [result[(a["i"], mode)] for a in recs]
        gold = [set(rankings[a["i"]]["gold_rows"]) for a in recs]
        has_gold = [bool(g & set(a["rows"])) for a, g in zip(recs, gold)]
        cites = []
        for a, g, s in zip(recs, gold, status):
            c = [a["rows"][k - 1] for k in parse_citations(a["answer"]) if 1 <= k <= len(a["rows"])]
            if s == "correct" and c:
                cites.append(bool(set(c) & g))
        by_type = {}
        for t in sorted(set(q_types)):
            idx = [k for k, a in enumerate(recs) if q_types[a["i"]] == t]
            if idx:
                by_type[t] = round(sum(status[k] == "correct" for k in idx) / len(idx), 3)
        out["modes"][mode] = {
            "n": n,
            "correct": round(status.count("correct") / n, 3),
            "wrong": round(status.count("wrong") / n, 3),
            "refused": round(status.count("refused") / n, 3),
            "ungraded": status.count("ungraded"),
            "pages_mean": round(sum(len(a["rows"]) for a in recs) / n, 2),
            "prompt_tokens_mean": round(sum(a["prompt_tokens"] for a in recs) / n),
            "answer_tokens_mean": round(sum(a["answer_tokens"] for a in recs) / n),
            "seconds_mean": round(sum(a["seconds"] for a in recs) / n, 2),
            "context_has_evidence_page": round(sum(has_gold) / n, 3) if mode != "closed" else None,
            "correct_answers_citing_evidence_page": round(sum(cites) / len(cites), 3) if cites else None,
            "correct_by_question_type": by_type,
        }

    # How far to trust the model judge: on answers the numeric rule decided, how often did it agree?
    ruled = [j for j in judgements if j.get("method") == "rule" and j.get("judge_verdict") in ("CORRECT", "INCORRECT")]
    agree = sum(j["judge_verdict"] == j["verdict"] for j in ruled)
    out["judge_vs_numeric_rule"] = {"answers": len(ruled), "agreement": round(agree / len(ruled), 3) if ruled else None}
    out["graded_by"] = {m: sum(j.get("method") == m for j in judgements) for m in ("rule", "judge")}
    return out


def report() -> None:
    q, _, rankings = _load_data()
    res = summarize(list(q.question_type), [str(a) for a in q.answer], _load_jsonl(ANSWERS), _load_jsonl(JUDGEMENTS), rankings)
    SUMMARY.write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(f"{'setting':<10} {'correct':>8} {'wrong':>7} {'refused':>8} {'pages':>6} {'tokens in':>10} {'s/q':>6}")
    for mode, m in res["modes"].items():
        print(f"{mode:<10} {m['correct']:>8.1%} {m['wrong']:>7.1%} {m['refused']:>8.1%} {m['pages_mean']:>6} {m['prompt_tokens_mean']:>10} {m['seconds_mean']:>6}")
    print("judge vs numeric rule:", res["judge_vs_numeric_rule"])
    print(f"saved {SUMMARY}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["generate", "judge", "report"])
    ap.add_argument("--limit", type=int, default=None, help="only the first N questions (smoke test)")
    ap.add_argument("--modes", default=",".join(MODES))
    a = ap.parse_args()
    if a.step == "generate":
        generate([m for m in a.modes.split(",") if m], a.limit)
    elif a.step == "judge":
        judge(a.limit)
    else:
        report()


if __name__ == "__main__":
    main()
