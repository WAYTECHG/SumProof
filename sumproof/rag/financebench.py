"""Financial RAG retrieval on FinanceBench: real SEC filings, expert-labelled evidence pages.

  python -m sumproof.rag.financebench            # builds the index once, then evaluates

Data: 150 questions written by financial analysts about 84 real 10-K/10-Q/8-K
filings from 32 companies (PatronusAI/financebench, CC-BY-NC-4.0). Each question
names the page(s) that hold the answer, so retrieval is scored against human
labels, not against labels we wrote.

Corpus: all 12,013 pages of the 84 filings, searched together (harder than the
common "one document per question" setup).

Ablation ladder (each row adds one thing):
  1. BM25                       keyword baseline
  2. Dense                      Qwen3-Embedding-0.6B with a finance retrieval instruction
  3. Hybrid (RRF)               BM25 + dense with Reciprocal Rank Fusion. Reported because it is the
                                common default; on 10-K pages it HURTS (BM25 is weak on repetitive
                                filing text and number tables), so later steps build on dense.
  4. Dense + filing routing     detect the company (name, ticker, common name) and year in the
                                question and search only matching filings; questions that name no
                                company search everything
  5. + reranker                 Qwen3-Reranker-0.6B re-scores the top 30 routed pages

Metric: Recall@k = share of questions where a gold evidence page is in the top k;
MRR@10. Gold page numbers are 0-based; 173 of 189 evidence snippets match the
extracted text of the stated page exactly (the rest are tables that PDF text
extraction renders differently).
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .fusion import rrf, tokenize
from . import index as faiss_index

DATA = Path("data/financebench")
EMBED_MODEL = "Qwen/Qwen3-Embedding-0.6B"
RERANK_MODEL = "Qwen/Qwen3-Reranker-0.6B"
QUERY_PROMPT = "Instruct: Given a question about a company's financial filing, retrieve the filing page that answers it\nQuery: "
RERANK_INSTRUCTION = "Given a question about a company's financial filing, judge whether this filing page contains the answer"
MAX_TOKENS = 1024
RERANK_TOP = 30
KS = (1, 5, 10, 20)


# ---------- corpus ----------

def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    q = pd.read_parquet(DATA / "questions.parquet")
    pages = pd.read_parquet(DATA / "pages.parquet")
    pages["text"] = pages.text.fillna("")
    return q, pages


def parse_doc_name(doc: str) -> tuple[str, int | None]:
    """'3M_2018_10K' -> ('3m', 2018); 'AMCOR_2023Q2_10Q' -> ('amcor', 2023)."""
    m = re.match(r"(.+?)_(\d{4})", doc)
    return (m.group(1).lower(), int(m.group(2))) if m else (doc.lower(), None)


# ---------- step 4: route the question to the right filings ----------

# Company catalogue: stock ticker and common short name for EVERY company in the corpus,
# the way a financial data tool would know them. Tickers that are ordinary English words
# or too short to be safe (COST, BA, KO, FL, SQ) are left out.
ALIASES = {
    "3m": ["mmm"], "activisionblizzard": ["atvi", "activision"], "adobe": ["adbe"], "aes": [],
    "amazon": ["amzn"], "amcor": ["amcr"], "amd": ["advanced micro devices"],
    "americanexpress": ["axp", "amex"], "americanwaterworks": ["awk", "american water"],
    "bestbuy": ["bby"], "block": ["square"], "boeing": [], "cocacola": ["coke"], "corning": ["glw"],
    "costco": [], "cvshealth": ["cvs"], "footlocker": [], "generalmills": ["gis"],
    "johnson_johnson": ["jnj", "j&j", "johnson and johnson"], "jpmorgan": ["jpm", "jp morgan", "jpmorgan chase"],
    "kraftheinz": ["khc", "kraft"], "lockheedmartin": ["lmt", "lockheed"], "mgmresorts": ["mgm"],
    "microsoft": ["msft"], "netflix": ["nflx"], "nike": ["nke"], "paypal": ["pypl"], "pepsico": ["pep", "pepsi"],
    "pfizer": ["pfe"], "ultabeauty": ["ulta"], "verizon": ["vz"], "walmart": ["wmt"],
}


def _norm(text: str) -> str:
    """Lower-case and turn punctuation into spaces so 'Coca-Cola' matches 'Coca Cola'."""
    return " " + re.sub(r"[^a-z0-9&]+", " ", text.lower()).strip() + " "


def build_router(q: pd.DataFrame, pages: pd.DataFrame):
    """Map company names and tickers (from the corpus catalogue, not the question labels) to filings."""
    docs = sorted(pages.doc_name.unique())
    catalogue = {d: parse_doc_name(d) for d in docs}
    names: dict[str, set[str]] = {}
    for d, company in q[["doc_name", "company"]].drop_duplicates().itertuples(index=False):
        key = catalogue[d][0]
        names.setdefault(key, set()).update({_norm(company), _norm(key.replace("_", " "))})
        names[key].update(_norm(a) for a in ALIASES.get(key, []))

    def route(question: str) -> list[str] | None:
        text = _norm(question)
        companies = {key for key, aliases in names.items() if any(a in text for a in aliases)}
        if not companies:
            return None  # no company detected: search everything
        cand = [d for d in docs if catalogue[d][0] in companies]
        years = {int(y) for y in re.findall(r"(?<!\d)(20\d{2})(?!\d)", text)}  # FY2018, 2018, Q2 2023
        dated = [d for d in cand if catalogue[d][1] in years]
        return dated or cand

    return route


# ---------- models ----------

def embed_pages(pages: pd.DataFrame) -> np.ndarray:
    cache = DATA / "page_embeddings_qwen3_0.6b.npy"
    if cache.exists():
        return np.load(cache)
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(EMBED_MODEL, model_kwargs={"dtype": "float16"}, tokenizer_kwargs={"padding_side": "left"})
    model.max_seq_length = MAX_TOKENS
    t0 = time.time()
    vecs = model.encode(pages.text.tolist(), batch_size=8, normalize_embeddings=True, show_progress_bar=True)
    print(f"embedded {len(pages)} pages in {time.time() - t0:.0f}s")
    np.save(cache, vecs.astype(np.float16))
    return vecs


def embed_queries(questions: list[str]) -> np.ndarray:
    """Query embeddings, cached. Computed in float32 on CPU so they do not depend on what else uses the GPU."""
    cache = DATA / "query_embeddings_qwen3_0.6b.npy"
    if cache.exists():
        return np.load(cache)
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(EMBED_MODEL, device="cpu", model_kwargs={"dtype": "float32"}, tokenizer_kwargs={"padding_side": "left"})
    vecs = model.encode(questions, prompt=QUERY_PROMPT, normalize_embeddings=True, batch_size=16)
    np.save(cache, vecs.astype(np.float32))
    return vecs


# ---------- evaluation ----------

def score(ranked: list[int], gold: set[int]) -> dict:
    out = {f"R@{k}": float(any(i in gold for i in ranked[:k])) for k in KS}
    rr = next((1.0 / r for r, i in enumerate(ranked[:10], 1) if i in gold), 0.0)
    return out | {"MRR@10": rr}


def main() -> None:
    from rank_bm25 import BM25Okapi

    q, pages = load()
    key_to_row = {(d, p): i for i, (d, p) in enumerate(zip(pages.doc_name, pages.page))}
    golds = [{key_to_row[(e["doc_name"], e["evidence_page_num"])] for e in ev if (e["doc_name"], e["evidence_page_num"]) in key_to_row}
             for ev in q.evidence]

    print("building BM25 ...")
    bm25 = BM25Okapi([tokenize(t) for t in pages.text])
    page_vecs = embed_pages(pages).astype(np.float32)
    query_vecs = embed_queries(q.question.tolist()).astype(np.float32)
    vindex = faiss_index.load_or_build(DATA / "pages_flat.faiss", page_vecs, kind="flat")
    route = build_router(q, pages)
    doc_of_row = pages.doc_name.to_numpy()
    rows_of_doc = {d: np.flatnonzero(doc_of_row == d) for d in np.unique(doc_of_row)}

    runs = {name: [] for name in ("1_bm25", "2_dense", "3_hybrid_rrf", "4_dense_routed", "5_dense_routed_reranked")}
    routed_ok, candidates_for_rerank = 0, []
    for i, question in enumerate(q.question):
        bm = bm25.get_scores(tokenize(question))
        bm_rank = [int(j) for j in np.argsort(-bm)[:200]]
        dn_rank = faiss_index.search(vindex, query_vecs[i], 200)
        hy = rrf([bm_rank, dn_rank])

        allowed = route(question)
        if allowed is not None:
            ids = np.concatenate([rows_of_doc[d] for d in allowed])
            routed = faiss_index.search(vindex, query_vecs[i], min(200, len(ids)), allowed_ids=ids)
        else:
            routed = dn_rank  # no company named: search every filing
        gold_docs = {e["doc_name"] for e in q.evidence.iloc[i]}
        routed_ok += allowed is None or bool(gold_docs & set(allowed))

        for name, ranked in (("1_bm25", bm_rank), ("2_dense", dn_rank), ("3_hybrid_rrf", hy), ("4_dense_routed", routed)):
            runs[name].append(score(ranked, golds[i]))
        candidates_for_rerank.append(routed[:RERANK_TOP])

    # Step 5: rerank the top routed pages with a cross-encoder.
    from sentence_transformers import CrossEncoder

    reranker = CrossEncoder(RERANK_MODEL, model_kwargs={"dtype": "float16"}, max_length=MAX_TOKENS,
                            prompts={"finance": RERANK_INSTRUCTION}, default_prompt_name="finance")
    t0 = time.time()
    for i, question in enumerate(q.question):
        cand = candidates_for_rerank[i]
        s = reranker.predict([(question, pages.text.iloc[j]) for j in cand], batch_size=4)
        reranked = [cand[j] for j in np.argsort(-np.asarray(s))]
        runs["5_dense_routed_reranked"].append(score(reranked, golds[i]))
    print(f"reranked 150 x {RERANK_TOP} pages in {time.time() - t0:.0f}s")

    table = {name: {m: round(float(np.mean([r[m] for r in rs])), 3) for m in rs[0]} for name, rs in runs.items()}
    by_type = {}
    for name, rs in runs.items():
        by_type[name] = {t: round(float(np.mean([r["R@5"] for r, tt in zip(rs, q.question_type) if tt == t])), 3)
                         for t in sorted(q.question_type.unique())}
    result = {"n_questions": len(q), "n_pages": len(pages), "n_filings": int(pages.doc_name.nunique()),
              "router_kept_right_filing": round(routed_ok / len(q), 3), "metrics": table, "recall@5_by_question_type": by_type}
    Path("results").mkdir(exist_ok=True)
    Path("results/financebench_retrieval.json").write_text(json.dumps(result, indent=1), encoding="utf-8")

    print(f"\n{len(q)} questions, {len(pages)} pages, {pages.doc_name.nunique()} filings | "
          f"routing kept the right filing for {routed_ok}/{len(q)} questions\n")
    print(f"{'step':<22}" + "".join(f"{m:>8}" for m in table["1_bm25"]))
    for name, row in table.items():
        print(f"{name:<22}" + "".join(f"{v:>8.3f}" for v in row.values()))


if __name__ == "__main__":
    main()
