import { QueueTable } from "@/components/QueueTable";
import { loadReceipts } from "@/lib/data";

export default function QueuePage() {
  return <QueueTable receipts={loadReceipts()} />;
}
