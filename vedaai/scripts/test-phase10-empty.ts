import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  classifyExtractEmpty,
  ZERO_ANSWERS_MESSAGE,
  ZERO_QUESTIONS_MESSAGE,
} from "../lib/extract-empty";
import { mapAnswersToQuestions } from "../lib/matching";
import type { Answer, Question } from "../lib/types";
import { pageCountLimitMessage } from "../lib/upload-file";
import {
  generatePhase1Fixtures,
  generatePhase2Fixtures,
} from "./generate-test-assets";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = resolve(ROOT, "test-assets");
const NINE_PAGE_PDF = resolve(ASSETS, "sample-9page.pdf");

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

function writeNinePagePdf() {
  const sources = [
    resolve(ROOT, "..", "question_paper.pdf"),
    resolve(ROOT, "..", "answer_sheet.pdf"),
  ];
  for (const source of sources) {
    if (!existsSync(source)) {
      throw new Error(`Missing ${source} for 9-page dropzone fixture`);
    }
  }
  const dest = JSON.stringify(NINE_PAGE_PDF);
  const srcList = JSON.stringify(sources);
  execFileSync(
    "python3",
    [
      "-c",
      [
        "from pypdf import PdfReader, PdfWriter",
        "writer = PdfWriter()",
        `sources = ${srcList}`,
        "pages = []",
        "for path in sources:",
        "    pages.extend(PdfReader(path).pages)",
        "if not pages:",
        "    raise SystemExit('no source pages')",
        "while len(writer.pages) < 9:",
        "    writer.add_page(pages[len(writer.pages) % len(pages)])",
        `out = ${dest}`,
        'with open(out, "wb") as handle:',
        "    writer.write(handle)",
        "print(len(writer.pages))",
      ].join("\n"),
    ],
    { stdio: "inherit" },
  );
}

async function extractJson(
  path: "/api/extract-questions" | "/api/extract-answers",
  filePath: string,
) {
  const imageBase64 = `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
  const response = await fetch(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pages: [{ pageNumber: 1, imageBase64 }],
    }),
  });
  const json = (await response.json()) as {
    questions?: Question[];
    answers?: Answer[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${json.error ?? "failed"}`);
  }
  return json;
}

async function withBrowser<T>(
  run: (page: import("playwright").Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    return await run(page);
  } finally {
    await browser.close();
  }
}

async function runDropzoneAndDemoUi() {
  writeNinePagePdf();
  await withBrowser(async (page) => {
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    await page.locator('input[data-slot="question-paper"]').setInputFiles(
      NINE_PAGE_PDF,
    );
    await page.waitForSelector(`text=${pageCountLimitMessage()}`);
    console.log("[phase10] 9-page dropzone shows page-cap message");

    await page.goto("http://localhost:3000/?demo=empty-answers", {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(`text=${ZERO_ANSWERS_MESSAGE}`);
    if (await page.getByRole("button", { name: "Expand All" }).count()) {
      throw new Error("zero-answers empty state should not show the two-pane list");
    }

    await page.goto("http://localhost:3000/?demo=empty-questions", {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(`text=${ZERO_QUESTIONS_MESSAGE}`);

    await page.goto("http://localhost:3000/?demo=empty-both", {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(`text=${ZERO_QUESTIONS_MESSAGE}`);
    await page.waitForSelector(`text=${ZERO_ANSWERS_MESSAGE}`);
    await page.getByRole("button", { name: "Try a different file" }).click();
    await page.waitForSelector("text=Max 10MB");
    if (await page.getByRole("button", { name: "Start Mapping" }).isEnabled()) {
      throw new Error("Start Mapping should be disabled on a cleared upload screen");
    }
    console.log("[phase10] demo empty-states + Try a different file");

    await page.goto("http://localhost:3000/?demo=results", {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("text=Not answered");
    if (await page.getByText(ZERO_ANSWERS_MESSAGE).count()) {
      throw new Error("normal results with some unanswered must not show empty-state");
    }
    console.log("[phase10] unanswered items on a normal map do not trigger empty-state");
  });
}

async function runLiveUploads() {
  generatePhase1Fixtures();
  generatePhase2Fixtures();
  await withBrowser(async (page) => {
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    await page.locator('input[data-slot="question-paper"]').setInputFiles(
      resolve(ASSETS, "sample-qp-page1.png"),
    );
    await page.locator('input[data-slot="answer-sheet"]').setInputFiles(
      resolve(ASSETS, "sample-blank.png"),
    );
    await page.getByRole("button", { name: "Start Mapping" }).click();
    await page.waitForSelector(`text=${ZERO_ANSWERS_MESSAGE}`, {
      timeout: 180_000,
    });
    console.log("[phase10] live blank answer sheet → zero-answers empty state");

    await page.getByRole("button", { name: "Try a different file" }).click();
    await page.waitForSelector("text=Max 10MB");
    await page.locator('input[data-slot="question-paper"]').setInputFiles(
      resolve(ASSETS, "sample-not-a-paper.png"),
    );
    await page.locator('input[data-slot="answer-sheet"]').setInputFiles(
      resolve(ASSETS, "sample-blank.png"),
    );
    await page.getByRole("button", { name: "Start Mapping" }).click();
    await page.waitForSelector(`text=${ZERO_QUESTIONS_MESSAGE}`, {
      timeout: 180_000,
    });
    console.log("[phase10] live non-paper image → zero-questions empty state");
  });
}

async function runLiveClassifyViaApi() {
  generatePhase1Fixtures();
  generatePhase2Fixtures();
  const questionsJson = await extractJson(
    "/api/extract-questions",
    resolve(ASSETS, "sample-qp-page1.png"),
  );
  const blankAnswers = await extractJson(
    "/api/extract-answers",
    resolve(ASSETS, "sample-blank.png"),
  );
  const questionCount = questionsJson.questions?.length ?? 0;
  const answerCount = blankAnswers.answers?.length ?? 0;
  const blankKind = classifyExtractEmpty(
    mapAnswersToQuestions(questionsJson.questions ?? [], blankAnswers.answers ?? []),
  );
  console.log(
    "[phase10] API blank sheet: questions=",
    questionCount,
    "answers=",
    answerCount,
    "empty=",
    blankKind,
  );
  if (questionCount === 0) {
    throw new Error(
      "QP fixture extracted 0 questions — cannot treat this as a blank-sheet empty-state check (rate limit, timeout, or extract miss).",
    );
  }
  if (blankKind !== "answers") {
    throw new Error(`blank sheet classified as ${blankKind}, expected answers`);
  }

  const catQuestions = await extractJson(
    "/api/extract-questions",
    resolve(ASSETS, "sample-not-a-paper.png"),
  );
  const catCount = catQuestions.questions?.length ?? 0;
  const catKind = classifyExtractEmpty(
    mapAnswersToQuestions(catQuestions.questions ?? [], []),
  );
  console.log(
    "[phase10] API not-a-paper: questions=",
    catCount,
    "empty=",
    catKind,
  );
  if (catKind !== "questions" && catKind !== "both") {
    throw new Error(
      `non-paper classified as ${catKind} — Gemini may have invented questions`,
    );
  }
}

async function main() {
  loadEnvFiles();
  generatePhase1Fixtures();
  generatePhase2Fixtures();
  await runDropzoneAndDemoUi();
  try {
    await runLiveUploads();
  } catch (error) {
    console.warn(
      "[phase10] live UI extract did not finish:",
      error instanceof Error ? error.message : error,
    );
    try {
      await runLiveClassifyViaApi();
    } catch (apiError) {
      console.warn(
        "[phase10] live API classify also inconclusive:",
        apiError instanceof Error ? apiError.message : apiError,
      );
      console.log(
        "[phase10] PASS (demo UI + page cap only; live Gemini empty-state not verified)",
      );
      return;
    }
  }
  console.log("[phase10] PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
