"""Keyword tokenisation for BM25 and Reciprocal Rank Fusion (RRF) of ranked lists.

RRF merges several rankings without putting their scores on one scale:

    score(doc) = sum over lists of 1 / (k + rank_in_list),   k = 60

It is the common default for hybrid (BM25 + dense) search. On FinanceBench it hurts,
because BM25 is much weaker than dense retrieval on 10-K pages and RRF weights both
lists equally; it is kept as a measured baseline.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

RRF_K = 60

_STOP = set(
    "a an and are as at be by can do does for from has have how i if in is it its of on or our so that the "
    "their them they this to was we what when which who why will with you your".split()
)


def tokenize(text: str) -> list[str]:
    """Lower-case word tokens without stop words; '1,000,000' becomes '1000000'."""
    text = re.sub(r"(?<=\d),(?=\d{3})", "", text.lower())
    return [t for t in re.findall(r"[a-z0-9]+", text) if t not in _STOP]


def rrf(rankings: Sequence[Sequence[int]], k: int = RRF_K) -> list[int]:
    """Merge ranked id lists; ties break by id so the result is deterministic."""
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, doc in enumerate(ranking, 1):
            scores[doc] = scores.get(doc, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda d: (-scores[d], d))
