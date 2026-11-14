import { ArrowRight, Columns3, Database, FileSearch, Gauge, Inbox, LineChart, ReceiptText } from "lucide-react";
import Link from "next/link";
import { BarBreakdown, TrainingCurve } from "@/components/charts";
import { Banner, Button, Card, Pill, Stat } from "@/components/ui";
import { loadDashboard, loadReceipts } from "@/lib/data";

const RECEIPT_ROWS = [
  { key: "zeroshot", label: "Zero-shot" },
  { key: "zeroshot_best4", label: "+ checker (best-of-4)" },
  { key: "sft", label: "+ QLoRA fine-tune" },
  { key: "sft_best4", label: "+ fine-tune + checker" },
] as const;

const LADDER = [
  { key: "1_bm25", label: "BM25" },
  { key: "2_dense", label: "Dense" },
  { key: "3_hybrid_rrf", label: "Hybrid" },
  { key: "4_dense_routed", label: "Routed" },
  { key: "5_dense_routed_reranked", label: "Reranked" },
];

const SCREENS = [
  { href: "/receipts/0/", icon: ReceiptText, title: "Receipt checker", text: "See the model read a real receipt, edit any field and watch the accounting rules recheck." },
  { href: "/queue/", icon: Inbox, title: "Review queue", text: "All 100 test receipts: what was auto-accepted, what went to review, and export to CSV." },
  { href: "/search/", icon: FileSearch, title: "Filing search", text: "Ask one of 150 analyst questions and get the evidence pages from real SEC filings." },
  { href: "/compare/", icon: Columns3, title: "Compare methods", text: "The same question under BM25, dense, routing and reranking, side by side." },
];

export default function Overview() {
  const d = loadDashboard();
  const receipts = loadReceipts();
  const r = d.receipts;
  const m = d.retrieval.metrics;
  const flagged = receipts.filter((x) => x.flagged).length;
  const pg = d.pgvector;

  return (
    <>
      <Banner
        crumbs={[{ label: "SumProof" }, { label: "Overview" }]}
        title="Receipt AI & filing search"
        pills={
          <>
            <Pill tone="dark">Qwen3.5-4B fine-tuned</Pill>
            <Pill>Real data · $0</Pill>
          </>
        }
        meta="Reads receipt photos and checks that the numbers add up · finds the page in a real SEC filing that answers an analyst's question · one 8 GB laptop GPU"
        right={
          <>
            <Button tone="dark" href="/receipts/0/">
              Open a receipt <ArrowRight size={16} />
            </Button>
            <Button href="/search/">Search filings</Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Receipt field F1" before={r.zeroshot.strict_f1.toFixed(2)} after={r.sft_best4.strict_f1.toFixed(2)} note="100 real test receipts" />
        <Stat label="Receipts fully correct" before={`${r.zeroshot.exact}`} after={`${r.sft_best4.exact}/100`} note="every field right" />
        <Stat label="Evidence in top 5" before={m["2_dense"]["R@5"].toFixed(2)} after={m["5_dense_routed_reranked"]["R@5"].toFixed(2)} note="Recall@5, 150 analyst questions" />
        <Stat label="pgvector query" before={`${pg.exact_ms_median} ms`} after={`${pg.hnsw_ms_median} ms`} note="HNSW index vs exact scan (median)" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Receipt reader results" icon={<ReceiptText size={18} />} action={<Pill tone="warn">{flagged} sent to review</Pill>}>
          <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface-solid">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <th className="px-2.5 py-2.5 font-semibold">Qwen3.5-4B</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">F1</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Numbers</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Correct</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">s/rcpt</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {RECEIPT_ROWS.map(({ key, label }) => {
                  const row = r[key];
                  const best = key === "sft_best4";
                  return (
                    <tr key={key} className={`border-b border-line last:border-0 ${best ? "bg-sunken font-bold" : ""}`}>
                      <td className="px-2.5 py-2.5">{label}</td>
                      <td className="px-2.5 py-2.5 text-right">{row.strict_f1.toFixed(3)}</td>
                      <td className="px-2.5 py-2.5 text-right">{row.numbers_f1.toFixed(3)}</td>
                      <td className="px-2.5 py-2.5 text-right">{row.exact}/100</td>
                      <td className="px-2.5 py-2.5 text-right">{row.sec.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Fine-tuning is the big gain; the accounting checker adds a little at 2.5× the time. Only 88 of the 100 human labels pass every
            rule, because some real receipts are printed inconsistently.
          </p>
        </Card>

        <Card title="Retrieval ladder" icon={<FileSearch size={18} />} action={<span className="tabular text-[22px] font-extrabold text-mocha-deep">{m["5_dense_routed_reranked"]["R@5"].toFixed(2)}<span className="ml-1 text-[13px] font-semibold text-muted">Recall@5</span></span>}>
          <BarBreakdown
            label="Recall@5 for each retrieval step"
            bars={LADDER.map((s) => ({ label: s.label, value: m[s.key]["R@5"], highlight: s.key === "5_dense_routed_reranked" }))}
          />
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            BM25 struggles on 10-K pages full of repeated wording and number tables, so the common hybrid default drops below dense search.
            Routing by company and year, then reranking, gives the best result.
          </p>
        </Card>

        <Card title="QLoRA training" icon={<LineChart size={18} />} action={<Pill>30.5M trainable params · 7.2 GB peak</Pill>}>
          <TrainingCurve log={d.train_log} val={d.val_log} />
        </Card>

        <Card title="Vector stores" icon={<Database size={18} />} action={<Pill tone="good">identical top-10 · 150/150</Pill>}>
          <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface-solid">
            <table className="w-full min-w-[440px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <th className="px-3 py-2.5 font-semibold">Index · 12,013 × 1024-d</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Median latency</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Same top-10</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[
                  ["FAISS IndexFlatIP (exact)", `${d.faiss.benchmark[0].ms_per_query.toFixed(1)} ms`, "100%"],
                  ["FAISS HNSW, efSearch 64", `${d.faiss.benchmark.find((b) => b.efSearch === 64)?.ms_per_query.toFixed(2)} ms`, "100%"],
                  ["PostgreSQL + pgvector, exact", `${pg.exact_ms_median} ms`, "150/150 = FAISS"],
                  ["PostgreSQL + pgvector, HNSW", `${pg.hnsw_ms_median} ms`, `${(Number(pg.hnsw_top10_overlap_with_exact) * 100).toFixed(1)}%`],
                ].map(([a, b, c]) => (
                  <tr key={a} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">{a}</td>
                    <td className="px-3 py-2.5 text-right">{b}</td>
                    <td className="px-3 py-2.5 text-right">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            <Gauge size={15} className="mr-1.5 inline-block align-[-2px] text-mocha" />
            In pgvector, filing routing is a SQL <code className="font-mono text-[12px] text-ink">WHERE doc_name = ANY(...)</code> clause next to the vector search.
          </p>
        </Card>
      </div>

      <h2 className="mt-7 mb-3 text-[16px] font-bold text-ink">Explore the results</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SCREENS.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="group rounded-[20px] border border-line bg-surface-solid p-4 shadow-card transition hover:border-mocha">
            <span className="mocha-grad grid h-9 w-9 place-items-center rounded-xl text-white">
              <Icon size={18} />
            </span>
            <p className="mt-3 flex items-center gap-1.5 text-[15px] font-bold text-ink">
              {title} <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
