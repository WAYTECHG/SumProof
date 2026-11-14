// TypeScript port of sumproof/receipts/{amounts,consistency}.py.
// Kept rule-for-rule identical so the checker gives the same verdict in the browser
// (verified against the Python results on all 100 test receipts: web/scripts/parity.ts).

export type Item = { name?: string; qty?: string; unit_price?: string; amount?: string };
export type Receipt = {
  items?: Item[];
  subtotal?: string;
  discount?: string;
  service?: string;
  tax?: string;
  total?: string;
  cash?: string;
  change?: string;
  card?: string;
};
export type Check = { name: string; passed: boolean; expected: number; found: number };

export const SUMMARY_FIELDS = ["subtotal", "discount", "service", "tax", "total", "cash", "change", "card"] as const;
export type SummaryField = (typeof SUMMARY_FIELDS)[number];

const NUM = /[-+]?\d[\d.,\s]*/;

/** "60.000" -> 60000, "1,234.50" -> 1234.5, "Rp 17.500" -> 17500, "-60.000" -> -60000 */
export function parseAmount(text: string | undefined | null): number | null {
  if (text === undefined || text === null) return null;
  const s = String(text).trim();
  if (!s) return null;
  const negative = s.startsWith("-") || s.startsWith("(") || s.endsWith("-");
  const m = s.replace(/ /g, "").match(NUM);
  if (!m) return null;
  const body = m[0].replace(/^[+-]+/, "").replace(/[.,]+$/, "");
  if (!body) return null;
  const lastSep = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  let value: number;
  if (lastSep === -1) {
    value = parseFloat(body);
  } else {
    const tail = body.slice(lastSep + 1);
    const head = body.slice(0, lastSep).replace(/[.,]/g, "");
    if (tail.length === 3 || tail.length === 0) value = parseFloat(head + tail || "0");
    else value = parseFloat(`${head || "0"}.${tail}`);
  }
  if (Number.isNaN(value)) return null;
  return negative ? -value : value;
}

export function amountsEqual(a: number | null, b: number | null, relTol = 0.01, absTol = 1.0): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
}

function lineAmount(item: Item): number | null {
  const amount = parseAmount(item.amount);
  if (amount !== null) return amount;
  const unit = parseAmount(item.unit_price);
  const qty = parseAmount(item.qty);
  return unit !== null && qty !== null ? unit * qty : null;
}

/** The five accounting rules. Each rule only applies when every field it needs is present. */
export function check(r: Receipt): Check[] {
  const checks: Check[] = [];
  const items = r.items ?? [];
  const subtotal = parseAmount(r.subtotal);
  const total = parseAmount(r.total);
  const discount = parseAmount(r.discount);
  const tax = parseAmount(r.tax) || 0;
  const service = parseAmount(r.service) || 0;
  const cash = parseAmount(r.cash);
  const change = parseAmount(r.change);
  const card = parseAmount(r.card);

  // 1. qty x unit price = line amount
  items.forEach((it, i) => {
    const unit = parseAmount(it.unit_price);
    const qty = parseAmount(it.qty);
    const amount = parseAmount(it.amount);
    if (unit !== null && qty !== null && amount !== null) {
      checks.push({ name: `line_${i}`, passed: amountsEqual(unit * qty, amount), expected: unit * qty, found: amount });
    }
  });

  // 2. items add up to the subtotal (or to the total when no subtotal is printed)
  const lines = items.map(lineAmount);
  if (lines.length && lines.every((v) => v !== null)) {
    const itemsSum = (lines as number[]).reduce((a, b) => a + b, 0);
    const [targetName, target] = subtotal !== null ? ["subtotal", subtotal] : ["total", total];
    if (target !== null && (targetName === "subtotal" || (tax === 0 && service === 0 && discount === null))) {
      checks.push({ name: `items_sum_${targetName}`, passed: amountsEqual(itemsSum, target), expected: itemsSum, found: target });
    }
  }

  // 3. subtotal - discount + tax + service = total (tax may already be inside the subtotal)
  if (subtotal !== null && total !== null && (tax || service || discount !== null)) {
    const disc = discount !== null ? Math.abs(discount) : 0;
    const exclusive = subtotal - disc + tax + service;
    const inclusive = subtotal - disc + service;
    checks.push({
      name: "summary_total",
      passed: amountsEqual(exclusive, total) || amountsEqual(inclusive, total),
      expected: exclusive,
      found: total,
    });
  }

  // 4. cash - change = total
  if (cash !== null && change !== null && total !== null) {
    checks.push({ name: "cash_change", passed: amountsEqual(cash - Math.abs(change), total), expected: cash - Math.abs(change), found: total });
  }

  // 5. card charge = total
  if (card !== null && total !== null) {
    checks.push({ name: "card_total", passed: amountsEqual(card, total), expected: total, found: card });
  }
  return checks;
}

/** Human-readable description of a rule, for the checklist. */
export function describe(c: Check): string {
  if (c.name.startsWith("line_")) return `Line ${Number(c.name.slice(5)) + 1}: qty × unit price = amount`;
  switch (c.name) {
    case "items_sum_subtotal":
      return "Items add up to the subtotal";
    case "items_sum_total":
      return "Items add up to the total";
    case "summary_total":
      return "Subtotal − discount + tax + service = total";
    case "cash_change":
      return "Cash − change = total";
    case "card_total":
      return "Card charge = total";
    default:
      return c.name;
  }
}

export function formatAmount(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
