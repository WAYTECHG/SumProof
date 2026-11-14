"""Parse money strings printed on receipts into numbers.

Receipts mix formats: "60.000" (Indonesian thousands), "1,234.50" (English),
"Rp 17.500", "-60.000", "5.455". We decide per string whether a separator is a
thousands mark or a decimal point by the length of the last digit group.
"""

from __future__ import annotations

import re

_NUM = re.compile(r"[-+]?\d[\d.,\s]*")


def parse_amount(text: str | None) -> float | None:
    """Return the numeric value of a printed amount, or None if there is none.

    Rules:
    - a trailing group of exactly 3 digits after "." or "," is a thousands group;
    - a trailing group of 1-2 digits is a decimal part;
    - all other separators are thousands marks.
    """
    if text is None:
        return None
    s = str(text).strip()
    if not s:
        return None
    negative = s.startswith("-") or s.startswith("(") or s.endswith("-")
    m = _NUM.search(s.replace(" ", ""))
    if not m:
        return None
    body = m.group(0).lstrip("+-")
    body = body.rstrip(".,")
    if not body:
        return None

    last_sep = max(body.rfind("."), body.rfind(","))
    if last_sep == -1:
        value = float(body)
    else:
        tail = body[last_sep + 1 :]
        head = re.sub(r"[.,]", "", body[:last_sep])
        if len(tail) == 3 or len(tail) == 0:
            value = float(head + tail) if (head + tail) else 0.0
        else:  # 1-2 digits: decimal part
            value = float(f"{head or '0'}.{tail}")
    return -value if negative else value


def amounts_equal(a: float | None, b: float | None, rel_tol: float = 0.01, abs_tol: float = 1.0) -> bool:
    """Equality with tolerance for rounding on printed receipts."""
    if a is None or b is None:
        return False
    return abs(a - b) <= max(abs_tol, rel_tol * max(abs(a), abs(b)))
