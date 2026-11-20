"use client";

/* eslint-disable @next/next/no-img-element */
import { Check as CheckIcon, ChevronLeft, ChevronRight, CircleAlert, RotateCcw, Send, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { check, type Receipt } from "@/lib/consistency";
import { useDecisions } from "@/lib/decisions";
import type { ReceiptRecord } from "@/lib/types";
import { CheckList, cloneReceipt as clone, ReceiptFields } from "./ReceiptFields";
import { Banner, Button, Card, Pill, Segmented } from "./ui";

type Source = "model" | "zeroshot" | "label";
const SOURCES: { value: Source; label: string }[] = [
  { value: "model", label: "Fine-tuned model" },
  { value: "zeroshot", label: "Before fine-tuning" },
  { value: "label", label: "Human label" },
];
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
        crumbs={[{ label: "Model results", href: "/results/" }, { label: "Before vs after", href: "/receipts/" }, { label: `Receipt #${record.id}` }]}
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
        meta="CORD-v2 test receipt · read by Qwen3.5-4B (QLoRA) with best-of-5 and the accounting checker"
        right={
          <>
            {prev !== null ? (
              <Button href={`/receipts/${prev}/`}>
                <ChevronLeft size={16} /> #{prev}
              </Button>
            ) : null}
            {next !== null ? (
              <Button tone="accent" href={`/receipts/${next}/`}>
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
                className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-solid px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-accent"
              >
                {zoom ? <ZoomOut size={14} /> : <ZoomIn size={14} />} {zoom ? "Fit" : "Zoom"}
              </button>
            }
          >
            <div className={`overflow-auto rounded-xl border border-line bg-sunken ${zoom ? "max-h-[720px]" : ""}`}>
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
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-[13px] ${c.chosen ? "border-accent bg-sunken" : "border-line bg-surface-solid"}`}
                >
                  <span className="w-24 shrink-0 font-semibold text-ink">{k === 0 ? "Greedy" : `Sample ${k}`}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                    <div className="accent-fill h-full rounded-full" style={{ width: `${Math.round((c.consistency ?? 0) * 100)}%` }} />
                  </div>
                  <span className="tabular w-24 shrink-0 text-right text-muted">
                    {c.valid ? `${Math.round((c.consistency ?? 0) * 100)}% rules` : "invalid JSON"}
                  </span>
                  <span className="w-16 shrink-0 text-right">{c.chosen && <Pill tone="accent">picked</Pill>}</span>
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
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-accent-deep hover:underline"
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
                  <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="accent-[var(--accent)]" />
                  Mark differences from the human label
                </label>
              )}
            </div>

            <ReceiptFields value={working} update={update} gold={record.gold} compare={compare} />
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
                  <CircleAlert size={14} /> flagged for review
                </Pill>
              )
            }
          >
            {checks.length === 0 ? (
              <p className="text-[13.5px] text-muted">
                None of the five rules can run: the fields each rule needs are not all present. Try adding a total or the item amounts.
              </p>
            ) : (
              <CheckList checks={checks} />
            )}
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
              The rules recheck as you edit, using a TypeScript port of the Python checker that agrees with it on all 277 rule results of the
              test set. Amounts within 1% are treated as equal, to allow for rounding.
            </p>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button tone="accent" onClick={() => decide("approved")}>
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
