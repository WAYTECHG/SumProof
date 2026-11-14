"""Download FinanceBench and split its filings into pages.

  python -m sumproof.rag.download_financebench

Creates, under data/financebench/:
  questions.parquet   150 analyst questions with answers and evidence pages
                      (PatronusAI/financebench on Hugging Face, CC-BY-NC-4.0)
  pdfs/*.pdf          the 84 SEC filings the questions refer to (~166 MB), from the
                      FinanceBench authors' GitHub repository
  pages.parquet       one row per PDF page: doc_name, page (0-based), text

Then checks that the labelled evidence pages line up with the extracted text, since
an off-by-one page error would silently ruin every retrieval score.
"""

from __future__ import annotations

import concurrent.futures as cf
import re
from pathlib import Path

import pandas as pd
import requests

DATA = Path("data/financebench")
QUESTIONS_REPO = "PatronusAI/financebench"
PDF_URL = "https://github.com/patronus-ai/financebench/raw/main/pdfs/{doc}.pdf"


def download_questions() -> pd.DataFrame:
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(QUESTIONS_REPO, "default/train/0000.parquet", repo_type="dataset",
                           revision="refs/convert/parquet")
    q = pd.read_parquet(path)
    q.to_parquet(DATA / "questions.parquet")
    print(f"{len(q)} questions, {q.doc_name.nunique()} filings, {q.company.nunique()} companies")
    return q


def download_pdf(doc: str) -> tuple[str, str]:
    path = DATA / "pdfs" / f"{doc}.pdf"
    if path.exists() and path.stat().st_size > 10_000:
        return doc, "cached"
    r = requests.get(PDF_URL.format(doc=doc), timeout=120)
    if r.status_code != 200 or r.content[:4] != b"%PDF":
        return doc, f"failed (HTTP {r.status_code})"
    path.write_bytes(r.content)
    return doc, "downloaded"


def extract_pages(docs: list[str]) -> pd.DataFrame:
    import pymupdf

    rows = []
    for doc in docs:
        with pymupdf.open(DATA / "pdfs" / f"{doc}.pdf") as pdf:
            rows += [{"doc_name": doc, "page": i, "text": page.get_text()} for i, page in enumerate(pdf)]
    pages = pd.DataFrame(rows)
    pages.to_parquet(DATA / "pages.parquet")
    return pages


def check_evidence_pages(q: pd.DataFrame, pages: pd.DataFrame) -> dict[str, int]:
    """Where does each labelled evidence snippet appear: on the stated page, one off, or nowhere?"""
    norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()
    text = {(d, p): norm(t) for d, p, t in zip(pages.doc_name, pages.page, pages.text)}
    counts = {"same_page": 0, "next_page": 0, "previous_page": 0, "not_found": 0}
    for evidence in q.evidence:
        for e in evidence:
            snippet, doc, page = norm(e["evidence_text"])[:60], e["doc_name"], e["evidence_page_num"]
            if snippet in text.get((doc, page), ""):
                counts["same_page"] += 1
            elif snippet in text.get((doc, page + 1), ""):
                counts["next_page"] += 1
            elif snippet in text.get((doc, page - 1), ""):
                counts["previous_page"] += 1
            else:
                counts["not_found"] += 1
    return counts


def main() -> None:
    (DATA / "pdfs").mkdir(parents=True, exist_ok=True)
    q = download_questions()
    docs = sorted(q.doc_name.unique())
    with cf.ThreadPoolExecutor(8) as pool:
        status = dict(pool.map(download_pdf, docs))
    failed = [d for d, s in status.items() if s.startswith("failed")]
    print(f"PDFs: {len(docs) - len(failed)}/{len(docs)} available" + (f"; failed: {failed}" if failed else ""))
    if failed:
        raise SystemExit("Some filings could not be downloaded; rerun to retry.")

    pages = extract_pages(docs)
    print(f"{len(pages)} pages extracted")
    print("evidence check (expected: almost all on the same page, 0-based):", check_evidence_pages(q, pages))


if __name__ == "__main__":
    main()
