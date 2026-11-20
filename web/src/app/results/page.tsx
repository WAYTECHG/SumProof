import { ArrowRight, Columns3, Database, FileSearch, Gauge, Inbox, LineChart, ReceiptText, Sparkles } from "lucide-react";
import Link from "next/link";
import { BarBreakdown, TrainingCurve } from "@/components/charts";
import { Banner, Button, Card, Pill, Stat } from "@/components/ui";
import { loadDashboard, loadReceipts } from "@/lib/data";
import { ANSWER_MODES, THINK_MODES } from "@/lib/types";

const RECEIPT_ROWS = [
  { key: "zeroshot", label: "Zero-shot" },
  { key: "zeroshot_best4", label: "+ checker (best-of-5)" },
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
  { href: "/receipts/", icon: ReceiptText, title: "Before vs after", text: "Every test receipt read before and after fine-tuning, against the human label." },
  { href: "/queue/", icon: Inbox, title: "Receipt inbox", text: "All 100 test receipts: which add up, which need a person, and export to CSV." },
  { href: "/search/", icon: FileSearch, title: "Filing search", text: "150 analyst questions: SumProof's cited answer and the evidence pages from real SEC filings." },
  { href: "/compare/", icon: Columns3, title: "Compare search methods", text: "The same question under BM25, dense, routing and reranking, side by side." },
];

export default function Overview() {
  const d = loadDashboard();
  const receipts = loadReceipts();
  const r = d.receipts;
  const m = d.retrieval.metrics;
  const flagged = receipts.filter((x) => x.flagged).length;
  const pg = d.pgvector;
  const ans = d.answers;

  return (
    <>
      <Banner
        crumbs={[{ label: "SumProof", href: "/" }, { label: "Model results" }]}
        title="Model results"
        pills={
          <>
            <Pill tone="dark">Qwen3.5-4B fine-tuned</Pill>
            <Pill>Real data · $0</Pill>
          </>
        }
        meta="Reads receipt photos and checks that the numbers add up · finds the page in a real SEC filing that answers an analyst's question · one 8 GB laptop GPU"
        right={
          <>
            <Button tone="accent" href="/receipts/">
              Before vs after <ArrowRight size={16} />
            </Button>
            <Button href="/compare/">Compare search methods</Button>
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
        <Card title="Receipt reader results" icon={<ReceiptText size={18} />} action={<Pill tone="warn">{flagged} flagged for review</Pill>}>
          <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-solid">
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

        <Card title="Retrieval ladder" icon={<FileSearch size={18} />} action={<span className="tabular text-[22px] font-semibold text-accent-deep">{m["5_dense_routed_reranked"]["R@5"].toFixed(2)}<span className="ml-1 text-[13px] font-semibold text-muted">Recall@5</span></span>}>
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
          <TrainingCurve log={d.train_log} val={d.val_log} valFull={d.val_full} />
        </Card>

        <Card title="Vector stores" icon={<Database size={18} />} action={<Pill tone="good">identical top-10 · 150/150</Pill>}>
          <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-solid">
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
            <Gauge size={15} className="mr-1.5 inline-block align-[-2px] text-accent" />
            In pgvector, filing routing is a SQL <code className="font-mono text-[12px] text-ink">WHERE doc_name = ANY(...)</code> clause next to the vector search.
          </p>
        </Card>
      </div>

      {ans && (
        <Card
          className="mt-5"
          title="Answer generation (RAG)"
          icon={<Sparkles size={18} />}
          action={<Pill tone="good">judge agrees with exact rule {(ans.judge_vs_numeric_rule.agreement * 100).toFixed(1)}%</Pill>}
        >
          <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-solid">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <th className="px-3 py-2.5 font-semibold">Context given to Qwen3.5-4B</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Correct</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Wrong</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Refused</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Pages</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Prompt tokens</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {ANSWER_MODES.map(({ key, label, note }) => {
                  const r = ans.modes[key];
                  if (!r) return null;
                  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
                  const main = key === "top5" || key === "adaptive";
                  return (
                    <tr key={key} className={`border-b border-line last:border-0 ${main ? "font-semibold" : ""}`}>
                      <td className="px-3 py-2.5">
                        {label} <span className="font-normal text-muted">· {note}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{pct(r.correct)}</td>
                      <td className="px-3 py-2.5 text-right">{pct(r.wrong)}</td>
                      <td className="px-3 py-2.5 text-right">{pct(r.refused)}</td>
                      <td className="px-3 py-2.5 text-right">{r.pages_mean.toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-right">{r.prompt_tokens_mean.toLocaleString("en-US")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            RAG raises correct answers from {(ans.modes.closed!.correct * 100).toFixed(0)}% to {(ans.modes.top5!.correct * 100).toFixed(0)}%. Keeping
            pages until they hold 90% of the reranker&apos;s confidence uses{" "}
            {((1 - ans.modes.adaptive!.prompt_tokens_mean / ans.modes.top5!.prompt_tokens_mean) * 100).toFixed(0)}% fewer tokens with no
            significant accuracy change (McNemar p = 0.48). Even with the analysts&apos; own pages a 4B model reaches{" "}
            {(ans.modes.oracle!.correct * 100).toFixed(0)}%, so the next gain is in reasoning, not retrieval. For scale, the FinanceBench paper
            (2023, graded by hand) reports GPT-4-Turbo answering 19% of these 150 questions correctly with one search index over all
            filings and 50% with one index per filing; this pipeline&apos;s routing is closer to the per-filing setting.
          </p>
        </Card>
      )}

      {ans?.modes.think_4096 && (
        <Card className="mt-5" title="Thinking budget (budget forcing)" icon={<Sparkles size={18} />} action={<Pill tone="good">38% to 68%, McNemar p = 0.0001</Pill>}>
          <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-solid">
            <table className="w-full min-w-[560px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <th className="px-3 py-2.5 font-semibold">Reasoning before answering</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Correct</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Wrong</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Refused</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Seconds / question</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {THINK_MODES.map(({ key, label }) => {
                  const r = ans.modes[key];
                  if (!r) return null;
                  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
                  return (
                    <tr key={key} className={`border-b border-line last:border-0 ${key === "think_4096" ? "font-semibold" : ""}`}>
                      <td className="px-3 py-2.5">{label}</td>
                      <td className="px-3 py-2.5 text-right">{pct(r.correct)}</td>
                      <td className="px-3 py-2.5 text-right">{pct(r.wrong)}</td>
                      <td className="px-3 py-2.5 text-right">{pct(r.refused)}</td>
                      <td className="px-3 py-2.5 text-right">{r.seconds_mean.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The 50 calculation questions, the same top-5 pages, Qwen3.5-4B in Ollama. The model may reason up to the budget, then must answer
            (s1 budget forcing). Reasoning cuts wrong answers from 60% to 14%: it more often notices a missing figure and says so instead of
            guessing. Filing search shows these reasoned answers for the calculation questions.
          </p>
        </Card>
      )}

      <h2 className="mt-7 mb-3 text-[16px] font-bold text-ink">Explore the results</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SCREENS.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="group rounded-xl border border-line bg-surface-solid p-4 shadow-card transition hover:border-accent">
            <span className="accent-fill grid h-9 w-9 place-items-center rounded-xl text-white">
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
