"""How much does thinking help, and how much thinking is worth paying for? (budget forcing)

On the 50 FinanceBench metric questions (calculations from SEC filings), Qwen3.5-4B in Ollama answers
from the same top-5 reranked pages with a thinking budget of 0, 1024, 2048 or 4096 tokens.

Budget forcing (Muennighoff et al., 2025, "s1: Simple test-time scaling"): the model thinks until it
closes its reasoning or reaches the budget; then the reasoning is closed for it and it must answer.
Without a budget, a 4B model can reason for over 6,000 tokens on one ratio and never answer.

The reasoning is generated once (up to the largest budget) and cut at each smaller budget, so every
budget sees the same thinking prefix and only the answer step is repeated. Greedy decoding throughout.
The no-thinking run uses the same engine and quantisation, so the comparison isolates thinking.

  ollama pull qwen3.5:4b
  python -m sumproof.rag.think_budget [--limit N]      # answers -> results/rag_answers.jsonl
  python -m sumproof.rag.answer judge && python -m sumproof.rag.answer report
"""

from __future__ import annotations

import argparse
import json
import time

from .answer import ANSWERS, _append, _load_data, _load_jsonl, build_messages, select_pages

MODEL = "qwen3.5:4b"
HF_TOKENIZER = "Qwen/Qwen3.5-4B"  # same tokenizer as the Ollama build; used to render the prompt and count tokens
BUDGETS = (1024, 2048, 4096)
OPTIONS = {"temperature": 0, "num_ctx": 16384}
CLOSE = "\n</think>\n\n"


def mode_name(budget: int) -> str:
    return f"think_{budget}"


def cut(tok, thinking: str, budget: int) -> tuple[str, int, bool]:
    """The first `budget` tokens of the reasoning: (text, tokens used, was it cut)."""
    ids = tok.encode(thinking, add_special_tokens=False)
    if len(ids) <= budget:
        return thinking, len(ids), False
    return tok.decode(ids[:budget]), budget, True


def main() -> None:
    from ollama import Client
    from transformers import AutoTokenizer

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="first N metric questions (smoke test)")
    a = ap.parse_args()

    q, pages, rankings = _load_data()
    tok = AutoTokenizer.from_pretrained(HF_TOKENIZER)
    llm = Client()
    modes = [mode_name(0)] + [mode_name(b) for b in BUDGETS]
    done = {(r["i"], r["mode"]) for r in _load_jsonl(ANSWERS)}
    questions = [i for i in range(len(q)) if q.question_type.iloc[i] == "metrics-generated"][: a.limit]
    print(f"{len(questions)} metric questions x {len(modes)} budgets", flush=True)

    def gen(prompt: str, n: int, stop: list[str]):
        r = llm.generate(model=MODEL, prompt=prompt, raw=True, options={**OPTIONS, "num_predict": n, "stop": stop})
        return (r.thinking or "") + (r.response or ""), r

    for k, i in enumerate(questions, 1):
        if all((i, m) in done for m in modes):
            continue
        rows = select_pages("top5", rankings[i])
        ctx = [(pages.doc_name.iloc[r], int(pages.page.iloc[r]), pages.text.iloc[r]) for r in rows]
        msgs = build_messages(q.question.iloc[i], ctx)
        base = {"i": i, "rows": rows}

        # Budget 0: thinking switched off in the chat template.
        if (i, mode_name(0)) not in done:
            prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            t0 = time.perf_counter()
            text, r = gen(prompt, 400, ["<|im_end|>"])
            _append(ANSWERS, {**base, "mode": mode_name(0), "answer": text.strip(), "prompt_tokens": r.prompt_eval_count,
                              "answer_tokens": r.eval_count, "thinking_tokens": 0, "seconds": round(time.perf_counter() - t0, 2)})

        # Think once up to the largest budget, then answer from each prefix.
        prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=True)
        t0 = time.perf_counter()
        thinking, r = gen(prompt, max(BUDGETS), ["</think>"])
        think_secs = time.perf_counter() - t0
        thinking = thinking.split("</think>")[0]
        for b in BUDGETS:
            if (i, mode_name(b)) in done:
                continue
            prefix, used, was_cut = cut(tok, thinking, b)
            # At the largest budget the reasoning text can re-tokenise to just under the limit; Ollama's
            # stop reason is the reliable signal that the model was still thinking.
            was_cut = was_cut or (b == max(BUDGETS) and r.done_reason == "length")
            t1 = time.perf_counter()
            text, ra = gen(prompt + prefix + CLOSE, 400, ["<|im_end|>"])
            _append(ANSWERS, {**base, "mode": mode_name(b), "answer": text.strip(), "prompt_tokens": r.prompt_eval_count,
                              "answer_tokens": ra.eval_count, "thinking_tokens": used, "budget_reached": was_cut,
                              "seconds": round(think_secs * used / max(1, r.eval_count) + time.perf_counter() - t1, 2)})
        print(f"{k}/{len(questions)} q{i}: thought {r.eval_count} tokens in {think_secs:.0f}s"
              f"{' (budget reached)' if r.done_reason == 'length' else ''}", flush=True)


if __name__ == "__main__":
    main()
