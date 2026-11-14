"use client";

/* eslint-disable @next/next/no-img-element */
import { Check as CheckIcon, ChevronLeft, ChevronRight, CircleAlert, Plus, RotateCcw, Send, Sparkles, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { check, describe, formatAmount, parseAmount, SUMMARY_FIELDS, type Item, type Receipt, type SummaryField } from "@/lib/consistency";
import { useDecisions } from "@/lib/decisions";
import type { ReceiptRecord } from "@/lib/types";
import { Banner, Button, Card, Pill, Segmented } from "./ui";

type Source = "model" | "zeroshot" | "label";
const SOURCES: { value: Source; label: string }[] = [
  { value: "model", label: "Fine-tuned model" },
  { value: "zeroshot", label: "Before fine-tuning" },
  { value: "label", label: "Human label" },
];
const FIELD_LABEL: Record<SummaryField, string> = {
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

const clone = (r: Receipt | null): Receipt => JSON.parse(JSON.stringify(r ?? { items: [] }));
function norm(money: boolean, v: string | undefined): string {
  if (!v) return "";
  if (money) {
    const p = parseAmount(v);
    if (p !== null) return Math.abs(p).toFixed(2);
  }
  return v.replace(/\s+/g, " ").trim().toLowerCase();
}

function FieldInput({
  id,
  label,
  value,
  onChange,
  differs,
  labelValue,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  differs: boolean;
  labelValue?: string;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        {label}
        {differs && (
          <span className="text-warn" title={`Human label: ${labelValue || "not printed"}`}>
            ● differs
          </span>
        )}
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="not printed"
        className={`tabular h-9 w-full rounded-lg border bg-surface-solid px-2.5 text-[13.5px] text-ink placeholder:text-muted/60 focus:border-mocha focus:outline-none ${
          differs ? "border-warn/60" : "border-line"
        }`}
      />
    </label>
  );
}

export function ReceiptChecker({ record, prev, next }: { record: ReceiptRecord; prev: number | null; next: number | null }) {
  const { decisions, save } = useDecisions();
  const decision = decisions[record.id];
  const [source, setSource] = useState<Source>("model");
  const [working, setWorking] = useState<Receipt>(() => clone(record.pred));
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const original = (s: Source) => (s === "model" ? record.pred : s === "zeroshot" ? record.zeroshot : record.gold);

  // A saved edit from this browser replaces the model's reading when the page opens.
  useEffect(() => {
    if (decision?.edited && source === "model" && !dirty) setWorking(clone(decision.edited));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);

  const switchSource = (s: Source) => {
    setSource(s);
    setWorking(clone(original(s)));
    setDirty(false);
    setNotice(null);
  };

  const update = (fn: (r: Receipt) => void) => {
    setWorking((w) => {
      const n = clone(w);
      fn(n);
      return n;
    });
    setDirty(true);
    setNotice(null);
  };

  const checks = useMemo(() => check(working), [working]);
  const failed = checks.filter((c) => !c.passed).length;
  const items = working.items ?? [];
  const goldItems = record.gold.items ?? [];
  const compare = showDiff && source !== "label";

  const decide = (status: "approved" | "review") => {
    save(record.id, { status, edited: dirty || decision?.edited ? working : undefined, at: new Date().toISOString() });
    setNotice(status === "approved" ? "Approved. Saved in this browser." : "Sent to review. Saved in this browser.");
  };

  const statusPill = decision ? (
    decision.status === "approved" ? (
      <Pill tone="good">
        <CheckIcon size={14} /> Approved by you
      </Pill>
    ) : (
      <Pill tone="warn">
        <Send size={13} /> Sent to review by you
      </Pill>
    )
  ) : record.flagged ? (
    <Pill tone="warn">
      <CircleAlert size={14} /> Model: needs review
    </Pill>
  ) : (
    <Pill tone="good">
      <CheckIcon size={14} /> Model: auto-accepted
    </Pill>
  );

  return (
    <>
      <Banner
        crumbs={[{ label: "Review queue", href: "/queue/" }, { label: `Receipt #${record.id}` }]}
        title={`Receipt #${record.id}`}
        pills={
          <>
            <Pill tone="dark">
              {checks.length ? `${checks.length - failed} / ${checks.length} rules pass` : "no rule applies"}
            </Pill>
            {statusPill}
            {record.exact && <Pill>matches human label</Pill>}
          </>
        }
        meta="CORD-v2 test receipt · read by Qwen3.5-4B (QLoRA) with best-of-4 and the accounting checker"
        right={
          <>
            {prev !== null ? (
              <Button href={`/receipts/${prev}/`}>
                <ChevronLeft size={16} /> #{prev}
              </Button>
            ) : null}
            {next !== null ? (
              <Button tone="dark" href={`/receipts/${next}/`}>
                #{next} <ChevronRight size={16} />
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card
            title="Receipt photo"
            action={
              <button
                type="button"
                onClick={() => setZoom((z) => !z)}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-solid px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-mocha"
              >
                {zoom ? <ZoomOut size={14} /> : <ZoomIn size={14} />} {zoom ? "Fit" : "Zoom"}
              </button>
            }
          >
            <div className={`overflow-auto rounded-2xl border border-line bg-sunken ${zoom ? "max-h-[720px]" : ""}`}>
              <img
                src={`/data/${record.image}`}
                alt={`Photo of receipt #${record.id} from the CORD-v2 test set`}
                className={zoom ? "w-[160%] max-w-none" : "mx-auto max-h-[620px] w-auto object-contain"}
              />
            </div>
          </Card>

          <Card title="How the checker chose" icon={<Sparkles size={17} />}>
            <p className="mb-3 text-[13px] leading-relaxed text-muted">
              The model wrote one normal reading and four sampled ones. The checker keeps the reading that passes the most accounting rules;
              the model&apos;s confidence only breaks ties.
            </p>
            <ul className="flex flex-col gap-2">
              {record.candidates.map((c, k) => (
                <li
                  key={k}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-[13px] ${c.chosen ? "border-mocha bg-sunken" : "border-line bg-surface-solid"}`}
                >
                  <span className="w-24 shrink-0 font-semibold text-ink">{k === 0 ? "Greedy" : `Sample ${k}`}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                    <div className="mocha-grad h-full rounded-full" style={{ width: `${Math.round((c.consistency ?? 0) * 100)}%` }} />
                  </div>
                  <span className="tabular w-24 shrink-0 text-right text-muted">
                    {c.valid ? `${Math.round((c.consistency ?? 0) * 100)}% rules` : "invalid JSON"}
                  </span>
                  <span className="w-16 shrink-0 text-right">{c.chosen && <Pill tone="mocha">picked</Pill>}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card
            title="Extracted fields"
            action={
              dirty ? (
                <button
                  type="button"
                  onClick={() => switchSource(source)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-mocha-deep hover:underline"
                >
                  <RotateCcw size={14} /> Reset edits
                </button>
              ) : null
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Segmented label="Reading to show" options={SOURCES} value={source} onChange={switchSource} />
              {source !== "label" && (
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="accent-[var(--mocha)]" />
                  Mark differences from the human label
                </label>
              )}
            </div>

            <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface-solid">
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-muted uppercase">
                    {ITEM_COLS.map((c) => (
                      <th key={c.key} className={`px-2.5 py-2 font-semibold ${c.key === "name" ? "w-[42%]" : ""}`}>
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
                        const differs = compare && norm(c.money, v) !== norm(c.money, g);
                        return (
                          <td key={c.key} className="px-1.5 py-1.5">
                            <input
                              aria-label={`${c.label}, line ${i + 1}`}
                              value={v}
                              title={differs ? `Human label: ${g || "empty"}` : undefined}
                              onChange={(e) =>
                                update((r) => {
                                  (r.items ??= [])[i] = { ...r.items![i], [c.key]: e.target.value };
                                })
                              }
                              className={`tabular h-8 w-full rounded-md border bg-transparent px-2 text-[13.5px] text-ink focus:border-mocha focus:outline-none ${
                                differs ? "border-warn/60 bg-warn-soft/40" : "border-transparent hover:border-line"
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
                      <td colSpan={5} className="px-3 py-4 text-center text-[13px] text-muted">
                        No items in this reading.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => update((r) => void (r.items ??= []).push({ name: "", qty: "", unit_price: "", amount: "" }))}
              className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-mocha-deep hover:underline"
            >
              <Plus size={15} /> Add line
            </button>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SUMMARY_FIELDS.map((f) => {
                const v = working[f] ?? "";
                const g = record.gold[f];
                return (
                  <FieldInput
                    key={f}
                    id={`field-${f}`}
                    label={FIELD_LABEL[f]}
                    value={v}
                    labelValue={g}
                    differs={compare && norm(true, v) !== norm(true, g)}
                    onChange={(val) =>
                      update((r) => {
                        if (val.trim()) r[f] = val;
                        else delete r[f];
                      })
                    }
                  />
                );
              })}
            </div>
          </Card>

          <Card
            title="Accounting checks"
            action={
              checks.length === 0 ? (
                <Pill>no rule applies</Pill>
              ) : failed === 0 ? (
                <Pill tone="good">
                  <CheckIcon size={14} /> would be accepted
                </Pill>
              ) : (
                <Pill tone="warn">
                  <CircleAlert size={14} /> goes to human review
                </Pill>
              )
            }
          >
            {checks.length === 0 ? (
              <p className="text-[13.5px] text-muted">
                None of the five rules can run: the fields each rule needs are not all present. Try adding a total or the item amounts.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {checks.map((c) => (
                  <li
                    key={c.name}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 ${
                      c.passed ? "border-line bg-surface-solid" : "border-warn/50 bg-warn-soft/50"
                    }`}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${c.passed ? "bg-good-soft text-good" : "bg-warn text-white"}`}>
                      {c.passed ? <CheckIcon size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">{describe(c)}</span>
                    <span className="tabular text-[13px] text-muted">
                      expected <span className="font-semibold text-ink">{formatAmount(c.expected)}</span> · found{" "}
                      <span className={`font-semibold ${c.passed ? "text-ink" : "text-warn"}`}>{formatAmount(c.found)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
              The rules recheck as you edit, using a TypeScript port of the Python checker that agrees with it on all 277 rule results of the
              test set. Amounts within 1% are treated as equal, to allow for rounding.
            </p>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button tone="dark" onClick={() => decide("approved")}>
              <CheckIcon size={16} /> Approve
            </Button>
            <Button onClick={() => decide("review")}>
              <Send size={15} /> Send to review
            </Button>
            {decision && (
              <button type="button" onClick={() => save(record.id, null)} className="text-[13px] font-semibold text-muted hover:text-ink hover:underline">
                Clear my decision
              </button>
            )}
            {notice && (
              <span role="status" className="text-[13px] font-semibold text-good">
                {notice}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
