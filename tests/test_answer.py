"""RAG answer generation: page gate, prompts, citations, refusals, numeric check, summary (CPU only)."""

from sumproof.rag.answer import (
    adaptive_k,
    build_messages,
    is_refusal,
    numbers,
    numeric_match,
    page_label,
    parse_citations,
    reference_number,
    select_pages,
    summarize,
    verdict_from,
)

RANK = {"reranked": [46, 59, 38, 6, 13, 57], "reranker_scores": [3.9, 3.7, 3.3, 3.0, 2.1, 1.9], "gold_rows": [59]}


def test_adaptive_k_keeps_pages_until_90_percent():
    assert adaptive_k([10.0, 0.0, 0.0, 0.0, 0.0]) == 1  # one page dominates
    assert adaptive_k([1.0, 1.0, 1.0, 1.0, 1.0]) == 5  # all equal: need all five
    assert adaptive_k([5.0, 5.0, -5.0, -5.0, -5.0]) == 2
    assert adaptive_k([3.0]) == 1 and adaptive_k([]) == 0


def test_select_pages_per_setting():
    assert select_pages("closed", RANK) == []
    assert select_pages("top5", RANK) == [46, 59, 38, 6, 13]
    assert 1 <= len(select_pages("adaptive", RANK)) <= 5
    assert select_pages("oracle", RANK) == [59]


def test_prompt_numbers_pages_and_labels_them():
    assert page_label("3M_2018_10K", 59) == "3M 2018 10K, page 60"
    msgs = build_messages("What was capex?", [("3M_2018_10K", 59, "Capital spending 1,577")])
    assert msgs[0]["role"] == "system" and "Source: [n]" in msgs[0]["content"]
    assert "[1] 3M 2018 10K, page 60\nCapital spending 1,577" in msgs[1]["content"]
    closed = build_messages("What was capex?", [])
    assert "I don't know." in closed[0]["content"] and "Filing pages" not in closed[1]["content"]


def test_refusals_and_citations():
    assert is_refusal("Not found in the provided pages.") and is_refusal("I don't know")
    assert not is_refusal("Capex was $1,577 million.\nSource: [2]")
    assert parse_citations("Capex was $1,577 million [1].\nSource: [2], [3]") == [2, 3]
    assert parse_citations("Capex was $1,577 million [1].") == [1]
    assert parse_citations("Capex was $1,577 million on page 60.\nSource: 1") == [1]


def test_numbers_and_numeric_match():
    assert numbers("$1,577.00") == [1577.0]
    assert numbers("about $1.6 billion") == [1600.0]
    assert numbers("(123)") == [-123.0]
    assert numeric_match("Capex was $1,577 million.", "$1577.00") is True
    assert numeric_match("Capex was $1.577 billion.", "$1577.00") is True
    assert numeric_match("Capex was $1.9 billion.", "$1577.00") is False
    assert numeric_match("36%", "36%. The answer assumes FY2023") is True
    assert numeric_match("anything", "Performance is not measured through operating margin") is None
    # The stated result counts, not a number from the working (a real case: reference 0.54).
    assert numeric_match("The FY2022 retention ratio is 0.95. Calculation: 1 - 0.5435 = 0.9565", "0.54") is False
    assert numeric_match("The FY2022 retention ratio is 0.54. Calculation: (2,707 - 1,244) / 2,707", "0.54") is True
    assert numeric_match("Revenue grew 101.8% from FY2019 to FY2020.", "101.5%") is True  # years are ignored


def test_summary_counts_and_citation_accuracy():
    rankings = [RANK, {**RANK, "gold_rows": [6]}]
    answers = [
        {"i": 0, "mode": "top5", "rows": [46, 59, 38, 6, 13], "answer": "$1,577 million.\nSource: [2]", "prompt_tokens": 5000, "answer_tokens": 20, "seconds": 10},
        {"i": 1, "mode": "top5", "rows": [46, 59, 38, 6, 13], "answer": "Not found in the provided pages.", "prompt_tokens": 5000, "answer_tokens": 8, "seconds": 8},
        {"i": 0, "mode": "closed", "rows": [], "answer": "$2,000 million.", "prompt_tokens": 80, "answer_tokens": 10, "seconds": 2},
    ]
    judgements = [
        {"i": 0, "mode": "top5", "verdict": "CORRECT", "method": "rule", "judge_verdict": "CORRECT"},
        {"i": 0, "mode": "closed", "verdict": "INCORRECT", "method": "rule", "judge_verdict": "CORRECT"},
    ]
    s = summarize(["metrics-generated", "domain-relevant"], ["$1577.00", "x"], answers, judgements, rankings)
    top5, closed = s["modes"]["top5"], s["modes"]["closed"]
    assert (top5["correct"], top5["refused"], top5["wrong"]) == (0.5, 0.5, 0.0)
    assert top5["correct_answers_citing_evidence_page"] == 1.0 and top5["context_has_evidence_page"] == 1.0
    assert closed["wrong"] == 1.0 and closed["context_has_evidence_page"] is None
    assert s["judge_vs_numeric_rule"] == {"answers": 2, "agreement": 0.5}
    assert s["graded_by"] == {"rule": 2, "judge": 0}


def test_reference_number_and_judge_verdict():
    assert reference_number("metrics-generated", "$1577.00") == 1577.0
    assert reference_number("metrics-generated", "36%. The answer assumes FY2023") == 36.0
    assert reference_number("metrics-generated", "Performance is not measured through operating margin") is None
    assert reference_number("domain-relevant", "$8.70") is None  # explanation questions go to the model judge
    assert verdict_from("<think>maybe CORRECT at first, but no</think>\nINCORRECT") == "INCORRECT"
    assert verdict_from("The numbers agree.\n\nCORRECT") == "CORRECT"
    assert verdict_from("no verdict here") == "UNCLEAR"
