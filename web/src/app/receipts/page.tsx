/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Banner, Card, Pill } from "@/components/ui";
import { loadReceipts } from "@/lib/data";

export default function ReceiptsGallery() {
  const receipts = loadReceipts();
  return (
    <>
      <Banner
        crumbs={[{ label: "Model results", href: "/results/" }, { label: "Before vs after" }]}
        title="Before vs after fine-tuning"
        pills={<Pill tone="dark">100 test receipts</Pill>}
        meta="Pick a test receipt to compare the model before and after fine-tuning against the human label, and to see how the checker picked its reading."
      />
      <Card>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8 2xl:grid-cols-10">
          {receipts.map((r) => (
            <li key={r.id}>
              <Link href={`/receipts/${r.id}/`} className="group block rounded-xl border border-line bg-surface-solid p-1.5 transition hover:border-accent">
                <img src={`/data/${r.image}`} alt={`Receipt #${r.id}`} loading="lazy" className="aspect-[3/4] w-full rounded-lg object-cover object-top" />
                <span className="mt-1.5 flex items-center justify-between px-0.5 text-[12px] font-semibold text-ink">
                  #{r.id}
                  <span className={`h-2 w-2 rounded-full ${r.flagged ? "bg-warn" : "bg-good"}`} title={r.flagged ? "Needs review" : "Auto-accepted"} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
