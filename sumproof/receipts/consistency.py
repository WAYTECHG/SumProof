"""Accounting-consistency checks: the project's main method contribution.

A receipt obeys arithmetic rules (items add up to the subtotal, subtotal plus
tax and service minus discount gives the total, cash minus change equals the
total). A vision-language model has no idea about these rules when it reads
digits off a blurry photo. We use them in three ways:

1. Reranking (Consistency-Guided Reranking, CGR): sample several candidate
   extractions and keep the one that satisfies the most rules, using the
   model's own log-probability only to break ties.
2. Error flagging: an extraction that breaks a rule is routed to a human, which
   is how finance operations teams already work (maker-checker).
3. Pseudo-label filtering (stretch): on unlabelled receipts, keep only fully
   consistent outputs as extra training data.

Each rule only fires when every field it needs is present, so a receipt that
prints no subtotal is not punished for it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .amounts import amounts_equal, parse_amount
from .schema import Receipt


@dataclass
class Check:
    name: str
    passed: bool
    expected: float
    found: float


@dataclass
class ConsistencyReport:
    checks: list[Check] = field(default_factory=list)

    @property
    def applicable(self) -> int:
        return len(self.checks)

    @property
    def passed(self) -> int:
        return sum(c.passed for c in self.checks)

    @property
    def score(self) -> float:
        """Share of applicable rules satisfied; 1.0 when no rule applies."""
        return self.passed / self.applicable if self.checks else 1.0

    @property
    def consistent(self) -> bool:
        return all(c.passed for c in self.checks)


def _line_amount(item) -> float | None:
    amount = parse_amount(item.amount)
    if amount is not None:
        return amount
    unit, qty = parse_amount(item.unit_price), parse_amount(item.qty)
    if unit is not None and qty is not None:
        return unit * qty
    return None


def check(receipt: Receipt) -> ConsistencyReport:
    r = ConsistencyReport()
    subtotal = parse_amount(receipt.subtotal)
    total = parse_amount(receipt.total)
    discount = parse_amount(receipt.discount)
    tax = parse_amount(receipt.tax) or 0.0
    service = parse_amount(receipt.service) or 0.0
    cash = parse_amount(receipt.cash)
    change = parse_amount(receipt.change)
    card = parse_amount(receipt.card)

    # 1. Each line: qty x unit price = line amount.
    for i, item in enumerate(receipt.items):
        unit, qty, amount = parse_amount(item.unit_price), parse_amount(item.qty), parse_amount(item.amount)
        if None not in (unit, qty, amount):
            r.checks.append(Check(f"line_{i}", amounts_equal(unit * qty, amount), unit * qty, amount))

    # 2. Items add up to the subtotal (or to the total when no subtotal is printed).
    lines = [_line_amount(i) for i in receipt.items]
    if lines and all(v is not None for v in lines):
        items_sum = sum(lines)
        target_name, target = ("subtotal", subtotal) if subtotal is not None else ("total", total)
        # When only a total is printed, tax/service may sit inside it; only check the
        # no-subtotal case if there is no tax or service line either.
        if target is not None and (target_name == "subtotal" or (tax == 0 and service == 0 and discount is None)):
            r.checks.append(Check(f"items_sum_{target_name}", amounts_equal(items_sum, target), items_sum, target))

    # 3. Subtotal - discount + tax + service = total.
    if subtotal is not None and total is not None and (tax or service or discount is not None):
        disc = abs(discount) if discount is not None else 0.0
        # Many receipts print tax that is already inside the subtotal (inclusive VAT);
        # accept either the exclusive or the inclusive form.
        exclusive = subtotal - disc + tax + service
        inclusive = subtotal - disc + service
        ok = amounts_equal(exclusive, total) or amounts_equal(inclusive, total)
        r.checks.append(Check("summary_total", ok, exclusive, total))

    # 4. Cash - change = total.
    if cash is not None and change is not None and total is not None:
        r.checks.append(Check("cash_change", amounts_equal(cash - abs(change), total), cash - abs(change), total))

    # 5. Card charge = total.
    if card is not None and total is not None:
        r.checks.append(Check("card_total", amounts_equal(card, total), total, card))

    return r


def rerank(candidates: list[tuple[Receipt | None, float]]) -> tuple[Receipt | None, int]:
    """Consistency-Guided Reranking.

    candidates: (parsed receipt or None if invalid JSON, mean token log-prob).
    Returns the chosen receipt and its index. Ordering key:
    valid JSON > consistency score > number of rules checked > log-prob.
    Preferring more applicable rules stops the reranker from rewarding outputs
    that drop fields to dodge the checks.
    """
    best_idx, best_key = 0, None
    for idx, (rec, logprob) in enumerate(candidates):
        if rec is None:
            key = (0, 0.0, 0, logprob)
        else:
            rep = check(rec)
            key = (1, rep.score, rep.applicable, logprob)
        if best_key is None or key > best_key:
            best_idx, best_key = idx, key
    return candidates[best_idx][0], best_idx
