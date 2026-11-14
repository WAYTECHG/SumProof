import { Cpu, Database, MonitorPlay, Scale } from "lucide-react";
import { GITHUB_URL } from "@/lib/site";
import { Banner, Card, Pill } from "@/components/ui";

export default function AboutPage() {
  return (
    <>
      <Banner
        crumbs={[{ label: "SumProof", href: "/" }, { label: "Data & licences" }]}
        title="Data & licences"
        pills={<Pill tone="dark">real data · open models</Pill>}
        meta="What this site shows, where the data comes from, and how the numbers were produced."
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Explorer mode (this site)" icon={<MonitorPlay size={18} />}>
          <p className="text-[13.5px] leading-relaxed text-ink">
            Every reading, rule result and ranked page here is the real output of the evaluation runs reported in the README. Nothing is
            simulated. The models need a GPU, which free hosting does not provide, so this site shows the saved outputs. The accounting
            checker runs live in your browser, so edits are rechecked instantly.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
            Live mode, where the same interface calls a local FastAPI server running the models, is the next step.
          </p>
        </Card>
        <Card title="How the numbers were produced" icon={<Cpu size={18} />}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-ink">
            <li>Receipts: the 100-receipt CORD-v2 test split, never used in training. Fine-tuning used the 800-receipt train split.</li>
            <li>Search: all 150 FinanceBench questions, scored against the evidence pages the analysts labelled.</li>
            <li>Hardware: one RTX 4060 laptop GPU (8 GB), Windows 11 with WSL2 Ubuntu. Cost: $0.</li>
            <li>
              Code and scripts that reproduce every number:{" "}
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="font-semibold text-mocha-deep hover:underline">
                github.com/WAYTECHG/SumProof
              </a>
            </li>
          </ul>
        </Card>
        <Card title="Datasets" icon={<Database size={18} />}>
          <ul className="flex flex-col gap-3 text-[13.5px] leading-relaxed">
            <li>
              <p className="font-semibold text-ink">CORD-v2 receipts · CC-BY-4.0</p>
              <p className="text-muted">Real Indonesian receipts with field labels, by NAVER Clova. The receipt photos on this site come from its test split.</p>
            </li>
            <li>
              <p className="font-semibold text-ink">FinanceBench · CC-BY-NC-4.0</p>
              <p className="text-muted">
                Questions, answers and evidence pages written by financial analysts about real SEC filings, by Patronus AI. Page text is shown here
                for non-commercial demonstration.
              </p>
            </li>
          </ul>
        </Card>
        <Card title="Models and code" icon={<Scale size={18} />}>
          <ul className="flex flex-col gap-3 text-[13.5px] leading-relaxed">
            <li>
              <p className="font-semibold text-ink">Qwen3.5-4B, Qwen3-Embedding-0.6B, Qwen3-Reranker-0.6B · Apache-2.0</p>
              <p className="text-muted">Open models from the Qwen team, downloaded from Hugging Face.</p>
            </li>
            <li>
              <p className="font-semibold text-ink">SumProof code · MIT</p>
              <p className="text-muted">The licence covers the code only; datasets and model weights keep their own licences.</p>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
