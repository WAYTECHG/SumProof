"use client";

import { BarChart3, Check, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { docParts, METHODS, type QuestionSummary } from "@/lib/types";
import { BarBreakdown } from "./charts";
import { QuestionPicker, useQuestion } from "./QuestionPicker";
import { Banner, Card, Pill } from "./ui";

const METRIC_KEY: Record<string, string> = {
  bm25: "1_bm25",
  dense: "2_dense",
  hybrid: "3_hybrid_rrf",
  routed: "4_dense_routed",
  reranked: "5_dense_routed_reranked",
};

export function CompareMethods({ questions, metrics }: { questions: QuestionSummary[]; metrics: Record<string, Record<string, number>> }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.has("q") ? Number(params.get("q")) : NaN;
  const interesting = useMemo(() => {
    const keywordMiss = questions.filter((q) => q.rank.reranked === 1 && q.rank.bm25 === null).slice(0, 3);
    const routingHelps = questions.filter((q) => q.rank.dense === null && q.rank.reranked !== null && q.rank.reranked <= 3).slice(0, 2);
    return [...keywordMiss.map((q) => ({ q, why: "BM25 misses, reranker #1" })), ...routingHelps.map((q) => ({ q, why: "dense misses, routing finds it" }))];
  }, [questions]);
  const [qi, setQi] = useState(Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < questions.length ? fromUrl : interesting[0]?.q.i ?? 0);
  const { detail } = useQuestion(qi);

  const choose = (i: number) => {
    setQi(i);
    router.replace(`${pathname}?q=${i}`, { scroll: false });
  };

  return (
    <>
      <Banner
        crumbs={[{ label: "Model results", href: "/results/" }, { label: "Compare methods" }]}
        title="Compare methods"
        pills={<Pill tone="dark">same question · 5 retrieval steps</Pill>}
        meta="Each column is one step of the ladder. A green row is a page the financial analysts marked as the evidence."
      >
        <QuestionPicker questions={questions} value={qi} onChange={choose} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            <Lightbulb size={14} /> Questions that show the difference:
          </span>
          {interesting.map(({ q, why }) => (
            <button
              key={q.i}
              type="button"
              onClick={() => choose(q.i)}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
                q.i === qi ? "border-ink bg-ink text-bg" : "border-line bg-surface-solid text-ink hover:border-accent"
              }`}
              title={q.question}
            >
              Q{q.i + 1} · {q.company} · {why}
            </button>
          ))}
        </div>
      </Banner>

      {!detail && <Card>Loading the question…</Card>}

      {detail && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {METHODS.map((m) => {
            const hits = detail.methods[m.key].slice(0, 5);
            const rank = detail.methods[m.key].findIndex((h) => h.gold) + 1;
            const final = m.key === "reranked";
            return (
              <section
                key={m.key}
                className={`min-w-0 rounded-xl border p-4 shadow-card ${final ? "border-accent bg-surface-solid" : "border-line bg-surface-solid"}`}
              >
                <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{m.note}</p>
                <h2 className="mt-0.5 text-[15px] font-bold text-ink">{m.label}</h2>
                <div className="mt-2">
                  {rank > 0 ? (
                    <Pill tone={rank <= 5 ? "good" : "warn"}>
                      <Check size={13} /> evidence at rank {rank}
                    </Pill>
                  ) : (
                    <Pill tone="warn">
                      <X size={13} /> not in top 10
                    </Pill>
                  )}
                </div>
                <ol className="mt-3 flex flex-col gap-1.5">
                  {hits.map((h, k) => {
                    const p = detail.pages[String(h.row)];
                    const { company, period } = docParts(p.doc);
                    return (
                      <li key={h.row}>
                        <Link
                          href={`/search/?q=${qi}`}
                          className={`flex items-start gap-2 rounded-xl border px-2.5 py-2 text-[12.5px] transition hover:border-accent ${
                            h.gold ? "border-good/50 bg-good-soft" : "border-line bg-surface-solid"
                          }`}
                          title={p.text.slice(0, 300)}
                        >
                          <span className="tabular w-4 shrink-0 font-bold text-muted">{k + 1}</span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink">
                              {period} · p.{p.page + 1}
                            </span>
                            <span className="block truncate text-[11.5px] text-muted">{company}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      <Card className="mt-5" title="Across all 150 questions" icon={<BarChart3 size={18} />} action={<Pill>Recall@1 · first result is the evidence</Pill>}>
        <BarBreakdown
          label="Recall@1 for each retrieval step across 150 questions"
          bars={METHODS.map((m) => ({ label: m.short, value: metrics[METRIC_KEY[m.key]]["R@1"], highlight: m.key === "reranked" }))}
          max={0.5}
        />
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          How often the very first page is the analysts&apos; evidence page. The final pipeline gets it right on its first try for{" "}
          {Math.round(metrics["5_dense_routed_reranked"]["R@1"] * 150)} of 150 questions, against {Math.round(metrics["1_bm25"]["R@1"] * 150)} for keyword search.
        </p>
      </Card>
    </>
  );
}
