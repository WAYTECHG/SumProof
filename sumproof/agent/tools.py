"""The tools behind the MCP server, as plain Python (testable without MCP or any model).

  search_filings   router + Qwen3-Embedding + Qwen3-Reranker over 12,013 SEC filing pages
  read_page        the text of one filing page
  calculate        exact arithmetic (the RAG evaluation showed calculation is the model's weak point)
  list_receipts    the 100 test receipts as read by the fine-tuned model, with their review status
  get_receipt      one receipt's fields and its accounting-rule results
"""

from __future__ import annotations

import ast
import json
import math
import operator
import re
from functools import lru_cache
from pathlib import Path

from ..receipts.amounts import parse_amount

RECEIPTS = Path("web/public/data/receipts.json")
PAGE_CHARS = 6000
SNIPPET_CHARS = 360
RERANK_TOP = 20

# ---------- calculate ----------

_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos,
}
_FUNCS = {"round": round, "abs": abs, "min": min, "max": max, "sqrt": math.sqrt}


def calculate(expression: str) -> float:
    """Evaluate +, -, *, /, **, parentheses and round/abs/min/max/sqrt. Commas, $ and % signs are ignored."""
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", expression).replace("$", "").replace("%", "")
    tree = ast.parse(text, mode="eval")

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 100:
                raise ValueError("exponent too large")
            return _OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
            return _FUNCS[node.func.id](*[ev(a) for a in node.args])
        raise ValueError(f"not allowed in a calculation: {ast.dump(node)[:60]}")

    value = ev(tree)
    return round(float(value), 6)


# ---------- receipts ----------

@lru_cache(maxsize=1)
def _receipts() -> dict[int, dict]:
    return {r["id"]: r for r in json.loads(RECEIPTS.read_text(encoding="utf-8"))}


def _status(r: dict) -> str:
    return "needs review" if r["flagged"] else "accepted"


def list_receipts(status: str = "all") -> list[dict]:
    """status: 'all', 'needs review' or 'accepted'."""
    want = status.strip().lower().replace("_", " ")
    out = []
    for r in _receipts().values():
        if want not in ("all", "") and _status(r) != want:
            continue
        pred = r["pred"] or {}
        # The number, not the printed text: "60.000" on an Indonesian receipt is sixty thousand.
        out.append({"id": r["id"], "status": _status(r), "total": parse_amount(pred.get("total")),
                    "total_as_printed": pred.get("total"), "items": len(pred.get("items") or [])})
    return out


def get_receipt(receipt_id: int) -> dict:
    r = _receipts().get(int(receipt_id))
    if r is None:
        raise ValueError(f"no receipt {receipt_id}; ids run from 0 to {len(_receipts()) - 1}")
    checks = [{"rule": c["name"], "passed": c["passed"], "expected": c["expected"], "found": c["found"]} for c in r["checks"]]
    pred = r["pred"] or {}
    amounts = {k: parse_amount(pred.get(k)) for k in ("subtotal", "discount", "service", "tax", "total", "cash", "change", "card") if pred.get(k)}
    return {"id": r["id"], "status": _status(r), "amounts": amounts, "fields_as_printed": pred, "checks": checks,
            "all_checks_pass": all(c["passed"] for c in checks) if checks else None}


# ---------- filing search ----------

def snippet(text: str, query: str, width: int = SNIPPET_CHARS) -> str:
    """A window of the page around the first word from the query (falls back to the page start)."""
    flat = re.sub(r"\s+", " ", text).strip()
    words = [w for w in re.findall(r"[a-zA-Z]{4,}", query.lower()) if w not in {"what", "which", "does", "from", "with", "that", "this", "were", "have", "fiscal"}]
    low = flat.lower()
    hits = [low.find(w) for w in words if low.find(w) >= 0]
    start = max(0, min(hits) - width // 3) if hits else 0
    return ("…" if start else "") + flat[start:start + width] + ("…" if start + width < len(flat) else "")


class FilingSearch:
    """The evaluated retrieval pipeline, kept in memory: routing, dense search, then reranking."""

    def __init__(self) -> None:
        import numpy as np
        import torch
        from sentence_transformers import CrossEncoder, SentenceTransformer

        from ..rag import financebench as fb
        from ..rag import index as faiss_index

        self.fb, self.np, self.faiss_index = fb, np, faiss_index
        self.q, self.pages = fb.load()
        vecs = fb.embed_pages(self.pages).astype(np.float32)
        self.index = faiss_index.load_or_build(fb.DATA / "pages_flat.faiss", vecs, kind="flat")
        self.route = fb.build_router(self.q, self.pages)
        docs = self.pages.doc_name.to_numpy()
        self.rows_of_doc = {d: np.flatnonzero(docs == d) for d in np.unique(docs)}
        self.embedder = SentenceTransformer(fb.EMBED_MODEL, device="cpu", model_kwargs={"dtype": "float32"},
                                            tokenizer_kwargs={"padding_side": "left"})
        gpu = torch.cuda.is_available()
        self.reranker = CrossEncoder(fb.RERANK_MODEL, device="cuda" if gpu else "cpu",
                                     model_kwargs={"dtype": "float16" if gpu else "float32"}, max_length=fb.MAX_TOKENS,
                                     prompts={"finance": fb.RERANK_INSTRUCTION}, default_prompt_name="finance")

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        np = self.np
        vec = self.embedder.encode([query], prompt=self.fb.QUERY_PROMPT, normalize_embeddings=True)[0].astype(np.float32)
        allowed = self.route(query)
        if allowed:
            ids = np.concatenate([self.rows_of_doc[d] for d in allowed])
            cand = self.faiss_index.search(self.index, vec, min(RERANK_TOP, len(ids)), allowed_ids=ids)
        else:
            cand = self.faiss_index.search(self.index, vec, RERANK_TOP)
        scores = self.reranker.predict([(query, self.pages.text.iloc[j]) for j in cand], batch_size=4)
        order = np.argsort(-np.asarray(scores))[: max(1, min(int(top_k), 10))]
        return [self.describe(int(cand[k]), query, float(scores[k])) for k in order]

    def describe(self, row: int, query: str, score: float | None = None) -> dict:
        doc, page = self.pages.doc_name.iloc[row], int(self.pages.page.iloc[row])
        out = {"page_id": row, "filing": doc.replace("_", " "), "page": page + 1, "snippet": snippet(self.pages.text.iloc[row], query)}
        if score is not None:
            out["relevance"] = round(score, 2)
        return out

    def read(self, page_id: int) -> dict:
        row = int(page_id)
        if not 0 <= row < len(self.pages):
            raise ValueError(f"no page {page_id}; use a page_id returned by search_filings")
        doc, page = self.pages.doc_name.iloc[row], int(self.pages.page.iloc[row])
        return {"page_id": row, "filing": doc.replace("_", " "), "page": page + 1, "text": self.pages.text.iloc[row][:PAGE_CHARS]}


_search: FilingSearch | None = None


def filings() -> FilingSearch:
    """Load the retrieval models on first use (about 20 s), so the MCP server starts instantly."""
    global _search
    if _search is None:
        _search = FilingSearch()
    return _search
