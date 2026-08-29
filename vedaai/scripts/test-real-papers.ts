import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assignAnswerIds } from "../lib/extract-batch";
import { extractQuestionsFromFullPage } from "../lib/extract-questions-split";
import {
  stitchAnswerContinuations,
  stitchQuestionContinuations,
} from "../lib/continuation-stitching";
import {
  extractAnswersFromPage,
  isGeminiRateLimitError,
} from "../lib/gemini";
import { mapAnswersToQuestions } from "../lib/matching";
import {
  analyzePin2Split,
  printPin2SplitReport,
} from "./check-pin2-split";
import type { Answer, ExtractPageInput, ExtractWarning, PageTextItem, Question } from "../lib/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = resolve(ROOT, "..");
const ASSETS = resolve(ROOT, "test-assets");
const RASTER_DIR = resolve(ASSETS, "real-pipeline");
const QP_PDF = resolve(WORKSPACE, "question_paper.pdf");
const AS_PDF = resolve(WORKSPACE, "answer_sheet.pdf");

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

function rasterizePdf(pdfPath: string, prefix: string): ExtractPageInput[] {
  mkdirSync(RASTER_DIR, { recursive: true });
  const py = [
    "import json, glob, os, sys",
    "import fitz",
    "pdf, out_dir, prefix = sys.argv[1], sys.argv[2], sys.argv[3]",
    "for old in glob.glob(os.path.join(out_dir, prefix + '-page*.jpg')):",
    "    os.remove(old)",
    "for old in glob.glob(os.path.join(out_dir, prefix + '-page*-text.json')):",
    "    os.remove(old)",
    "doc = fitz.open(pdf)",
    "paths = []",
    "for i, page in enumerate(doc, 1):",
    "    max_edge = max(page.rect.width, page.rect.height)",
    "    zoom = min(2048 / max_edge, 2.0)",
    "    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)",
    "    dest = os.path.join(out_dir, f'{prefix}-page{i}.jpg')",
    "    pix.save(dest, jpg_quality=85)",
    "    h = float(page.rect.height)",
    "    items = []",
    "    for block in page.get_text('dict').get('blocks', []):",
    "        if block.get('type', 0) != 0: continue",
    "        for line in block.get('lines', []):",
    "            bbox = line.get('bbox') or [0, 0, 0, 0]",
    "            text = ''.join(span.get('text', '') for span in line.get('spans', [])).strip()",
    "            if not text: continue",
    "            items.append({'text': text, 'y': bbox[1] / h if h else 0})",
    "    with open(dest.replace('.jpg', '-text.json'), 'w') as f:",
    "        json.dump(items, f)",
    "    paths.append(dest)",
    "print('\\n'.join(paths))",
  ].join("\n");

  const stdout = execFileSync("python3", ["-c", py, pdfPath, RASTER_DIR, prefix], {
    encoding: "utf8",
  });
  const paths = stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  return paths.map((filePath, index) => {
    const textPath = filePath.replace(/\.jpg$/i, "-text.json");
    let textItems: PageTextItem[] | undefined;
    if (existsSync(textPath)) {
      const parsed: unknown = JSON.parse(readFileSync(textPath, "utf8"));
      if (Array.isArray(parsed)) {
        textItems = parsed.filter(
          (item): item is PageTextItem =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as PageTextItem).text === "string" &&
            typeof (item as PageTextItem).y === "number",
        );
      }
    }
    return {
      pageNumber: index + 1,
      imageBase64: `data:image/jpeg;base64,${readFileSync(filePath).toString("base64")}`,
      ...(textItems && textItems.length > 0 ? { textItems } : {}),
    };
  });
}

function label(q: Question): string {
  return q.subPart ? `${q.displayNumber}(${q.subPart})` : q.displayNumber;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractPageWithRetry<T>(
  kind: "questions" | "answers",
  page: ExtractPageInput,
  run: (page: ExtractPageInput) => Promise<T[]>,
): Promise<{ items: T[]; warning?: ExtractWarning }> {
  // lib/gemini.ts already waits 20s/40s on the same model before falling
  // through the three-model chain. One extra outer attempt covers a full-chain
  // 429 without stacking six long sleeps on top of that.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const items = await run(page);
      console.log(
        `[real-papers] ${kind} page ${page.pageNumber} ok (${items.length} items, attempt ${attempt})`,
      );
      return { items };
    } catch (error) {
      const rateLimited = isGeminiRateLimitError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (!rateLimited || attempt === maxAttempts) {
        console.warn(
          `[real-papers] ${kind} page ${page.pageNumber} failed: ${message}`,
        );
        return {
          items: [],
          warning: { page: page.pageNumber, message },
        };
      }
      const waitMs = 20_000;
      console.warn(
        `[real-papers] ${kind} page ${page.pageNumber} 429 after model chain — waiting ${waitMs / 1000}s then retry ${attempt + 1}/${maxAttempts}`,
      );
      await sleep(waitMs);
    }
  }
  return {
    items: [],
    warning: { page: page.pageNumber, message: "exhausted retries" },
  };
}

function answerPreview(answer: Answer | null): string {
  if (!answer) return "";
  const text = answer.text.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 140);
  return answer.regions.length ? "(diagram/empty text)" : "";
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }
  if (!existsSync(QP_PDF) || !existsSync(AS_PDF)) {
    throw new Error(`Expected ${QP_PDF} and ${AS_PDF}`);
  }

  console.log("[real-papers] rasterizing question_paper.pdf and answer_sheet.pdf…");
  const questionPages = rasterizePdf(QP_PDF, "qp");
  const answerPages = rasterizePdf(AS_PDF, "as");
  console.log(
    `[real-papers] pages: question paper=${questionPages.length} answer sheet=${answerPages.length}`,
  );

  const started = Date.now();
  console.log("[real-papers] extracting sequentially (1 page at a time) to avoid 429s…");

  const questions: Question[] = [];
  const questionWarnings: ExtractWarning[] = [];
  for (const page of questionPages) {
    const result = await extractPageWithRetry(
      "questions",
      page,
      extractQuestionsFromFullPage,
    );
    questions.push(...result.items);
    if (result.warning) questionWarnings.push(result.warning);
    await sleep(4000);
  }

  const answersRaw: Answer[] = [];
  const answerWarnings: ExtractWarning[] = [];
  for (const page of answerPages) {
    const result = await extractPageWithRetry(
      "answers",
      page,
      (p) => extractAnswersFromPage(p.imageBase64, p.pageNumber),
    );
    answersRaw.push(...result.items);
    if (result.warning) answerWarnings.push(result.warning);
    await sleep(4000);
  }

  const qExtract = {
    questions: stitchQuestionContinuations(questions),
    warnings: questionWarnings,
  };
  const aExtract = {
    answers: assignAnswerIds(stitchAnswerContinuations(answersRaw)),
    warnings: answerWarnings,
  };
  console.log(`[real-papers] extract finished in ${Date.now() - started}ms`);

  const mapping = mapAnswersToQuestions(qExtract.questions, aExtract.answers);
  const statusCounts = mapping.results.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const report = {
    questionPages: questionPages.length,
    answerPages: answerPages.length,
    questions: qExtract.questions,
    answers: aExtract.answers,
    questionWarnings: qExtract.warnings,
    answerWarnings: aExtract.warnings,
    mapping: {
      statusCounts,
      unmatchedAnswers: mapping.unmatchedAnswers.map((item) => ({
        id: item.answer.id,
        detectedQuestionNumber: item.answer.detectedQuestionNumber,
        note: item.note,
        text: item.answer.text,
        pages: item.answer.regions.map((region) => region.page),
      })),
      results: mapping.results.map((item) => ({
        id: item.question.id,
        label: label(item.question),
        section: item.question.section,
        maxMarks: item.question.maxMarks ?? null,
        status: item.status,
        matchConfidence: item.matchConfidence,
        flagged: item.flagged ?? null,
        questionText: item.question.text,
        detectedQuestionNumber: item.answer?.detectedQuestionNumber ?? null,
        answerText: item.answer?.text ?? null,
        answerPages: item.answer?.regions.map((region) => region.page) ?? [],
      })),
    },
  };

  mkdirSync(ASSETS, { recursive: true });
  const outPath = resolve(ASSETS, "output-real-pipeline.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== QUESTIONS ===");
  for (const q of qExtract.questions) {
    const marks = q.maxMarks == null ? "no marks" : `${q.maxMarks} marks`;
    console.log(
      `p${q.page} ${label(q)} [${q.section ?? "—"}] (${marks}) ${q.text.replace(/\s+/g, " ").slice(0, 110)}`,
    );
  }
  if (qExtract.warnings.length) {
    console.log("question warnings:", qExtract.warnings);
  }

  console.log("\n=== ANSWERS ===");
  for (const a of aExtract.answers) {
    const pages = a.regions.map((r) => r.page).join(",");
    console.log(
      `${a.id} Q=${a.detectedQuestionNumber ?? "unlabeled"} conf=${a.confidence} pages=${pages} crossed=${Boolean(a.isCrossedOut)} ${answerPreview(a)}`,
    );
  }
  if (aExtract.warnings.length) {
    console.log("answer warnings:", aExtract.warnings);
  }

  console.log("\n=== MAPPING (filled vs empty) ===");
  console.log("status counts:", statusCounts);
  for (const item of mapping.results) {
    const filled = item.answer ? "FILLED" : "EMPTY";
    console.log(
      `${filled.padEnd(6)} ${label(item.question).padEnd(12)} ${item.status.padEnd(22)} conf=${item.matchConfidence} ans#=${item.answer?.detectedQuestionNumber ?? "—"} ${answerPreview(item.answer)}`,
    );
  }

  if (mapping.unmatchedAnswers.length) {
    console.log("\n=== UNMATCHED ANSWERS (not mapped to any question) ===");
    for (const item of mapping.unmatchedAnswers) {
      console.log(
        `${item.answer.id} Q=${item.answer.detectedQuestionNumber} ${item.note ?? ""} ${answerPreview(item.answer)}`,
      );
    }
  }

  const empty = mapping.results.filter((item) => !item.answer);
  const filled = mapping.results.filter((item) => item.answer);
  console.log(
    `\n[real-papers] ${qExtract.questions.length} questions, ${aExtract.answers.length} answers, ${filled.length} filled, ${empty.length} empty, ${mapping.unmatchedAnswers.length} unmatched leftovers`,
  );
  console.log(`[real-papers] JSON written to ${outPath}`);

  printPin2SplitReport(
    analyzePin2Split(qExtract.questions, aExtract.answers, mapping.results),
  );
}

main().catch((error) => {
  console.error("[real-papers] Failed:", error);
  process.exit(1);
});
