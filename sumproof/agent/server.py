"""SumProof as an MCP server: any MCP client (this repo's Ollama agent, Claude Desktop, IDEs) can use
the receipt checker and the filing search as tools.

  python -m sumproof.agent.server        # stdio transport; clients launch it as a subprocess

Nothing here may print to stdout: on the stdio transport, stdout carries the protocol.
"""

from __future__ import annotations

import functools

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import tools


def expected_errors(fn):
    """Bad input (an unknown id, an invalid calculation) reaches the model as a message it can act on.

    MCP hides the text of any other exception, which is right for crashes but leaves the model blind
    to a simple mistake such as asking for receipt 1000.
    """

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (ValueError, SyntaxError, ZeroDivisionError) as e:
            raise ToolError(str(e) or type(e).__name__) from e

    return wrapper


server = MCPServer(
    name="sumproof",
    instructions=(
        "Tools over real data: 100 receipts read by a fine-tuned vision-language model, checked by accounting rules, "
        "and 12,013 pages of 84 SEC filings (FinanceBench). Search filings, then read the page you need. "
        "Use calculate for every arithmetic step instead of computing in your head."
    ),
)


@server.tool()
@expected_errors
def search_filings(query: str, top_k: int = 5) -> list[dict]:
    """Search 12,013 pages of 84 SEC filings (10-K, 10-Q, 8-K, earnings) from 32 companies.

    Name the company and fiscal year in the query (e.g. "3M FY2018 capital expenditure cash flow statement"):
    the search then looks only in that company's filings for that year. Returns page ids with the filing,
    page number and a snippet; call read_page to read a full page before answering from it.
    """
    return tools.filings().search(query, top_k)


@server.tool()
@expected_errors
def read_page(page_id: int) -> dict:
    """Read the full text of one filing page (a page_id from search_filings)."""
    return tools.filings().read(page_id)


@server.tool()
@expected_errors
def calculate(expression: str) -> dict:
    """Exact arithmetic: + - * / ** ( ) and round, abs, min, max, sqrt. Example: (1577 / 32765) * 100.

    Always use this for ratios, averages, growth rates and sums instead of calculating mentally.
    """
    return {"expression": expression, "result": tools.calculate(expression)}


@server.tool()
@expected_errors
def list_receipts(status: str = "all") -> list[dict]:
    """List the 100 test receipts with id, review status, total and number of items.

    status: "all", "needs review" (a receipt whose numbers do not add up) or "accepted".
    """
    return tools.list_receipts(status)


@server.tool()
@expected_errors
def get_receipt(receipt_id: int) -> dict:
    """One receipt as read by the fine-tuned model: every field, each accounting rule's result, and its status."""
    return tools.get_receipt(receipt_id)


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
