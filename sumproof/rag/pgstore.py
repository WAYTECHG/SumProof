"""PostgreSQL + pgvector store for the FinanceBench pages.

Each page is one row: its filing metadata (company, fiscal year, filing type, page
number), its text, and its 1024-dim Qwen3-Embedding vector. Filing routing becomes
an ordinary SQL filter next to the vector search:

    SELECT id FROM pages
    WHERE doc_name = ANY(%(docs)s)              -- routing: company + fiscal year
    ORDER BY embedding <#> %(q)s                -- <#> = negative inner product
    LIMIT 200;

Vectors are L2-normalised, so inner product = cosine similarity, matching FAISS.

  python -m sumproof.rag.pgstore load      # create table, insert 12,013 pages, build HNSW index
  python -m sumproof.rag.pgstore bench     # compare with FAISS: same results? how fast?
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np

DSN = os.environ.get("SUMPROOF_PG", "dbname=sumproof")
DIM = 1024


def connect():
    import psycopg
    from pgvector.psycopg import register_vector

    conn = psycopg.connect(DSN, autocommit=True)
    register_vector(conn)
    return conn


def doc_meta(doc_name: str) -> tuple[str, int | None, str]:
    """'PEPSICO_2022_10K' -> ('pepsico', 2022, '10K'); 'AMCOR_2023Q2_10Q' -> ('amcor', 2023, '10Q')."""
    m = re.match(r"(.+?)_(\d{4})(?:Q\d)?_([A-Z0-9]+)", doc_name)
    if not m:
        return doc_name.lower(), None, "OTHER"
    return m.group(1).lower(), int(m.group(2)), m.group(3)


SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
DROP TABLE IF EXISTS pages;
CREATE TABLE pages (
  id          integer PRIMARY KEY,      -- same row order as pages.parquet / FAISS ids
  doc_name    text    NOT NULL,
  company     text    NOT NULL,
  fiscal_year integer,
  doc_type    text    NOT NULL,         -- 10K, 10Q, 8K, EARNINGS
  page        integer NOT NULL,         -- 0-based, as in FinanceBench labels
  content     text    NOT NULL,
  embedding   vector({DIM}) NOT NULL
);
CREATE INDEX pages_doc_idx ON pages (doc_name);
CREATE INDEX pages_company_year_idx ON pages (company, fiscal_year);
"""


def load() -> None:
    from .financebench import embed_pages, load as load_fb

    _, pages = load_fb()
    vecs = embed_pages(pages).astype(np.float32)
    with connect() as conn:
        conn.execute(SCHEMA)
        t0 = time.time()
        with conn.cursor().copy(
            "COPY pages (id, doc_name, company, fiscal_year, doc_type, page, content, embedding) FROM STDIN WITH (FORMAT BINARY)"
        ) as cp:
            cp.set_types(["int4", "text", "text", "int4", "text", "int4", "text", "vector"])
            for i, (d, p, t) in enumerate(zip(pages.doc_name, pages.page, pages.text)):
                company, year, dtype = doc_meta(d)
                cp.write_row((i, d, company, year, dtype, int(p), t.replace("\x00", ""), vecs[i]))
        print(f"inserted {len(pages)} pages in {time.time() - t0:.1f}s")
        t0 = time.time()
        conn.execute("SET maintenance_work_mem = '512MB'")
        conn.execute("CREATE INDEX pages_hnsw ON pages USING hnsw (embedding vector_ip_ops) WITH (m = 16, ef_construction = 64)")
        print(f"built HNSW index in {time.time() - t0:.1f}s")
        conn.execute("ANALYZE pages")


def search(conn, query: np.ndarray, k: int, docs: list[str] | None = None, exact: bool = True,
           ef_search: int = 100) -> list[int]:
    """Top-k page ids. exact=True forces a full scan (no index) so results equal FAISS IndexFlatIP."""
    with conn.transaction():
        if exact:
            conn.execute("SET LOCAL enable_indexscan = off")
        else:
            # At 12k rows the planner prefers a sequential scan; force the HNSW index so it is really measured.
            conn.execute("SET LOCAL enable_seqscan = off")
            conn.execute(f"SET LOCAL hnsw.ef_search = {int(ef_search)}")
            if docs is not None:  # filtered search: keep scanning the graph until k rows pass the filter
                conn.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        where = "WHERE doc_name = ANY(%(docs)s)" if docs is not None else ""
        rows = conn.execute(
            f"SELECT id FROM pages {where} ORDER BY embedding <#> %(q)s LIMIT %(k)s",
            {"q": np.asarray(query, dtype=np.float32), "k": k, "docs": docs},
        ).fetchall()
    return [r[0] for r in rows]


def bench() -> None:
    from . import index as fx
    from .financebench import build_router, embed_pages, embed_queries
    from .financebench import load as load_fb

    q, pages = load_fb()
    page_vecs = embed_pages(pages).astype(np.float32)
    query_vecs = embed_queries(q.question.tolist()).astype(np.float32)
    flat = fx.build(page_vecs, "flat")
    route = build_router(q, pages)
    doc_of_row = pages.doc_name.to_numpy()

    results = {}
    with connect() as conn:
        # 1. exact pgvector == FAISS, with and without routing
        same = same_routed = 0
        for qv, question in zip(query_vecs, q.question):
            same += search(conn, qv, 10) == fx.search(flat, qv, 10)
            docs = route(question)
            if docs is not None:
                ids = np.flatnonzero(np.isin(doc_of_row, docs))
                same_routed += search(conn, qv, 10, docs=docs) == fx.search(flat, qv, min(10, len(ids)), allowed_ids=ids)
            else:
                same_routed += 1

        # 2. latency, each mode in its own warm loop. Interleaving them lets the exact full-table
        #    scans push the HNSW index out of shared_buffers and makes HNSW look slow.
        def timed(**kw):
            res, ms = [], []
            for qv in query_vecs:
                t0 = time.perf_counter()
                res.append(search(conn, qv, 10, **kw))
                ms.append((time.perf_counter() - t0) * 1000)
            return res, ms

        exact_res, ms_exact = timed(exact=True)
        # Load the HNSW index into shared_buffers first, as a service would at startup.
        conn.execute("CREATE EXTENSION IF NOT EXISTS pg_prewarm")
        conn.execute("SELECT pg_prewarm('pages_hnsw')")
        hnsw_res, ms_hnsw = timed(exact=False)
        hnsw_overlap = [len(set(a) & set(b)) / 10 for a, b in zip(hnsw_res, exact_res)]
        n = len(q)
        results = {
            "exact_top10_identical_to_faiss": f"{same}/{n}",
            "routed_top10_identical_to_faiss": f"{same_routed}/{n}",
            "exact_ms_median": round(float(np.median(ms_exact)), 2),
            "exact_ms_p95": round(float(np.percentile(ms_exact, 95)), 2),
            "hnsw_ms_median": round(float(np.median(ms_hnsw)), 2),
            "hnsw_ms_p95": round(float(np.percentile(ms_hnsw, 95)), 2),
            "hnsw_top10_overlap_with_exact": round(float(np.mean(hnsw_overlap)), 3),
            "table_size": conn.execute("SELECT pg_size_pretty(pg_total_relation_size('pages'))").fetchone()[0],
        }
    Path("results").mkdir(exist_ok=True)
    Path("results/pgvector_benchmark.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    for k, v in results.items():
        print(f"{k:<34} {v}")


if __name__ == "__main__":
    {"load": load, "bench": bench}[sys.argv[1] if len(sys.argv) > 1 else "bench"]()
