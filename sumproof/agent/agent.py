"""A local agent: Qwen3.5-4B in Ollama decides which SumProof MCP tools to call.

  ollama pull qwen3.5:4b
  python -m sumproof.agent.agent "Which receipts need review, and what do their totals add up to?"

The agent talks to the MCP server over stdio (a real MCP connection, the same way Claude Desktop or an
IDE would launch it), lists its tools, and loops: the model either calls tools or gives the answer.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

MODEL = "qwen3.5:4b"
MAX_STEPS = 8
TOOL_CHARS = 7000  # longest tool result passed back to the model (a full filing page is up to 6,000)
PROJECT = Path(__file__).resolve().parents[2]

SYSTEM = (
    "You are SumProof's assistant for receipts and SEC filings. Use the tools to look things up; never guess "
    "numbers. For filing questions: search_filings with the company and fiscal year, read_page the most relevant "
    "page, then answer from it. Use calculate for every arithmetic step (ratios, averages, growth, sums). "
    "Give the answer first, in one or two sentences with numbers and units. For filing answers, end with "
    "'Source: <filing>, page <n>'. If the tools do not give you the answer, say so."
)


def server_params():
    from mcp import StdioServerParameters

    return StdioServerParameters(command=sys.executable, args=["-m", "sumproof.agent.server"], cwd=str(PROJECT))


def ollama_tools(listed, exclude: set[str] = frozenset()) -> list[dict]:
    """MCP tool definitions -> the function-calling format Ollama expects."""
    return [
        {"type": "function", "function": {"name": t.name, "description": t.description or "", "parameters": t.input_schema}}
        for t in listed.tools
        if t.name not in exclude
    ]


def tool_text(result) -> str:
    """A tool result as text for the model (structured content when the tool returns data)."""
    if getattr(result, "is_error", False):
        return "ERROR: " + " ".join(getattr(c, "text", "") for c in result.content)
    if result.structured_content is not None:
        data = result.structured_content
        data = data.get("result", data) if isinstance(data, dict) and set(data) == {"result"} else data
        text = json.dumps(data, ensure_ascii=False)
    else:
        text = " ".join(getattr(c, "text", "") for c in result.content)
    return text[:TOOL_CHARS]


async def ask(client, question: str, model: str = MODEL, exclude: set[str] = frozenset(), think: bool = False) -> dict:
    """Run one question to a final answer. Returns the answer and every tool call made."""
    from ollama import AsyncClient

    llm = AsyncClient()
    tools = ollama_tools(await client.list_tools(), exclude)
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
    calls, t0 = [], time.perf_counter()
    for _ in range(MAX_STEPS):
        reply = (await llm.chat(model=model, messages=messages, tools=tools, think=think, options={"temperature": 0})).message
        messages.append(reply)
        if not reply.tool_calls:
            return {"answer": (reply.content or "").strip(), "calls": calls, "seconds": round(time.perf_counter() - t0, 1)}
        for tc in reply.tool_calls:
            name, args = tc.function.name, dict(tc.function.arguments or {})
            if name in exclude:
                text = f"ERROR: tool {name} is not available"
            else:
                try:
                    text = tool_text(await client.call_tool(name, args))
                except Exception as e:  # a bad argument should not end the run; the model can retry
                    text = f"ERROR: {e}"
            calls.append({"tool": name, "args": args, "result": text[:300]})
            messages.append({"role": "tool", "tool_name": name, "content": text})
    return {"answer": "", "calls": calls, "seconds": round(time.perf_counter() - t0, 1), "stopped": "max steps"}


async def _main(question: str, model: str, think: bool) -> None:
    from mcp import Client

    async with Client(server_params(), read_timeout_seconds=300) as client:
        out = await ask(client, question, model=model, think=think)
    for c in out["calls"]:
        print(f"  -> {c['tool']}({json.dumps(c['args'], ensure_ascii=False)})")
    print(f"\n{out['answer']}\n\n({len(out['calls'])} tool calls, {out['seconds']} s)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--think", action="store_true", help="let the model reason before each step (slower)")
    a = ap.parse_args()
    asyncio.run(_main(a.question, a.model, a.think))


if __name__ == "__main__":
    main()
