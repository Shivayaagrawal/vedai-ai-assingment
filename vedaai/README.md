# VedaAI

Upload a question paper and answer sheet, extract questions and handwritten answers with Gemini, map them, and grade on demand.

## Setup

```bash
cd vedaai
npm install
cp .env.example .env.local
```

Set `GEMINI_API_KEY` in `.env.local`. Optional extras: `GEMINI_API_KEY_2`, `_3`, `_4` — on 429 the server tries the next key. Then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

The browser rasterizes PDFs to JPEG page images (`pdf.js`, max edge 2048px, quality 0.85) and POSTs them as JSON to `/api/extract-questions` and `/api/extract-answers` in parallel. Mapping runs client-side. Grading auto-starts on the results screen (`POST /api/grade`) and sends the relevant answer-sheet page images with the text. API routes use `maxDuration = 300`.

## Known limitations

- **Rasterized payload vs Vercel body limit (one constraint, two ways it shows up).** Extract sends every page as base64 in one JSON body. Vercel serverless requests are typically capped around **4.5MB**. Measured with `npm run measure:payload` (`sample-clean.png` → JPEG q=0.85):
  - Clean / vector-drawn fixture at 2048px max edge: **1 page 0.16MB, 8 pages 1.26MB, 20 pages 3.14MB** (all under 4.5MB). Printed PDFs and the Figma 4-page sheet look like this.
  - Photo-scan analogue (same raster + noise): **1 page 1.19MB, 3 pages 3.57MB, 5 pages 5.94MB (over)**. The **8-page cap does not protect this case** — a 5-page phone photo of lined paper can 413 on Vercel while a 8-page vector PDF is fine. Pending real pen-photo testing; chunking would be the follow-up if that becomes the demo path.
  - Parallel Q+A is two separate requests; each body must stay under 4.5MB on its own.
  - **Decision:** hard **8-page cap** per upload (client `FileDropzone` + both `/api/extract-questions` and `/api/extract-answers` via `parseExtractPagesBody`), not chunked extract.
- **Empty extraction UI is inferred** (not in the Figma screenshots). Zero questions, zero answers, or both get a dedicated message and “Try a different file”; partial unanswered/unmatched lists stay on the normal two-pane view.
- **No marking scheme.** Grades use each question's printed maxMarks (e.g. 2/2, 0/2). Omitted marks still default to 10.
- **Gemini answer `confidence` is not used for mapping.** Low-confidence status comes from match heuristics (duplicate numbers, unlabeled positional fallback with Jaccard topic overlap then paper order).
- **Mislabeled student numbers** (wrote “5” on question 4) are not detected.
- **Labeled crossed-out vs nearby unlabeled rewrite** (the Q7 case): matching prefers the labeled block; it will not reassign a clean unlabeled rewrite to that number.
- **Diagram answers** are graded from the answer-sheet image when a region exists. Empty text with no region stays `not-gradable`.
- **Ambiguous question continuations** (`needsReview`) are left standalone and excluded from model grading.

Dropzone empty copy stays **Max 10MB** to match the Figma upload screens; oversize page count shows as an inline error after file inspect.
