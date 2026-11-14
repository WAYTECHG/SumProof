"use client";

/* eslint-disable @next/next/no-img-element */
import { Check, CircleAlert, Download, Search, Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { parseAmount } from "@/lib/consistency";
import { useDecisions, type Decision } from "@/lib/decisions";
import type { ReceiptRecord } from "@/lib/types";
import { Banner, Button, Card, Pill, Segmented } from "./ui";

type Filter = "all" | "accepted" | "review" | "mine";
type Status = "accepted" | "review" | "approved" | "sent";

const STATUS: Record<Status, { label: string; tone: "good" | "warn"; icon: React.ReactNode }> = {
  accepted: { label: "Auto-accepted", tone: "good", icon: <Check size={13} /> },
  review: { label: "Needs review", tone: "warn", icon: <CircleAlert size={13} /> },
  approved: { label: "Approved by you", tone: "good", icon: <Check size={13} /> },
  sent: { label: "Sent to review", tone: "warn", icon: <Send size={12} /> },
};

function statusOf(r: ReceiptRecord, d?: Decision): Status {
  if (d) return d.status === "approved" ? "approved" : "sent";
  return r.flagged ? "review" : "accepted";
}

export function QueueTable({ receipts }: { receipts: ReceiptRecord[] }) {
  const { decisions } = useDecisions();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      receipts.map((r) => {
        const d = decisions[r.id];
        const reading = d?.edited ?? r.pred;
        const passed = r.checks.filter((c) => c.passed).length;
        return {
          r,
          status: statusOf(r, d),
          items: reading?.items?.length ?? 0,
          total: reading?.total ?? "",
          names: (reading?.items ?? []).map((it) => it.name ?? "").join(" ").toLowerCase(),
          rules: r.checks.length ? `${passed}/${r.checks.length}` : "–",
          rulesOk: passed === r.checks.length,
        };
      }),
    [receipts, decisions],
  );

  const counts = {
    accepted: rows.filter((x) => x.status === "accepted").length,
    review: rows.filter((x) => x.status === "review").length,
    mine: rows.filter((x) => x.status === "approved" || x.status === "sent").length,
  };

  const shown = rows.filter((x) => {
    if (filter === "accepted" && x.status !== "accepted") return false;
    if (filter === "review" && x.status !== "review") return false;
    if (filter === "mine" && !(x.status === "approved" || x.status === "sent")) return false;
    const q = query.trim().toLowerCase();
    return !q || x.names.includes(q) || `#${x.r.id}` === q || String(x.r.id) === q;
  });

  const exportCsv = () => {
    const header = ["receipt", "status", "total", "total_number", "items", "rules_passed", "matches_human_label"];
    const lines = shown.map((x) =>
      [x.r.id, STATUS[x.status].label, `"${x.total.replace(/"/g, '""')}"`, parseAmount(x.total) ?? "", x.items, x.rules, x.r.exact ? "yes" : "no"].join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sumproof-receipts-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Banner
        crumbs={[{ label: "SumProof", href: "/" }, { label: "Receipt inbox" }]}
        title="Receipt inbox"
        pills={
          <>
            <Pill tone="good">{counts.accepted} auto-accepted</Pill>
            <Pill tone="warn">{counts.review} need review</Pill>
            {counts.mine > 0 && <Pill tone="dark">{counts.mine} decided by you</Pill>}
          </>
        }
        meta="The 100 sample receipts as SumProof read them. Only the ones whose numbers do not add up need a person to check."
        right={
          <Button tone="accent" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </Button>
        }
      />

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented
            label="Filter receipts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All (${rows.length})` },
              { value: "accepted", label: `Auto-accepted (${counts.accepted})` },
              { value: "review", label: `Needs review (${counts.review})` },
              { value: "mine", label: `Decided by you (${counts.mine})` },
            ]}
          />
          <label htmlFor="queue-search" className="relative ml-auto w-full sm:w-64">
            <span className="sr-only">Search item names or receipt number</span>
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id="queue-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Item name or #id"
              className="h-10 w-full rounded-xl border border-line bg-surface-solid pr-3 pl-9 text-[13.5px] text-ink focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-solid">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-muted uppercase">
                <th className="px-3 py-2.5 font-semibold">Receipt</th>
                <th className="px-3 py-2.5 font-semibold">First items</th>
                <th className="px-3 py-2.5 text-right font-semibold">Items</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th className="px-3 py-2.5 text-right font-semibold">Rules</th>
                <th className="px-3 py-2.5 font-semibold">vs human label</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {shown.map((x) => {
                const s = STATUS[x.status];
                const href = `/?sample=${x.r.id}`;
                const first = (x.r.pred?.items ?? []).slice(0, 2).map((it) => it.name).filter(Boolean).join(", ");
                return (
                  <tr key={x.r.id} className="border-b border-line transition-colors last:border-0 hover:bg-sunken">
                    <td className="px-3 py-2">
                      <Link href={href} className="flex items-center gap-3 font-semibold text-ink hover:text-accent-deep">
                        <img src={`/data/${x.r.image}`} alt="" loading="lazy" className="h-12 w-9 rounded-md border border-line object-cover object-top" />
                        #{x.r.id}
                      </Link>
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-muted">{first || "–"}</td>
                    <td className="px-3 py-2 text-right">{x.items}</td>
                    <td className="px-3 py-2 text-right font-semibold">{x.total || "–"}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${x.rulesOk ? "text-good" : "text-warn"}`}>{x.rules}</td>
                    <td className="px-3 py-2">{x.r.exact ? <Pill tone="good">matches</Pill> : <Pill>differs</Pill>}</td>
                    <td className="px-3 py-2">
                      <Link href={href}>
                        <Pill tone={s.tone}>
                          {s.icon} {s.label}
                        </Pill>
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">
                    No receipts match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">
          &quot;vs human label&quot; compares every field with CORD&apos;s annotation; most differences are item-name spellings, not amounts.
          Your decisions are saved in this browser only.
        </p>
      </Card>
    </>
  );
}
