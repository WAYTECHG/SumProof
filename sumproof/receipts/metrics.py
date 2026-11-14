"""Extraction metrics.

- field F1: precision/recall over (field, normalised value) pairs, counting
  repeated item fields as a multiset (the usual CORD/Donut-style field F1);
- total accuracy: the printed total read correctly (what finance teams care
  about most);
- valid JSON rate.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from .amounts import parse_amount
from .schema import SUMMARY_FIELDS, Receipt

_MONEY_FIELDS = set(SUMMARY_FIELDS) | {"items.unit_price", "items.amount", "items.qty"}


def _norm(field: str, value: str) -> str:
    if field in _MONEY_FIELDS:
        v = parse_amount(value)
        if v is not None:
            return f"{abs(v):.2f}"
    return re.sub(r"\s+", " ", value).strip().lower()


def flatten(r: Receipt | None) -> Counter:
    out: Counter = Counter()
    if r is None:
        return out
    for item in r.items:
        for k, v in item.model_dump().items():
            if v:
                out[(f"items.{k}", _norm(f"items.{k}", v))] += 1
    for k in SUMMARY_FIELDS:
        v = getattr(r, k)
        if v:
            out[(k, _norm(k, v))] += 1
    return out


@dataclass
class Scores:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    total_correct: int = 0
    total_n: int = 0
    valid: int = 0
    n: int = 0

    def add(self, pred: Receipt | None, gold: Receipt) -> None:
        p, g = flatten(pred), flatten(gold)
        overlap = sum((p & g).values())
        self.tp += overlap
        self.fp += sum(p.values()) - overlap
        self.fn += sum(g.values()) - overlap
        self.n += 1
        self.valid += pred is not None
        if gold.total:
            self.total_n += 1
            if pred is not None and pred.total and _norm("total", pred.total) == _norm("total", gold.total):
                self.total_correct += 1

    def as_dict(self) -> dict:
        prec = self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0
        rec = self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        return {
            "field_f1": round(f1, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "total_accuracy": round(self.total_correct / self.total_n, 4) if self.total_n else None,
            "valid_json_rate": round(self.valid / self.n, 4) if self.n else None,
            "n": self.n,
        }


def exact_match(pred: Receipt | None, gold: Receipt) -> bool:
    return flatten(pred) == flatten(gold)
