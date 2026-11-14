import { Suspense } from "react";
import { FilingSearch } from "@/components/FilingSearch";
import { loadQuestions } from "@/lib/data";

export default function SearchPage() {
  return (
    <Suspense>
      <FilingSearch questions={loadQuestions()} />
    </Suspense>
  );
}
