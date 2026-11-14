# SumProof web interface

Next.js 15 + TypeScript + Tailwind CSS, deployable for free on Vercel as a static site.

**App** (for everyday users)

| Screen | What it does |
|---|---|
| Scan receipt (`/`) | Upload a photo (needs the live reader) or pick a sample; plain-language result, editable fields, live checks, save / flag / CSV |
| Receipt inbox (`/queue/`) | The 100 sample receipts with status, filters and CSV export |
| Filing search (`/search/`) | 150 FinanceBench questions: top evidence pages and a page viewer with highlights |

**Under the hood** (for technical readers)

| Screen | What it does |
|---|---|
| Model results (`/results/`) | Headline results, retrieval ladder, training curve, vector-store benchmark |
| Before vs after (`/receipts/`) | Each test receipt: fine-tuned vs before fine-tuning vs human label, and how the checker picked its reading |
| Compare search methods (`/compare/`) | The same question under BM25, dense, hybrid, routing and reranking, side by side |

**Live reading.** The scan page calls the FastAPI reader (`python -m sumproof.api`, see `scripts/serve.sh`) when the site runs on localhost, or at `NEXT_PUBLIC_SUMPROOF_API` when that is set at build time. Without it, the page offers the samples only, so the public site never contacts a visitor's machine.

The accounting checker runs in the browser (`src/lib/consistency.ts`), a port of the Python checker; `node scripts/parity.ts` confirms they agree on all 277 rule results of the test set.

## Data

`public/data/` is generated from the evaluation outputs, never edited by hand:

```bash
python -m sumproof.export_web      # from the repository root
```

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in out/
```

## Deploy on Vercel

Import the GitHub repository, set **Root Directory** to `web`, keep the Next.js preset, and deploy. The site is fully static (`output: "export"`), so the free Hobby plan is enough.

