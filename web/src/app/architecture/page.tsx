/* eslint-disable @next/next/no-img-element */
import { FileSearch, ReceiptText } from "lucide-react";
import { Banner, Card, Pill } from "@/components/ui";

const RECEIPT_STEPS = [
  ["Read", "The photo goes straight into Qwen3.5-4B, a vision-language model. Its vision encoder turns the image into up to ~800 image tokens and the language model writes the receipt as JSON. There is no separate OCR step.", "receipts/vlm.py"],
  ["Sample", "Besides the normal (greedy) reading, the model samples four more, giving five candidates.", "vlm.generate"],
  ["Check", "Each candidate is tested against the receipt's arithmetic. The checker keeps the one that passes the most rules; if even that one breaks a rule, the receipt is flagged for human review.", "receipts/consistency.py"],
  ["Fine-tune (offline)", "QLoRA trains a small LoRA adapter (0.67% of the weights) on 800 real CORD receipts while the 4-bit base model stays frozen; the adapter plugs into the language model at inference.", "receipts/train_qlora.py"],
];
const SEARCH_STEPS = [
  ["Index (offline)", "The 84 filings are split into 12,013 pages and each page is embedded with Qwen3-Embedding into a 1024-number vector.", "rag/download_financebench.py"],
  ["Route", "The question's company (name, ticker or nickname) and fiscal year select the matching filings.", "financebench.build_router"],
  ["Search", "The question is embedded the same way, and exact vector search finds the closest pages among the routed filings, in FAISS or in PostgreSQL with pgvector, where routing is a SQL WHERE clause.", "rag/index.py · rag/pgstore.py"],
  ["Rerank", "Qwen3-Reranker reads the question and each of the top 30 pages together and reorders them; the output is the evidence pages with their page numbers.", "financebench.py"],
];

function Steps({ steps }: { steps: string[][] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map(([title, text, file], k) => (
        <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface-solid p-3.5">
          <span className="accent-fill grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white">{k + 1}</span>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-ink">{title}</p>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{text}</p>
            <code className="mt-1.5 inline-block rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-accent-deep">{file}</code>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ArchitecturePage() {
  return (
    <>
      <Banner
        crumbs={[{ label: "Model results", href: "/results/" }, { label: "Architecture" }]}
        title="Architecture"
        pills={<Pill tone="dark">two pipelines</Pill>}
        meta="Solid boxes run for every request; dashed boxes are offline steps that run once."
      />
      <Card className="mb-5">
        <div className="overflow-x-auto rounded-xl">
          <img src="/architecture.svg" alt="SumProof architecture: receipt reader and financial filing search pipelines" className="w-full min-w-[720px]" />
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="A. Receipt reader" icon={<ReceiptText size={18} />}>
          <Steps steps={RECEIPT_STEPS} />
        </Card>
        <Card title="B. Financial filing search" icon={<FileSearch size={18} />}>
          <Steps steps={SEARCH_STEPS} />
        </Card>
      </div>
    </>
  );
}
