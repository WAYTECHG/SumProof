import json

from sumproof.receipts.amounts import parse_amount
from sumproof.receipts.consistency import check, rerank
from sumproof.receipts.metrics import Scores, exact_match
from sumproof.receipts.schema import Item, Receipt, from_cord, parse_model_output

# Row 0 of the CORD-v2 test split (trimmed to gt_parse).
CORD_ROW0 = {
    "gt_parse": {
        "menu": {"nm": "-TICKET CP", "num": "901016", "cnt": "2", "price": "60.000", "itemsubtotal": "60.000"},
        "sub_total": {"subtotal_price": "60.000", "discount_price": "-60.000", "tax_price": "5.455"},
        "total": {"total_price": "60.000", "creditcardprice": "60.000", "menuqty_cnt": "2.00"},
    }
}
# Row 1 of the CORD-v2 test split.
CORD_ROW1 = {
    "gt_parse": {
        "menu": [
            {"nm": "J.STB PROMO", "price": "17500"},
            {"nm": "Y.B.BAT", "price": "46000"},
            {"nm": "Y.BASO PROM", "price": "27500"},
        ],
        "total": {"total_price": "91000", "cashprice": "91000"},
    }
}


def test_parse_amount_formats():
    assert parse_amount("60.000") == 60000
    assert parse_amount("5.455") == 5455
    assert parse_amount("-60.000") == -60000
    assert parse_amount("1,234.50") == 1234.5
    assert parse_amount("Rp 17.500") == 17500
    assert parse_amount("2.00") == 2.0
    assert parse_amount("RM12.9") == 12.9
    assert parse_amount("abc") is None
    assert parse_amount(None) is None


def test_from_cord_single_and_list_menu():
    r0 = from_cord(CORD_ROW0)
    assert len(r0.items) == 1 and r0.items[0].amount == "60.000" and r0.items[0].qty == "2"
    assert r0.card == "60.000" and r0.discount == "-60.000"
    r1 = from_cord(json.dumps(CORD_ROW1))
    assert [i.name for i in r1.items] == ["J.STB PROMO", "Y.B.BAT", "Y.BASO PROM"]
    assert r1.total == "91000" and r1.cash == "91000"


def test_gold_receipt_is_consistent():
    rep = check(from_cord(CORD_ROW1))
    assert rep.consistent and rep.applicable >= 1


def test_misread_digit_is_caught():
    r = from_cord(CORD_ROW1)
    r.items[1].amount = "16000"  # OCR-style misread of 46000
    rep = check(r)
    assert not rep.consistent
    assert any(c.name == "items_sum_total" and not c.passed for c in rep.checks)


def test_cash_change_rule():
    r = Receipt(items=[Item(name="A", amount="10.000")], total="10.000", cash="50.000", change="40.000")
    assert check(r).consistent
    r.change = "41.000"
    assert not check(r).consistent


def test_rerank_prefers_consistent_over_higher_logprob():
    good = from_cord(CORD_ROW1)
    bad = from_cord(CORD_ROW1)
    bad.total = "97000"
    chosen, idx = rerank([(bad, -0.05), (None, -0.01), (good, -0.30)])
    assert idx == 2 and chosen.total == "91000"


def test_rerank_does_not_reward_dropping_fields():
    full = from_cord(CORD_ROW1)
    stripped = Receipt(items=[], total="91000")  # no rule applies -> score 1.0 but 0 checks
    _, idx = rerank([(stripped, -0.01), (full, -0.2)])
    assert idx == 1


def test_parse_model_output_and_metrics():
    gold = from_cord(CORD_ROW1)
    text = "Here is the JSON:\n" + gold.to_target() + "\n"
    pred = parse_model_output(text)
    assert pred is not None and exact_match(pred, gold)
    s = Scores()
    s.add(pred, gold)
    s.add(None, gold)
    d = s.as_dict()
    assert d["valid_json_rate"] == 0.5 and d["total_accuracy"] == 0.5
    assert 0 < d["field_f1"] < 1


def test_parser_accepts_unquoted_numbers_and_blank_fields():
    text = '```json\n{"items":[{"name":"Y.B.BAT","qty":1,"unit_price":46000,"amount":46000.0}],' \
           '"total":91000,"card":"","tax":0}\n```'
    r = parse_model_output(text)
    assert r is not None
    assert r.items[0].qty == "1" and r.items[0].amount == "46000"
    assert r.total == "91000" and r.card is None
    assert r.tax == "0"  # an invented zero is kept, so it still counts as an error
