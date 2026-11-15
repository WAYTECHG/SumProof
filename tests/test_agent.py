"""Agent tools, MCP wiring and grading (no model, no GPU: the filing search is not loaded here)."""

import asyncio
import json

import pytest

from sumproof.agent import tools
from sumproof.agent.agent import tool_text
from sumproof.agent.eval import grade, receipt_tasks


def test_calculate_is_exact_and_safe():
    assert tools.calculate("(1577 / 32765) * 100") == pytest.approx(4.813063, abs=1e-6)
    assert tools.calculate("1,577 + $2,000") == 3577.0  # commas and $ are ignored
    assert tools.calculate("round(24873 - 16135, 0)") == 8738.0
    assert tools.calculate("-(3) ** 2") == -9.0
    for bad in ("__import__('os').system('dir')", "open('x')", "x + 1", "2 ** 1000", "[1, 2]"):
        with pytest.raises((ValueError, SyntaxError)):
            tools.calculate(bad)


def test_receipt_tools_match_the_saved_readings():
    review = tools.list_receipts("needs review")
    assert len(review) == 10 and all(r["status"] == "needs review" for r in review)
    assert len(tools.list_receipts("all")) == 100
    r7 = tools.get_receipt(7)
    assert r7["amounts"]["total"] == 111000.0 and r7["fields_as_printed"]["total"] == "111,000" and r7["all_checks_pass"] is True
    assert {r["id"]: r["total"] for r in review}[0] == 60000.0  # "60.000" as printed means sixty thousand
    with pytest.raises(ValueError):
        tools.get_receipt(1000)


def test_snippet_centres_on_the_query():
    text = "Table of Contents " + "filler " * 200 + "Purchases of property, plant and equipment (1,577)"
    s = tools.snippet(text, "3M capital expenditure purchases of property")
    assert "Purchases of property" in s and s.startswith("…")


def test_mcp_server_exposes_and_runs_the_tools():
    from mcp import Client

    from sumproof.agent.server import server

    async def go():
        async with Client(server) as c:
            names = {t.name for t in (await c.list_tools()).tools}
            calc = await c.call_tool("calculate", {"expression": "8738 / 1000"})
            rec = await c.call_tool("get_receipt", {"receipt_id": 7})
            review = await c.call_tool("list_receipts", {"status": "needs review"})
            bad = await c.call_tool("get_receipt", {"receipt_id": 1000})
            # What the model sees: the same text the agent passes back after each tool call.
            return names, *(json.loads(tool_text(r)) for r in (calc, rec, review)), tool_text(bad)

    names, calc, rec, review, bad = asyncio.run(go())
    assert names == {"search_filings", "read_page", "calculate", "list_receipts", "get_receipt"}
    assert calc["result"] == 8.738
    assert rec["status"] == "accepted"
    assert [r["id"] for r in review][:2] == [0, 12]  # list results are unwrapped from {"result": [...]}
    assert bad.startswith("ERROR") and "no receipt 1000" in bad  # errors reach the model as text it can act on


def test_grading_and_task_set():
    tasks = {t["id"]: t for t in receipt_tasks()}
    assert len(tasks) == 22 and tasks["r_count_review"]["expected"] == 10
    assert grade(tasks["r_count_review"], "10 receipts need review.")
    assert not grade(tasks["r_count_review"], "12 receipts need review.")
    assert grade({"kind": "yesno", "expected": False}, "No, the subtotal does not add up.")
    assert grade({"kind": "ids", "expected": [0, 12]}, "Receipts 0 and 12 need review.")
    assert not grade({"kind": "ids", "expected": [0, 12]}, "Receipt 12 needs review.")
    ids = [0, 12, 14, 31, 33, 48, 61, 63, 70, 99]  # a real agent answer the first grader rejected
    assert grade({"kind": "ids", "expected": ids}, "Receipts needing review: 0, 12, 14, 31, 33, 48, 61, 63, 70, 99.")
    assert grade({"kind": "ids", "expected": [12]}, "Receipt 12 has a total of 1,234.")  # 1,234 is not ids 1 and 234
    assert grade({"kind": "reference", "expected": "$1577.00"}, "3M's FY2018 capex was $1,577 million.\nSource: 3M 2018 10K, page 60")
