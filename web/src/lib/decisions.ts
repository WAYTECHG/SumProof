"use client";

// Reviewer decisions (approve / send to review, plus edited fields) are kept in this browser only.
import { useCallback, useEffect, useState } from "react";
import type { Receipt } from "./consistency";

export type Decision = { status: "approved" | "review"; edited?: Receipt; at: string };
const KEY = "sumproof-decisions";

function read(): Record<string, Decision> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function useDecisions() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  useEffect(() => setDecisions(read()), []);

  const save = useCallback((id: number, d: Decision | null) => {
    const next = { ...read() };
    if (d) next[id] = d;
    else delete next[id];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    setDecisions(next);
  }, []);

  return { decisions, save };
}
