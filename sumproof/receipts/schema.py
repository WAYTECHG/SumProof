"""The receipt JSON the model must produce, and conversion from CORD-v2 labels.

We use a compact, flat schema so the model spends few tokens and the accounting
checks in consistency.py can read it directly. Values stay as printed strings
(the model copies text); numbers are parsed only for checks and metrics.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, field_validator

SUMMARY_FIELDS = ("subtotal", "discount", "service", "tax", "total", "cash", "change", "card")


def _to_text(v: Any) -> str | None:
    """Accept numbers the model writes unquoted (17500 -> "17500"); "" means not printed."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v).is_integer() else str(v)
    if isinstance(v, str):
        return v.strip() or None
    return None


class Item(BaseModel):
    _coerce = field_validator("name", "qty", "unit_price", "amount", mode="before")(lambda cls, v: _to_text(v))

    name: str | None = None
    qty: str | None = None
    unit_price: str | None = None
    amount: str | None = None


class Receipt(BaseModel):
    _coerce = field_validator(*SUMMARY_FIELDS, mode="before")(lambda cls, v: _to_text(v))

    items: list[Item] = Field(default_factory=list)
    subtotal: str | None = None
    discount: str | None = None
    service: str | None = None
    tax: str | None = None
    total: str | None = None
    cash: str | None = None
    change: str | None = None
    card: str | None = None

    def to_target(self) -> str:
        """Canonical training target: no nulls, stable key order."""
        return json.dumps(self.model_dump(exclude_none=True), ensure_ascii=False, separators=(",", ":"))


def _first(d: Any, *keys: str) -> str | None:
    if not isinstance(d, dict):
        return None
    for k in keys:
        v = d.get(k)
        if isinstance(v, list):
            v = v[0] if v else None
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _as_list(x: Any) -> list[dict]:
    if x is None:
        return []
    if isinstance(x, dict):
        return [x]
    return [i for i in x if isinstance(i, dict)]


def from_cord(ground_truth: str | dict) -> Receipt:
    """Convert a CORD-v2 `ground_truth` string into our Receipt schema.

    CORD notes: menu.price is the printed line amount, menu.unitprice the unit
    price, menu.itemsubtotal a line total some shops print separately.
    Card payments appear as creditcardprice or emoneyprice.
    """
    gt = json.loads(ground_truth) if isinstance(ground_truth, str) else ground_truth
    parse = gt.get("gt_parse", gt)

    items = [
        Item(
            name=_first(m, "nm"),
            qty=_first(m, "cnt"),
            unit_price=_first(m, "unitprice"),
            amount=_first(m, "itemsubtotal", "price"),
        )
        for m in _as_list(parse.get("menu"))
    ]
    items = [i for i in items if any(v is not None for v in i.model_dump().values())]

    sub = parse.get("sub_total") if isinstance(parse.get("sub_total"), dict) else {}
    tot = parse.get("total") if isinstance(parse.get("total"), dict) else {}

    return Receipt(
        items=items,
        subtotal=_first(sub, "subtotal_price"),
        discount=_first(sub, "discount_price"),
        service=_first(sub, "service_price", "othersvc_price"),
        tax=_first(sub, "tax_price"),
        total=_first(tot, "total_price"),
        cash=_first(tot, "cashprice"),
        change=_first(tot, "changeprice"),
        card=_first(tot, "creditcardprice", "emoneyprice"),
    )


def parse_model_output(text: str) -> Receipt | None:
    """Pull the first JSON object out of model output; None if it is not valid."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return Receipt.model_validate(json.loads(text[start : end + 1]))
    except (json.JSONDecodeError, ValueError):
        return None
