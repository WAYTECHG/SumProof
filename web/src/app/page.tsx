import { Suspense } from "react";
import { ScanReceipt } from "@/components/ScanReceipt";
import { loadReceipts } from "@/lib/data";

export default function ScanPage() {
  // Only what the scan page needs: the photo and the fine-tuned model's reading of each sample.
  const samples = loadReceipts().map(({ id, image, pred, flagged }) => ({ id, image, pred, flagged }));
  return (
    <Suspense>
      <ScanReceipt samples={samples} />
    </Suspense>
  );
}
