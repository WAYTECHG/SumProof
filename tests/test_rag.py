import numpy as np
import pandas as pd
import pytest

from sumproof.rag import index as fx
from sumproof.rag.financebench import build_router, parse_doc_name, score
from sumproof.rag.fusion import rrf, tokenize
from sumproof.rag.pgstore import doc_meta

DOCS = ["3M_2018_10K", "3M_2022_10K", "3M_2023Q2_10Q", "JPMORGAN_2021Q1_10Q", "JPMORGAN_2022_10K",
        "COCACOLA_2021_10K", "JOHNSON_JOHNSON_2022_10K", "JOHNSON_JOHNSON_2023_8K_dated-2023-08-30"]
COMPANY = {"3M": "3M", "JPMORGAN": "JPMorgan", "COCACOLA": "Coca-Cola", "JOHNSON_JOHNSON": "Johnson & Johnson"}


@pytest.fixture(scope="module")
def route():
    q = pd.DataFrame({"doc_name": DOCS, "company": [COMPANY[parse_doc_name(d)[0].upper()] for d in DOCS]})
    pages = pd.DataFrame({"doc_name": DOCS})
    return build_router(q, pages)


# ---------- fusion ----------

def test_tokenize_joins_thousands_and_drops_stop_words():
    assert tokenize("What was the capex above 1,000,000 in FY2018?") == ["capex", "above", "1000000", "fy2018"]


def test_rrf_rewards_pages_both_lists_agree_on():
    # page 2 is second in both lists; pages 0 and 1 top one list each and are missing from the other
    assert rrf([[0, 2], [1, 2]])[0] == 2
    assert rrf([[5, 6], [5, 6]]) == [5, 6]


# ---------- filing names ----------

@pytest.mark.parametrize("doc, expected", [
    ("3M_2018_10K", ("3m", 2018)),
    ("AMCOR_2023Q2_10Q", ("amcor", 2023)),
    ("JOHNSON_JOHNSON_2023_8K_dated-2023-08-30", ("johnson_johnson", 2023)),
])
def test_parse_doc_name(doc, expected):
    assert parse_doc_name(doc) == expected


def test_doc_meta_for_pgvector_rows():
    assert doc_meta("MGMRESORTS_2022Q4_EARNINGS") == ("mgmresorts", 2022, "EARNINGS")
    assert doc_meta("PEPSICO_2022_10K") == ("pepsico", 2022, "10K")


# ---------- router ----------

def test_router_uses_company_and_fiscal_year(route):
    assert route("What is the FY2018 capital expenditure for 3M?") == ["3M_2018_10K"]


def test_router_understands_tickers_and_nicknames(route):
    assert route("Which of JPM's segments had the lowest revenue in 2021 Q1?") == ["JPMORGAN_2021Q1_10Q"]
    assert set(route("Are JnJ's FY2022 financials those of a high growth company?")) == {"JOHNSON_JOHNSON_2022_10K"}


def test_router_ignores_punctuation_in_names(route):
    assert route("What is Coca Cola's FY2021 COGS margin?") == ["COCACOLA_2021_10K"]


def test_router_falls_back_to_all_company_filings_when_year_unknown(route):
    assert set(route("How did 3M's revenue change in 2015?")) == {"3M_2018_10K", "3M_2022_10K", "3M_2023Q2_10Q"}


def test_router_returns_none_when_no_company_is_named(route):
    assert route("Was there any drop in cash between FY 2023 and Q2 of FY2024?") is None


# ---------- metrics ----------

def test_recall_at_k_and_mrr():
    s = score(ranked=[7, 3, 9, 1], gold={9})
    assert (s["R@1"], s["R@5"]) == (0.0, 1.0)
    assert s["MRR@10"] == pytest.approx(1 / 3)
    assert score([1, 2], gold={42})["MRR@10"] == 0.0


# ---------- FAISS ----------

@pytest.fixture(scope="module")
def vectors():
    rng = np.random.default_rng(0)
    v = rng.normal(size=(300, 32)).astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def test_flat_index_matches_brute_force(vectors):
    q = vectors[3] + 0.05
    expected = list(np.argsort(-(vectors @ q), kind="stable")[:10])
    assert fx.search(fx.build(vectors, "flat"), q, 10) == expected


def test_id_filter_restricts_results_to_routed_pages(vectors):
    allowed = np.arange(100, 150)
    hits = fx.search(fx.build(vectors, "flat"), vectors[120], 10, allowed_ids=allowed)
    assert hits[0] == 120 and all(100 <= h < 150 for h in hits)


def test_hnsw_finds_the_nearest_neighbour(vectors):
    hnsw = fx.build(vectors, "hnsw")
    assert fx.search(hnsw, vectors[42], 5, ef_search=64)[0] == 42
