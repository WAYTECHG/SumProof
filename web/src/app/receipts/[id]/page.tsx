import { ReceiptChecker } from "@/components/ReceiptChecker";
import { loadReceipts } from "@/lib/data";

export function generateStaticParams() {
  return loadReceipts().map((r) => ({ id: String(r.id) }));
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipts = loadReceipts();
  const i = Number(id);
  const record = receipts[i];
  return <ReceiptChecker record={record} prev={i > 0 ? i - 1 : null} next={i < receipts.length - 1 ? i + 1 : null} />;
}
