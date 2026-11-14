"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TYPE_LABEL, type QuestionDetail, type QuestionSummary } from "@/lib/types";

export function QuestionPicker({
  questions,
  value,
  onChange,
}: {
  questions: QuestionSummary[];
  value: number;
  onChange: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const box = useRef<HTMLDivElement>(null);
  const current = questions.find((q) => q.i === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const list = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return questions.filter((q) => (type === "all" || q.type === type) && words.every((w) => `${q.question} ${q.company}`.toLowerCase().includes(w)));
  }, [questions, query, type]);

  const pos = questions.findIndex((q) => q.i === value);
  const step = (d: number) => onChange(questions[(pos + d + questions.length) % questions.length].i);

  return (
    <div ref={box} className="relative mt-4">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-surface-solid px-4 py-3 text-left shadow-card hover:border-accent"
        >
          <Search size={18} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold tracking-wide text-muted uppercase">
              Question {pos + 1} of {questions.length} · {current?.company}
            </span>
            <span className="line-clamp-2 block text-[14.5px] font-semibold text-ink">{current?.question}</span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-muted" />
        </button>
        <button type="button" aria-label="Previous question" onClick={() => step(-1)} className="grid w-11 place-items-center rounded-2xl border border-line bg-surface-solid text-ink shadow-card hover:border-accent">
          <ChevronLeft size={18} />
        </button>
        <button type="button" aria-label="Next question" onClick={() => step(1)} className="grid w-11 place-items-center rounded-2xl border border-line bg-surface-solid text-ink shadow-card hover:border-accent">
          <ChevronRight size={18} />
        </button>
      </div>

      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-2 rounded-2xl border border-line bg-surface-solid p-3 shadow-card">
          <div className="mb-2 flex flex-wrap gap-2">
            <label htmlFor="question-filter" className="relative min-w-[200px] flex-1">
              <span className="sr-only">Filter questions</span>
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input
                id="question-filter"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by company or words, e.g. 3M capex"
                className="h-9 w-full rounded-lg border border-line bg-sunken pr-3 pl-8 text-[13.5px] text-ink focus:border-accent focus:outline-none"
              />
            </label>
            <select
              aria-label="Question type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-lg border border-line bg-sunken px-2 text-[13px] text-ink"
            >
              <option value="all">All types</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <ul role="listbox" aria-label="Questions" className="max-h-[340px] overflow-y-auto">
            {list.map((q) => (
              <li key={q.i} role="option" aria-selected={q.i === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(q.i);
                    setOpen(false);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left hover:bg-sunken ${q.i === value ? "bg-sunken" : ""}`}
                >
                  <span className="line-clamp-2 block text-[13.5px] font-medium text-ink">{q.question}</span>
                  <span className="text-[12px] text-muted">
                    {q.company} · {TYPE_LABEL[q.type] ?? q.type}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-muted">No question matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Loads one question's detail file (routed filings, every method's top 10, page texts). */
export function useQuestion(i: number) {
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setError(false);
    fetch(`/data/q/${i}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => live && setDetail(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [i]);
  return { detail: detail?.i === i ? detail : null, error };
}

const STOP = new Set(
  "what which with were from that this have been their there about than then into over under does did was were how many much per for and the are year fiscal company total amount based using shown give response question relying details answer please calculate round decimal places line items clearly".split(" "),
);

/** Words from the question worth highlighting in a page. */
export function keyTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z0-9][a-z0-9&.-]*/g) ?? [];
  return [...new Set(words.filter((w) => (w.length >= 4 || /^\d{2,}$/.test(w)) && !STOP.has(w)))].slice(0, 12);
}

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, k) => (k % 2 === 1 ? <mark key={k}>{part}</mark> : <span key={k}>{part}</span>))}
    </>
  );
}

export function snippet(text: string, terms: string[], width = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const hit = terms.map((t) => lower.indexOf(t)).filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 60);
  return (start > 0 ? "… " : "") + flat.slice(start, start + width) + (start + width < flat.length ? " …" : "");
}
