"""Measure the agent: task success with exact answers, and what the calculate tool adds.

  python -m sumproof.agent.eval run [--conditions agent,agent_nocalc] [--limit N]
  python -m sumproof.agent.eval report

Tasks (fixed, no randomness at run time):
  receipts  22 questions over the 100 test receipts whose answers come straight from the saved
            model readings (counts, totals, yes/no checks, sums), so they test tool use, not OCR
  finance   the 50 FinanceBench metric questions, graded by the same exact rule as the RAG evaluation
            (the stated figure within 1% of the analysts' answer)

Conditions: agent (all tools) and agent_nocalc (the calculate tool removed): the difference is the
calculator's contribution. Runs append to results/agent_runs.jsonl and resume where they stopped.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

from ..rag.answer import numbers, numeric_match, stated_numbers
from ..receipts.amounts import parse_amount

RUNS = Path("results/agent_runs.jsonl")
SUMMARY = Path("results/agent_eval.json")
RECEIPTS = Path("web/public/data/receipts.json")
CONDITIONS = {"agent": set(), "agent_nocalc": {"calculate"}}


# ---------- tasks ----------

def receipt_tasks() -> list[dict]:
    recs = json.loads(RECEIPTS.read_text(encoding="utf-8"))
    total = {r["id"]: parse_amount((r["pred"] or {}).get("total")) for r in recs}
    flagged = [r["id"] for r in recs if r["flagged"]]
    accepted = [r["id"] for r in recs if not r["flagged"] and r["checks"] and total[r["id"]]]
    t: list[dict] = [
        {"id": "r_count_review", "q": "How many of the 100 receipts need human review?", "kind": "number", "expected": len(flagged)},
        {"id": "r_list_review", "q": "Which receipts need review? List their ids.", "kind": "ids", "expected": sorted(flagged)},
        {"id": "r_sum_review", "q": "What do the totals of all receipts that need review add up to?", "kind": "number",
         "expected": sum(total[i] for i in flagged if total[i])},
    ]
    for i in accepted[:6]:
        t.append({"id": f"r_total_{i}", "q": f"What is the total on receipt #{i}?", "kind": "number", "expected": total[i]})
    for i in flagged[:3] + accepted[6:9]:
        t.append({"id": f"r_pass_{i}", "q": f"Does receipt #{i} pass all of its accounting checks? Start your answer with yes or no.",
                  "kind": "yesno", "expected": i not in flagged})
    for r in [r for r in recs if r["pred"] and r["pred"].get("items")][10:14]:
        t.append({"id": f"r_items_{r['id']}", "q": f"How many line items are on receipt #{r['id']}?", "kind": "number",
                  "expected": len(r["pred"]["items"])})
    for a, b in [(accepted[9], accepted[10]), (accepted[11], accepted[12]), (accepted[13], accepted[14])]:
        t.append({"id": f"r_pair_{a}_{b}", "q": f"What is the combined total of receipts #{a} and #{b}?", "kind": "number",
                  "expected": total[a] + total[b]})
    for x in t:
        x["group"] = "receipts"
    return t


def finance_tasks() -> list[dict]:
    import pandas as pd

    q = pd.read_parquet("data/financebench/questions.parquet")
    return [{"id": f"f_{i}", "i": i, "q": q.question.iloc[i], "kind": "reference", "expected": str(q.answer.iloc[i]), "group": "finance"}
            for i in range(len(q)) if q.question_type.iloc[i] == "metrics-generated"]


# ---------- grading ----------

def grade(task: dict, answer: str) -> bool:
    kind, exp = task["kind"], task["expected"]
    if kind == "reference":
        return bool(numeric_match(answer, exp))
    if kind == "yesno":
        m = re.match(r"\W*(yes|no)\b", answer.strip(), re.I)
        return bool(m) and (m.group(1).lower() == "yes") == exp
    if kind == "ids":
        # Small integers that are not part of a bigger number: a list comma ("0, 12") or a final period is fine,
        # but "1,234" or "2.5" is one number, not several ids.
        found = {int(v) for v in re.findall(r"(?<!\d)(?<!\d[.,])\d{1,2}(?!\d|[.,]\d)", answer)}
        return found == set(exp)
    nums = stated_numbers(answer) or numbers(answer)
    return any(abs(v - exp) <= max(0.01 * abs(exp), 0.5) for v in nums)


# ---------- running ----------

def _load(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()] if path.exists() else []


async def run(conditions: list[str], limit: int | None) -> None:
    from mcp import Client

    from .agent import ask, server_params

    tasks = receipt_tasks() + finance_tasks()
    if limit:
        tasks = [t for t in tasks if t["group"] == "receipts"][:limit] + [t for t in tasks if t["group"] == "finance"][:limit]
    done = {(r["task"], r["condition"]) for r in _load(RUNS)}
    todo = [(c, t) for c in conditions for t in tasks if (t["id"], c) not in done]
    print(f"{len(todo)} agent runs to do ({len(done)} done)", flush=True)
    async with Client(server_params(), read_timeout_seconds=600) as client:
        for n, (cond, task) in enumerate(todo, 1):
            out = await ask(client, task["q"], exclude=CONDITIONS[cond])
            ok = grade(task, out["answer"])
            rec = {"task": task["id"], "group": task["group"], "condition": cond, "correct": ok, "answer": out["answer"],
                   "tools": [c["tool"] for c in out["calls"]], "calls": out["calls"], "seconds": out["seconds"]}
            with RUNS.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print(f"{n}/{len(todo)} {cond} {task['id']}: {'OK ' if ok else 'BAD'} {len(out['calls'])} calls {out['seconds']}s | "
                  f"{out['answer'][:80]!r}", flush=True)


def report() -> None:
    # Grade again from the saved answers, so a fix to the grading rules needs no new agent runs.
    tasks = {t["id"]: t for t in receipt_tasks() + finance_tasks()}
    runs = [{**r, "correct": grade(tasks[r["task"]], r["answer"])} for r in _load(RUNS)]
    out: dict = {"model": "qwen3.5:4b (Ollama)", "conditions": {}}
    for cond in CONDITIONS:
        rs = [r for r in runs if r["condition"] == cond]
        if not rs:
            continue
        row = {}
        for group in ("receipts", "finance"):
            g = [r for r in rs if r["group"] == group]
            if g:
                row[group] = {"tasks": len(g), "success": round(sum(r["correct"] for r in g) / len(g), 3),
                              "tool_calls_mean": round(sum(len(r["tools"]) for r in g) / len(g), 2),
                              "used_calculate": round(sum("calculate" in r["tools"] for r in g) / len(g), 3),
                              "seconds_mean": round(sum(r["seconds"] for r in g) / len(g), 1)}
        out["conditions"][cond] = row
    SUMMARY.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"{'condition':<14}{'group':<10}{'tasks':>6}{'success':>9}{'calls':>7}{'calc used':>10}{'s/task':>8}")
    for cond, row in out["conditions"].items():
        for group, m in row.items():
            print(f"{cond:<14}{group:<10}{m['tasks']:>6}{m['success']:>9.1%}{m['tool_calls_mean']:>7}{m['used_calculate']:>10.0%}{m['seconds_mean']:>8}")
    print(f"saved {SUMMARY}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["run", "report"])
    ap.add_argument("--conditions", default=",".join(CONDITIONS))
    ap.add_argument("--limit", type=int, default=None, help="first N tasks of each group (smoke test)")
    a = ap.parse_args()
    if a.step == "run":
        asyncio.run(run([c for c in a.conditions.split(",") if c], a.limit))
    else:
        report()


if __name__ == "__main__":
    main()
