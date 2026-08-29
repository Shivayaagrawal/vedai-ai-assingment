/**
 * Isolates whether the page-2 question dropout (8(b), Section B Q1/Q2, Q9, Q10)
 * is a rendering crop or a Gemini skip of a dense full page.
 *
 * Uses the same PyMuPDF rasterizer as scripts/test-real-papers.ts — that is
 * the image the failing extract actually sent. pdf-to-images.ts is
 * browser-only and is not on this Node path.
 *
 * Usage (from vedaai/):
 *   npx tsx scripts/diagnose-page2.ts
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";
import {
  extractQuestionsFromPageRaw,
  parseQuestionsJson,
} from "../lib/gemini";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = resolve(ROOT, "..");
const OUT_DIR = resolve(ROOT, "test-assets/diagnostics");
const QP_PDF = resolve(WORKSPACE, "question_paper.pdf");

function loadEnvFiles() {
  for (const filename of [".env.local", ".env"]) {
    const filePath = resolve(ROOT, filename);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

type RasterMeta = {
  pageNumber: number;
  pdfWidthPt: number;
  pdfHeightPt: number;
  zoom: number;
  expectedPxW: number;
  expectedPxH: number;
  pixmapW: number;
  pixmapH: number;
  dest: string;
  pdfText: string;
};

function rasterizeQuestionPaperPage2(): RasterMeta {
  mkdirSync(OUT_DIR, { recursive: true });
  const dest = resolve(OUT_DIR, "page2-rendered.jpg");
  const metaPath = resolve(OUT_DIR, "page2-render-meta.json");
  const py = [
    "import json, os, sys",
    "import fitz",
    "pdf_path, dest, meta_path = sys.argv[1], sys.argv[2], sys.argv[3]",
    "doc = fitz.open(pdf_path)",
    "if doc.page_count < 2:",
    "    raise SystemExit(f'Expected at least 2 pages, got {doc.page_count}')",
    "page = doc[1]",
    "rect = page.rect",
    "max_edge = max(rect.width, rect.height)",
    "zoom = min(2048 / max_edge, 2.0)",
    "pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)",
    "pix.save(dest, jpg_quality=85)",
    "meta = {",
    "  'pageNumber': 2,",
    "  'pdfWidthPt': rect.width,",
    "  'pdfHeightPt': rect.height,",
    "  'zoom': zoom,",
    "  'expectedPxW': round(rect.width * zoom),",
    "  'expectedPxH': round(rect.height * zoom),",
    "  'pixmapW': pix.width,",
    "  'pixmapH': pix.height,",
    "  'dest': dest,",
    "  'pdfText': page.get_text(),",
    "}",
    "with open(meta_path, 'w') as f:",
    "    json.dump(meta, f)",
  ].join("\n");

  execFileSync("python3", ["-c", py, QP_PDF, dest, metaPath], {
    encoding: "utf8",
  });
  return JSON.parse(readFileSync(metaPath, "utf8")) as RasterMeta;
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }
  if (!existsSync(QP_PDF)) {
    throw new Error(`Expected question paper at ${QP_PDF}`);
  }

  console.log("Rasterizing question_paper.pdf page 2 (same zoom as test-real-papers)…");
  const meta = rasterizeQuestionPaperPage2();
  const imgPath = meta.dest;
  const bytes = readFileSync(imgPath);
  const image = await loadImage(bytes);

  const heightMismatch = Math.abs(meta.pixmapH - meta.expectedPxH);
  const widthMismatch = Math.abs(meta.pixmapW - meta.expectedPxW);
  console.log(`Saved rendered page 2 to: ${imgPath}`);
  console.log(
    `PDF page ${meta.pdfWidthPt.toFixed(1)}×${meta.pdfHeightPt.toFixed(1)} pt, zoom=${meta.zoom.toFixed(4)}`,
  );
  console.log(
    `Expected ${meta.expectedPxW}×${meta.expectedPxH}px, pixmap ${meta.pixmapW}×${meta.pixmapH}px, decoded ${image.width}×${image.height}px`,
  );
  if (heightMismatch > 2 || widthMismatch > 2) {
    console.log(
      "WARNING: pixmap size does not match zoom×page.rect — possible crop/scale bug in the rasterizer.",
    );
  } else {
    console.log(
      "Pixmap size matches zoom×page.rect (no canvas-height crop at the PyMuPDF step).",
    );
  }

  const pdfTextPath = resolve(OUT_DIR, "page2-pdf-text.txt");
  writeFileSync(pdfTextPath, meta.pdfText);
  console.log(`Saved PDF-embedded text (ground truth of page 2) to: ${pdfTextPath}`);

  const missingNeedles = [
    "8(b)",
    "(b)",
    "Section B",
    "powerhouse",
    "mitochondria",
    "photosynthesis",
    "Q9",
    "9.",
    "plant",
    "animal",
    "Q10",
    "10.",
    "Fe2O3",
    "Fe₂O₃",
  ];
  const pdfLower = meta.pdfText.toLowerCase();
  const inPdf = missingNeedles.filter((n) =>
    pdfLower.includes(n.toLowerCase()),
  );
  console.log(
    `Needles in PDF text layer: ${inPdf.length ? inPdf.join(", ") : "(none — scanned page or missing text layer)"}`,
  );
  console.log(
    "Open page2-rendered.jpg now. If 8(b), Section B, Q9, Q10 are visible in the JPEG, rendering is fine.",
  );

  console.log("\nCalling Gemini on that exact JPEG, capturing RAW pre-parse text…");
  const imageBase64 = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  const rawText = await extractQuestionsFromPageRaw(imageBase64);
  const rawPath = resolve(OUT_DIR, "page2-raw-response.txt");
  writeFileSync(rawPath, rawText);
  console.log(`Saved raw Gemini response to: ${rawPath} (${rawText.length} chars)`);

  const parsed = parseQuestionsJson(rawText, 2);
  const parsedPath = resolve(OUT_DIR, "page2-parsed.json");
  writeFileSync(parsedPath, JSON.stringify(parsed, null, 2));
  console.log(
    `Parsed ${parsed.length} questions. Labels: ${parsed
      .map((q) => (q.subPart ? `${q.displayNumber}(${q.subPart})` : q.displayNumber))
      .join(", ")}`,
  );

  const rawLower = rawText.toLowerCase();
  const foundInRaw = missingNeedles.filter((n) =>
    rawLower.includes(n.toLowerCase()),
  );
  const expectedMissing = ["8(b)", "powerhouse", "photosynthesis", "plant", "Fe2O3", "Fe₂O₃"];
  const stillMissing = expectedMissing.filter(
    (n) => !rawLower.includes(n.toLowerCase()),
  );

  console.log("\n--- Verdict ---");
  if (foundInRaw.length === 0) {
    console.log(
      "None of the missing items' text appears in Gemini's raw response.\n" +
        "If the JPEG contains that content: MODEL DROPOUT (lost-in-the-middle). " +
        "Fix: split page 2 into vertical halves, or send a higher-res crop of the top half.",
    );
  } else if (stillMissing.length && parsed.length < 8) {
    console.log(
      `Raw response mentions: ${foundInRaw.join(", ")}\n` +
        `Still absent from raw text: ${stillMissing.join(", ")}\n` +
        "Partial dropout: Gemini saw some of the missing region but did not emit every item.",
    );
  } else if (parsed.length < 8) {
    console.log(
      `Found mentions in raw: ${foundInRaw.join(", ")}\n` +
        "Content is in the raw text but not in the parsed array — look at JSON parse / fence stripping / truncated array.",
    );
  } else {
    console.log(
      `Raw mentions: ${foundInRaw.join(", ")}. Parsed count ${parsed.length} — page 2 may already be complete on this run.`,
    );
  }

  console.log(
    "\nCompare page2-rendered.jpg visually against page2-raw-response.txt before changing the prompt.",
  );
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
