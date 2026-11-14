import { Suspense } from "react";
import { CompareMethods } from "@/components/CompareMethods";
import { loadDashboard, loadQuestions } from "@/lib/data";

export default function ComparePage() {
  const d = loadDashboard();
  return (
    <Suspense>
      <CompareMethods questions={loadQuestions()} metrics={d.retrieval.metrics} />
    </Suspense>
  );
}
