import type { Check, Receipt } from "./consistency";

export type Candidate = { kind: "greedy" | "sampled"; valid: boolean; consistency: number | null; logprob: number; chosen: boolean };

export type ReceiptRecord = {
  id: number;
  image: string;
  pred: Receipt | null; // fine-tuned Qwen3.5-4B + best-of-4 with the accounting checker
  zeroshot: Receipt | null; // the same model before fine-tuning
  gold: Receipt; // human label from CORD-v2
  flagged: boolean; // the checker sent it to human review
  exact: boolean; // every field equals the human label
  checks: Check[]; // checker results computed in Python (the browser recomputes them live)
  candidates: Candidate[];
};

export type Method = "bm25" | "dense" | "hybrid" | "routed" | "reranked";

export const METHODS: { key: Method; label: string; short: string; note: string }[] = [
  { key: "bm25", label: "BM25", short: "BM25", note: "keyword match" },
  { key: "dense", label: "Dense (Qwen3-Embedding)", short: "Dense", note: "meaning, all filings" },
  { key: "hybrid", label: "Hybrid BM25 + dense (RRF)", short: "Hybrid", note: "common default" },
  { key: "routed", label: "Dense + filing routing", short: "Routed", note: "company + year" },
  { key: "reranked", label: "Routed + Qwen3-Reranker", short: "Reranked", note: "final pipeline" },
];

export type QuestionSummary = {
  i: number;
  question: string;
  company: string;
  type: string;
  rank: Record<Method, number | null>; // first rank of an evidence page in the top 10, or null
  outcome?: Partial<Record<AnswerMode, Outcome>>;
};

/** How the generated answer compares with the analysts' reference answer. */
export type Outcome = "correct" | "wrong" | "refused" | "ungraded";
export type AnswerMode = "closed" | "top5" | "adaptive" | "oracle";

export type GeneratedAnswer = { text: string; rows: number[]; cited: number[]; outcome: Outcome; prompt_tokens: number };

export const ANSWER_MODES: { key: AnswerMode; label: string; note: string }[] = [
  { key: "closed", label: "No pages (closed book)", note: "what the model knows" },
  { key: "top5", label: "Top 5 reranked pages", note: "standard RAG" },
  { key: "adaptive", label: "Confidence-gated pages", note: "1 to 5 pages" },
  { key: "oracle", label: "The analysts' evidence pages", note: "ceiling" },
];

export type Hit = { row: number; gold: boolean; score?: number };

export type QuestionDetail = {
  i: number;
  question: string;
  company: string;
  type: string;
  answer: string;
  justification: string | null;
  doc_link: string;
  gold: { row: number; doc: string; page: number }[];
  detected: { company: string; years: number[]; filings: string[] } | null;
  methods: Record<Method, Hit[]>;
  generated: Partial<Record<AnswerMode, GeneratedAnswer>>;
  pages: Record<string, { doc: string; page: number; text: string }>;
};

export type Dashboard = {
  receipts: Record<
    "zeroshot" | "zeroshot_best4" | "sft" | "sft_best4",
    { strict_f1: number; norm_f1: number; numbers_f1: number; exact: number; exact_norm: number; total_acc: number; valid: number; sec: number; flag: { precision: number; recall: number } }
  >;
  retrieval: {
    n_questions: number;
    n_pages: number;
    n_filings: number;
    router_kept_right_filing: number;
    metrics: Record<string, Record<string, number>>;
    "recall@5_by_question_type": Record<string, Record<string, number>>;
  };
  faiss: { benchmark: { index: string; efSearch: number | null; ms_per_query: number; "overlap@10_vs_exact": number; "recall@5_gold": number }[] };
  pgvector: Record<string, string | number>;
  train_log: { step: number; epoch: number; loss: number; lr: number }[];
  answers?: {
    judge: string;
    modes: Record<
      AnswerMode,
      { correct: number; wrong: number; refused: number; pages_mean: number; prompt_tokens_mean: number; context_has_evidence_page: number | null }
    >;
    judge_vs_numeric_rule: { answers: number; agreement: number };
  };
  val_log: { field_f1: number; total_accuracy: number; epoch: number }[];
};

export const TYPE_LABEL: Record<string, string> = {
  "metrics-generated": "Metric lookup",
  "domain-relevant": "Analyst reasoning",
  "novel-generated": "Open-ended",
};

/** "3M_2018_10K" -> { company: "3M", period: "2018 10-K" } */
export function docParts(doc: string): { company: string; period: string } {
  const m = doc.match(/^(.+?)_(\d{4})(Q\d)?_([A-Z0-9]+)/);
  if (!m) return { company: doc.replace(/_/g, " "), period: "" };
  const kind = { "10K": "10-K", "10Q": "10-Q", "8K": "8-K", EARNINGS: "earnings" }[m[4]] ?? m[4];
  return { company: m[1].replace(/_/g, " "), period: `${m[2]}${m[3] ? ` ${m[3]}` : ""} ${kind}` };
}

/** "3M_2018_10K" -> "3M · 2018 10-K" */
export function prettyDoc(doc: string): string {
  const m = doc.match(/^(.+?)_(\d{4})(Q\d)?_([A-Z0-9]+)/);
  if (!m) return doc.replace(/_/g, " ");
  const company = m[1].replace(/_/g, " ");
  const kind = { "10K": "10-K", "10Q": "10-Q", "8K": "8-K", EARNINGS: "earnings" }[m[4]] ?? m[4];
  return `${company} · ${m[2]}${m[3] ? ` ${m[3]}` : ""} ${kind}`;
}
