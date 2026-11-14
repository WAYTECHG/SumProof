# SumProof web interface

Next.js 15 + TypeScript + Tailwind CSS. A static explorer of the real evaluation results, deployable for free on Vercel.

| Screen | What it does |
|---|---|
| Overview | Headline results, retrieval ladder, training curve, vector-store benchmark |
| Receipt checker | Photo, the model's reading (fine-tuned / before fine-tuning / human label), editable fields, live accounting checks, approve or send to review |
| Review queue | All 100 test receipts with status, filters and CSV export |
| Filing search | 150 FinanceBench questions: router output, top evidence pages, page viewer with highlights |
| Compare methods | The same question under BM25, dense, hybrid, routing and reranking, side by side |

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

`?theme=light` or `?theme=dark` in any URL sets the theme, which is handy for screenshots.
