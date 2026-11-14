"use client";

import { FileSearch, ReceiptText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QuestionSummary } from "@/lib/types";

type Result = { key: string; label: string; sub: string; href: string; kind: "receipt" | "question" };

export function QuickJump() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => {
    if (questions) return;
    fetch("/data/questions.json")
      .then((r) => r.json())
      .then(setQuestions)
      .catch(() => setQuestions([]));
  };

  // Ctrl/Cmd + K focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Result[] = [];
    const num = q.match(/^#?(\d{1,2})$/);
    if (num && Number(num[1]) < 100) {
      out.push({ key: `r${num[1]}`, kind: "receipt", label: `Receipt #${num[1]}`, sub: "Open in the receipt checker", href: `/receipts/${Number(num[1])}/` });
    }
    const words = q.split(/\s+/).filter(Boolean);
    for (const item of questions ?? []) {
      const hay = `${item.question} ${item.company}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) {
        out.push({ key: `q${item.i}`, kind: "question", label: item.question, sub: item.company, href: `/search/?q=${item.i}` });
        if (out.length >= 7) break;
      }
    }
    return out;
  }, [query, questions]);

  const go = (r: Result) => {
    setOpen(false);
    setQuery("");
    router.push(r.href);
  };

  return (
    <div ref={box} className="relative w-full min-w-0 max-w-[420px]">
      <label htmlFor="quick-jump" className="sr-only">
        Jump to a receipt or a question
      </label>
      <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input
        id="quick-jump"
        ref={input}
        value={query}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            go(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Jump to #17 or search questions…"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="quick-jump-list"
        className="h-10 w-full min-w-0 rounded-xl border border-line bg-surface-solid pr-3 pl-10 sm:pr-14 text-[14px] text-ink shadow-card placeholder:text-muted focus:border-mocha focus:outline-none"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted sm:block">
        Ctrl K
      </kbd>
      {open && results.length > 0 && (
        <ul id="quick-jump-list" role="listbox" className="absolute top-12 right-0 left-0 z-30 overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-card">
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${i === active ? "bg-sunken" : ""}`}
              >
                {r.kind === "receipt" ? <ReceiptText size={16} className="mt-0.5 shrink-0 text-mocha" /> : <FileSearch size={16} className="mt-0.5 shrink-0 text-mocha" />}
                <span className="min-w-0">
                  <span className="line-clamp-2 block text-[13.5px] font-semibold text-ink">{r.label}</span>
                  <span className="block text-[12px] text-muted">{r.sub}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
