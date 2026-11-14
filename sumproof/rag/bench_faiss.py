"""FAISS check and benchmark on the 12,013 FinanceBench pages.

  python -m sumproof.rag.bench_faiss

1. Equivalence: FAISS IndexFlatIP must rank pages exactly like the brute-force
   NumPy search it replaced (with and without filing routing), so every number
   in the retrieval table stays valid.
2. Exact vs approximate: IndexFlatIP against IndexHNSWFlat at several efSearch
   values. Reports latency per query, overlap with the exact top-10, and the
   end-task metric (Recall@5 on the analysts' evidence pages).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from . import index as fx
from .financebench import DATA, build_router, embed_pages, embed_queries, load

EF_SEARCH = (16, 32, 64, 128, 256)


def timed_search(index, queries, k, repeats=20, **kw):
    t0 = time.perf_counter()
    for _ in range(repeats):
        results = [fx.search(index, qv, k, **kw) for qv in queries]
    return results, (time.perf_counter() - t0) / (repeats * len(queries)) * 1000


def recall_at(ranked_lists, golds, k):
    return float(np.mean([any(i in g for i in r[:k]) for r, g in zip(ranked_lists, golds)]))


def main() -> None:
    q, pages = load()
    page_vecs = embed_pages(pages).astype(np.float32)
    query_vecs = embed_queries(q.question.tolist()).astype(np.float32)
    key_to_row = {(d, p): i for i, (d, p) in enumerate(zip(pages.doc_name, pages.page))}
    golds = [{key_to_row[(e["doc_name"], e["evidence_page_num"])] for e in ev if (e["doc_name"], e["evidence_page_num"]) in key_to_row}
             for ev in q.evidence]

    # ---- 1. equivalence with the NumPy search ----
    flat = fx.build(page_vecs, "flat")
    route = build_router(q, pages)
    doc_of_row = pages.doc_name.to_numpy()
    same_plain = same_routed = 0
    for qv, question in zip(query_vecs, q.question):
        scores = page_vecs @ qv
        np_top = [int(j) for j in np.argsort(-scores, kind="stable")[:50]]
        same_plain += np_top == fx.search(flat, qv, 50)
        allowed = route(question)
        if allowed is not None:
            mask = np.isin(doc_of_row, allowed)
            np_routed = [int(j) for j in np.argsort(-np.where(mask, scores, -np.inf), kind="stable")[:20] if mask[j]]
            fx_routed = fx.search(flat, qv, len(np_routed), allowed_ids=np.flatnonzero(mask))
            same_routed += np_routed == fx_routed
        else:
            same_routed += 1
    print(f"FAISS flat == NumPy: top-50 identical for {same_plain}/150 queries, routed top-20 identical for {same_routed}/150")

    # ---- 2. exact vs HNSW ----
    flat_res, flat_ms = timed_search(flat, query_vecs, 10)
    rows = [{"index": "IndexFlatIP (exact)", "efSearch": None, "ms_per_query": round(flat_ms, 3),
             "overlap@10_vs_exact": 1.0, "recall@5_gold": round(recall_at(flat_res, golds, 5), 3)}]

    t0 = time.perf_counter()
    hnsw = fx.build(page_vecs, "hnsw")
    build_s = time.perf_counter() - t0
    for ef in EF_SEARCH:
        res, ms = timed_search(hnsw, query_vecs, 10, ef_search=ef)
        overlap = np.mean([len(set(a) & set(b)) / 10 for a, b in zip(res, flat_res)])
        rows.append({"index": "IndexHNSWFlat (M=32)", "efSearch": ef, "ms_per_query": round(ms, 3),
                     "overlap@10_vs_exact": round(float(overlap), 3), "recall@5_gold": round(recall_at(res, golds, 5), 3)})

    out = {"n_vectors": len(page_vecs), "dim": int(page_vecs.shape[1]), "hnsw_build_seconds": round(build_s, 1),
           "equivalence": {"top50_identical": same_plain, "routed_top20_identical": same_routed, "n": 150},
           "benchmark": rows}
    Path("results").mkdir(exist_ok=True)
    Path("results/faiss_benchmark.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

    print(f"\n{len(page_vecs)} vectors x {page_vecs.shape[1]} dims, HNSW build {build_s:.1f}s\n")
    print(f"{'index':<24}{'efSearch':>9}{'ms/query':>10}{'top10 overlap':>15}{'Recall@5':>10}")
    for r in rows:
        print(f"{r['index']:<24}{str(r['efSearch'] or '-'):>9}{r['ms_per_query']:>10.3f}{r['overlap@10_vs_exact']:>15.3f}{r['recall@5_gold']:>10.3f}")


if __name__ == "__main__":
    main()
