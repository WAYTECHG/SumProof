"use client";

import { Check, CircleAlert, ExternalLink, FileText, Files, MessageSquareQuote, SearchX, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { prettyDoc, TYPE_LABEL, type GeneratedAnswer, type QuestionSummary } from "@/lib/types";
import { Highlight, keyTerms, QuestionPicker, snippet, useQuestion } from "./QuestionPicker";
import { Banner, Card, Pill } from "./ui";

/** The answer without its "Source: [n]" line or inline [n] markers (the sources are shown as chips). */
function answerBody(text: string): string {
  return text
    .replace(/\n?\s*sources?\s*:[\s\S]*$/i, "")
    .replace(/\s*\[\d{1,2}\]/g, "")
    .trim();
}

function OutcomePill({ g }: { g: GeneratedAnswer }) {
  if (g.outcome === "correct")
    return (
      <Pill tone="good">
        <Check size={13} /> Matches the analysts&apos; answer
      </Pill>
    );
  if (g.outcome === "wrong")
    return (
      <Pill tone="warn">
        <CircleAlert size={13} /> Differs from the analysts&apos; answer
      </Pill>
    );
  if (g.outcome === "refused")
    return (
      <Pill>
        <SearchX size={13} /> Not found in the pages
      </Pill>
    );
  return null;
}

export function FilingSearch({ questions }: { questions: QuestionSummary[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.has("q") ? Number(params.get("q")) : NaN;
  const [qi, setQi] = useState(Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < questions.length ? fromUrl : questions[0].i);
  const { detail, error } = useQuestion(qi);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const choose = (i: number) => {
    setQi(i);
    setSelected(null);
    setShowAnswer(false);
    router.replace(`${pathname}?q=${i}`, { scroll: false });
  };

  const hits = useMemo(() => detail?.methods.reranked.slice(0, 5) ?? [], [detail]);
  // The most accurate measured setting: reasoning before answering (calculation questions), else top-5 RAG.
  const reasoned = detail?.generated.think_4096;
  const gen = reasoned ?? detail?.generated.top5;
  // Open the page the answer cites; otherwise the top-ranked page.
  useEffect(() => {
    if (detail && selected === null && hits.length) setSelected(gen?.cited.find((r) => detail.pages[String(r)]) ?? hits[0].row);
  }, [detail, selected, hits, gen]);

  const terms = detail ? keyTerms(detail.question) : [];
  const page = detail && selected !== null ? detail.pages[String(selected)] : null;
  const isGold = detail && selected !== null ? detail.gold.some((g) => g.row === selected) : false;
  const goldRank = detail ? detail.methods.reranked.findIndex((h) => h.gold) + 1 : 0;
  const summary = questions.find((q) => q.i === qi);

  return (
    <>
      <Banner
        crumbs={[{ label: "SumProof", href: "/" }, { label: "Filing search" }]}
        title="Filing search"
        pills={
          <>
            <Pill tone="dark">12,013 pages · 84 SEC filings</Pill>
            <Pill>150 analyst questions</Pill>
          </>
        }
        meta="Pick an analyst question about a company's SEC filing. SumProof finds the pages that answer it, writes the answer, and shows the page it used."
      >
        <QuestionPicker questions={questions} value={qi} onChange={choose} />
      </Banner>

      {error && <Card>Could not load this question. Check that the exported data is present in public/data/q.</Card>}
      {!detail && !error && <Card>Loading the question…</Card>}

      {detail && (
        <>
          <Card
            className="mb-5"
            title="SumProof's answer"
            icon={<Sparkles size={18} />}
            action={
              gen ? (
                <>
                  {reasoned && <Pill tone="dark">Reasoned answer</Pill>}
                  <OutcomePill g={gen} />
                </>
              ) : null
            }
          >
            {gen ? (
              <>
                <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink">
                  {gen.outcome === "refused" ? "The retrieved pages do not contain the answer." : answerBody(gen.text)}
                </p>
                {gen.cited.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    Source:
                    {gen.cited.map((row) => {
                      const p = detail.pages[String(row)];
                      return p ? (
                        <button
                          key={row}
                          type="button"
                          onClick={() => setSelected(row)}
                          className="flex items-center gap-1.5 rounded-full border border-line bg-surface-solid px-3 py-1 text-[12.5px] font-medium text-accent hover:border-accent"
                        >
                          <FileText size={13} /> {prettyDoc(p.doc)}, page {p.page + 1}
                        </button>
                      ) : null;
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13.5px] text-muted">No generated answer for this question.</p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
              <Files size={14} />
              {detail.detected ? <>Searched {detail.detected.filings.map(prettyDoc).join(", ")}</> : <>No company named, so all 84 filings were searched</>}
              <span className="ml-auto">
                <Pill>{TYPE_LABEL[detail.type] ?? detail.type}</Pill>
              </span>
            </div>

            <div className="mt-3 rounded-xl border border-line bg-sunken p-3.5">
              <button
                type="button"
                onClick={() => setShowAnswer((s) => !s)}
                aria-expanded={showAnswer}
                className="flex items-center gap-2 text-[13.5px] font-medium text-accent"
              >
                <MessageSquareQuote size={16} /> {showAnswer ? "Hide" : "Show"} the analysts&apos; reference answer
              </button>
              {showAnswer && (
                <div className="mt-2 text-[13.5px] leading-relaxed text-ink">
                  <p className="font-semibold">{detail.answer}</p>
                  {detail.justification && <p className="mt-1 text-muted">{detail.justification}</p>}
                </div>
              )}
            </div>
            <p className="mt-3 text-[12px] text-muted">
              {reasoned
                ? `Written by Qwen3.5-4B from the 5 best pages below, after reasoning for ${reasoned.thinking_tokens?.toLocaleString("en-US")} tokens: on calculation questions this lifts accuracy from 38% to 68%.`
                : "Written by Qwen3.5-4B from the 5 best pages below."}{" "}
              AI can misread tables and calculations, so check the source page before relying on a number.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card
              title="Top evidence pages"
              icon={<FileText size={18} />}
              action={
                goldRank > 0 && goldRank <= 5 ? (
                  <Pill tone="good">
                    <Check size={13} /> analysts&apos; page at rank {goldRank}
                  </Pill>
                ) : goldRank > 5 ? (
                  <Pill tone="warn">analysts&apos; page at rank {goldRank}</Pill>
                ) : (
                  <Pill tone="warn">analysts&apos; page not in top 10</Pill>
                )
              }
            >
              <ol className="flex flex-col gap-2.5">
                {hits.map((h, k) => {
                  const p = detail.pages[String(h.row)];
                  const active = selected === h.row;
                  return (
                    <li key={h.row}>
                      <button
                        type="button"
                        onClick={() => setSelected(h.row)}
                        aria-pressed={active}
                        className={`w-full rounded-xl border p-3.5 text-left transition ${
                          active ? "border-accent bg-sunken shadow-card" : "border-line bg-surface-solid hover:border-accent/60"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="accent-fill grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold text-white">{k + 1}</span>
                          <span className="text-[13.5px] font-bold text-ink">{prettyDoc(p.doc)}</span>
                          <span className="text-[12.5px] text-muted">page {p.page + 1}</span>
                          {h.gold && (
                            <Pill tone="good" className="ml-auto">
                              <Check size={12} /> evidence
                            </Pill>
                          )}
                        </div>
                        <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-muted">
                          <Highlight text={snippet(p.text, terms)} terms={terms} />
                        </p>
                        {h.score !== undefined && <p className="tabular mt-1.5 text-[11.5px] text-muted">reranker score {h.score.toFixed(2)}</p>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </Card>

            <Card
              title={page ? prettyDoc(page.doc) : "Page viewer"}
              icon={<FileText size={18} />}
              action={
                page ? (
                  <>
                    {isGold && <Pill tone="good">analysts&apos; evidence page</Pill>}
                    <Pill tone="dark">page {page.page + 1}</Pill>
                  </>
                ) : null
              }
            >
              {page ? (
                <>
                  <div className="max-h-[620px] overflow-y-auto rounded-xl border border-line bg-surface-solid p-5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink">
                    <Highlight text={page.text} terms={terms} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
                    <span>Text extracted with PyMuPDF; highlights are words from the question.</span>
                    {summary && detail.doc_link && page.doc === detail.gold[0]?.doc && (
                      <a href={`${detail.doc_link}#page=${page.page + 1}`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 font-semibold text-accent-deep hover:underline">
                        Open original filing <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-[13.5px] text-muted">Select a page to read it.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
