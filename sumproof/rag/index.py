"""FAISS vector index for the filing pages.

- "flat": IndexFlatIP, exact inner-product search (vectors are L2-normalised, so
  inner product = cosine similarity). This is what the pipeline uses.
- "hnsw": IndexHNSWFlat, a graph-based approximate index; benchmarked against
  flat in bench_faiss.py to show the speed/recall trade-off.

Filing routing is done inside FAISS with an ID selector, so the search only
visits pages of the routed filings (FAISS's form of metadata filtering).
"""

from __future__ import annotations

from pathlib import Path

import faiss
import numpy as np


def build(vectors: np.ndarray, kind: str = "flat", hnsw_m: int = 32, ef_construction: int = 200) -> faiss.Index:
    vecs = np.ascontiguousarray(vectors, dtype=np.float32)
    dim = vecs.shape[1]
    if kind == "flat":
        index = faiss.IndexFlatIP(dim)
    elif kind == "hnsw":
        index = faiss.IndexHNSWFlat(dim, hnsw_m, faiss.METRIC_INNER_PRODUCT)
        index.hnsw.efConstruction = ef_construction
    else:
        raise ValueError(f"unknown index kind {kind!r}")
    index.add(vecs)
    return index


def load_or_build(path: Path, vectors: np.ndarray, kind: str = "flat") -> faiss.Index:
    if path.exists():
        index = faiss.read_index(str(path))
        if index.ntotal == len(vectors):
            return index
    index = build(vectors, kind)
    faiss.write_index(index, str(path))
    return index


def search(index: faiss.Index, query: np.ndarray, k: int, allowed_ids: np.ndarray | None = None,
           ef_search: int | None = None) -> list[int]:
    """Top-k page ids for one query, optionally restricted to allowed_ids."""
    q = np.ascontiguousarray(query.reshape(1, -1), dtype=np.float32)
    params = None
    selector = faiss.IDSelectorBatch(np.asarray(allowed_ids, dtype=np.int64)) if allowed_ids is not None else None
    if isinstance(index, faiss.IndexHNSWFlat):
        params = faiss.SearchParametersHNSW(efSearch=ef_search or 64)
        if selector is not None:
            params.sel = selector
    elif selector is not None:
        params = faiss.SearchParameters(sel=selector)
    _, ids = index.search(q, k, params=params)
    return [int(i) for i in ids[0] if i >= 0]
