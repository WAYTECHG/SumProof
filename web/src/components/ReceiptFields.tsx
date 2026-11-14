"use client";

import { Check as CheckIcon, Plus, Trash2, X } from "lucide-react";
import {
  amountsEqual,
  describe,
  formatAmount,
  parseAmount,
  SUMMARY_FIELDS,
  type Check,
  type Item,
  type Receipt,
  type SummaryField,
} from "@/lib/consistency";

/** Shared receipt form and rule list, used by the scan page (users) and the model view (evaluation). */

export const FIELD_LABEL: Record<SummaryField, string> = {
  subtotal: "Subtotal",
  discount: "Discount",
  service: "Service charge",
  tax: "Tax",
  total: "Total",
  cash: "Cash paid",
  change: "Change",
  card: "Card charge",
};
const ITEM_COLS: { key: keyof Item; label: string; money: boolean }[] = [
  { key: "name", label: "Item", money: false },
  { key: "qty", label: "Qty", money: true },
  { key: "unit_price", label: "Unit price", money: true },
  { key: "amount", label: "Amount", money: true },
];

export const cloneReceipt = (r: Receipt | null | undefined): Receipt =>
  JSON.parse(JSON.stringify(r ?? { items: [] }));

function norm(money: boolean, v: string | undefined): string {
  if (!v) return "";
  if (money) {
    const p = parseAmount(v);
    if (p !== null) return Math.abs(p).toFixed(2);
  }
  return v.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Editable items table and summary fields. `update` applies a mutation to a copy of the receipt.
 * When `gold` is given and `compare` is on, cells that differ from the human label are marked.
 */
export function ReceiptFields({
  value,
  update,
  gold,
  compare = false,
}: {
  value: Receipt;
  update: (fn: (r: Receipt) => void) => void;
  gold?: Receipt;
  compare?: boolean;
}) {
  const items = value.items ?? [];
  const goldItems = gold?.items ?? [];
  const marking = compare && !!gold;

  return (
    <>
      <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-solid">
        <table className="w-full min-w-[520px] text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              {ITEM_COLS.map((c) => (
                <th
                  key={c.key}
                  className={`px-2.5 py-2 font-medium ${c.key === "name" ? "w-[42%]" : ""}`}
                >
                  {c.label}
                </th>
              ))}
              <th className="w-10 px-2 py-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {ITEM_COLS.map((c) => {
                  const v = it[c.key] ?? "";
                  const g = goldItems[i]?.[c.key];
                  const differs =
                    marking && norm(c.money, v) !== norm(c.money, g);
                  return (
                    <td key={c.key} className="px-1.5 py-1.5">
                      <input
                        aria-label={`${c.label}, line ${i + 1}`}
                        value={v}
                        title={
                          differs ? `Human label: ${g || "empty"}` : undefined
                        }
                        onChange={(e) =>
                          update((r) => {
                            (r.items ??= [])[i] = {
                              ...r.items![i],
                              [c.key]: e.target.value,
                            };
                          })
                        }
                        className={`tabular h-8 w-full rounded-md border bg-transparent px-2 text-[13.5px] text-ink focus:border-accent focus:outline-none ${
                          differs
                            ? "border-warn/60 bg-warn-soft/40"
                            : "border-transparent hover:border-line"
                        }`}
                      />
                    </td>
                  );
                })}
                <td className="px-1 py-1.5 text-center">
                  <button
                    type="button"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => update((r) => void r.items?.splice(i, 1))}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-warn-soft hover:text-warn"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-center text-[13px] text-muted"
                >
                  No items found. Add them with the button below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() =>
          update(
            (r) =>
              void (r.items ??= []).push({
                name: "",
                qty: "",
                unit_price: "",
                amount: "",
              }),
          )
        }
        className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        <Plus size={15} /> Add line
      </button>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SUMMARY_FIELDS.map((f) => {
          const v = value[f] ?? "";
          const g = gold?.[f];
          const differs = marking && norm(true, v) !== norm(true, g);
          return (
            <label
              key={f}
              htmlFor={`field-${f}`}
              className="flex min-w-0 flex-col gap-1"
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                {FIELD_LABEL[f]}
                {differs && (
                  <span
                    className="text-warn"
                    title={`Human label: ${g || "not printed"}`}
                  >
                    ● differs
                  </span>
                )}
              </span>
              <input
                id={`field-${f}`}
                value={v}
                onChange={(e) =>
                  update((r) => {
                    if (e.target.value.trim()) r[f] = e.target.value;
                    else delete r[f];
                  })
                }
                placeholder="not printed"
                className={`tabular h-9 w-full rounded-lg border bg-surface-solid px-2.5 text-[13.5px] text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none ${
                  differs ? "border-warn/60" : "border-line"
                }`}
              />
            </label>
          );
        })}
      </div>
    </>
  );
}

/** One row per accounting rule: what the receipt should say, and what it says. */
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((c) => {
        // The total rule also passes when tax is already inside the subtotal; show the form that matched.
        const taxInside =
          c.name === "summary_total" &&
          c.passed &&
          !amountsEqual(c.expected, c.found);
        const expected = taxInside ? c.found : c.expected;
        return (
          <li
            key={c.name}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 ${
              c.passed
                ? "border-line bg-surface-solid"
                : "border-warn/50 bg-warn-soft/50"
            }`}
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${c.passed ? "bg-good-soft text-good" : "bg-warn text-white"}`}
            >
              {c.passed ? (
                <CheckIcon size={14} strokeWidth={3} />
              ) : (
                <X size={14} strokeWidth={3} />
              )}
            </span>
            <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">
              {taxInside
                ? "Subtotal − discount + service = total (tax already included)"
                : describe(c)}
            </span>
            <span className="tabular text-[13px] text-muted">
              expected{" "}
              <span className="font-semibold text-ink">
                {formatAmount(expected)}
              </span>{" "}
              · found{" "}
              <span
                className={`font-semibold ${c.passed ? "text-ink" : "text-warn"}`}
              >
                {formatAmount(c.found)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
