import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as gradePOST } from "../app/api/grade/route";
import { gradeAnswers } from "../lib/gemini";
import { collectGradePairs } from "../lib/grading";
import { mapAnswersToQuestions } from "../lib/matching";
import type { Answer, Question } from "../lib/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function answer(partial: Partial<Answer> & Pick<Answer, "id">): Answer {
  return {
    detectedQuestionNumber: partial.detectedQuestionNumber ?? null,
    text: partial.text ?? "",
    regions: partial.regions ?? [
      { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
    ],
    confidence: partial.confidence ?? 0.97,
    ...partial,
  };
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }

  const raw = JSON.parse(
    readFileSync(resolve(ROOT, "test-assets/output-questions.json"), "utf8"),
  ) as { page1: Question[]; page2: Question[] };
  const questions = [...raw.page1, ...raw.page2];

  const answers: Answer[] = [
    answer({
      id: "a-q1-p1",
      detectedQuestionNumber: "1",
      text: "Velocity is the rate of change of displacement.",
      regions: [{ page: 1, x: 0.1, y: 0.15, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-q2",
      detectedQuestionNumber: "2",
      text: "Ohm's law: V = IR",
      regions: [{ page: 1, x: 0.1, y: 0.25, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-q5",
      detectedQuestionNumber: "5",
      text: "An atom has a nucleus of protons and neutrons, with electrons in shells around it.",
      regions: [{ page: 1, x: 0.1, y: 0.4, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-8ai",
      detectedQuestionNumber: "8(a)(i)",
      text: "A covalent bond is a shared pair of electrons between atoms.",
      regions: [{ page: 1, x: 0.1, y: 0.55, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-8aii",
      detectedQuestionNumber: "8a(ii)",
      text: "Water / H2O",
      regions: [{ page: 1, x: 0.1, y: 0.65, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-11a",
      detectedQuestionNumber: "11a",
      text: "carbon dioxide + water → glucose + oxygen",
      regions: [{ page: 1, x: 0.1, y: 0.8, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-11b",
      detectedQuestionNumber: "11 (b)",
      text: "light intensity and carbon dioxide concentration",
      regions: [{ page: 2, x: 0.1, y: 0.1, width: 0.7, height: 0.1 }],
    }),
    answer({
      id: "a-q1-p2",
      detectedQuestionNumber: "1",
      text: "mitochondria",
      regions: [{ page: 2, x: 0.1, y: 0.35, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-q3-crossed",
      detectedQuestionNumber: "3",
      text: "Osmosis is the diffusion of water.",
      isCrossedOut: true,
      regions: [{ page: 2, x: 0.1, y: 0.55, width: 0.7, height: 0.08 }],
    }),
    answer({
      id: "a-orphan",
      detectedQuestionNumber: "99",
      text: "should never be graded",
      regions: [{ page: 2, x: 0.1, y: 0.9, width: 0.4, height: 0.05 }],
    }),
  ];

  const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, answers);
  const { pairs, skipped } = collectGradePairs(results);

  console.log("[test-phase5] mapped", results.length, "questions");
  console.log("[test-phase5] gradable pairs", pairs.length);
  console.log("[test-phase5] skipped", skipped);
  console.log(
    "[test-phase5] unmatchedAnswers",
    unmatchedAnswers.map((u) => ({
      id: u.answer.id,
      note: u.note,
      text: u.answer.text,
    })),
  );

  const started = Date.now();
  const grades = await gradeAnswers(pairs);
  console.log(`[test-phase5] live gradeAnswers in ${Date.now() - started}ms`);

  for (const grade of grades) {
    const pair = pairs.find((p) => p.questionId === grade.questionId);
    console.log("\n---", grade.questionId, "---");
    console.log("confidence", pair?.matchConfidence, "flagged", pair?.flagged);
    console.log(grade.verdict, grade.score, "/", grade.maxScore);
    console.log(grade.feedback);
  }

  const ids = grades.map((g) => g.questionId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("duplicate questionId in live grades");
  }
  if (ids.length !== pairs.length) {
    throw new Error("live grades dropped a pair");
  }
  if (grades.some((g) => g.questionId === "a-orphan" || /should never be graded/.test(g.feedback))) {
    throw new Error("leftover unmatched answer was graded");
  }

  const crossed = grades.find(
    (g) => g.questionId === "section-c-biology-continued-3",
  );
  if (!crossed || !/crossed out/i.test(crossed.feedback)) {
    throw new Error("crossed-out live feedback did not mention crossed out");
  }

  const low = grades.find((g) => g.questionId === "section-a-physics-1");
  if (!low || !/low-confidence|wrong question|may be wrong/i.test(low.feedback)) {
    throw new Error("duplicate-Q1 low-confidence live feedback was not hedged");
  }

  const blank = await gradePOST(
    new Request("http://localhost/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: questions.map((q) => ({
          question: q,
          answer: null,
          status: "unanswered",
          matchConfidence: 0,
        })),
      }),
    }),
  );
  const blankJson = (await blank.json()) as {
    grades: unknown[];
    skipped: unknown[];
  };
  if (blank.status !== 200 || blankJson.grades.length !== 0) {
    throw new Error("zero-pairs route did not return empty grades");
  }
  if (blankJson.skipped.length !== questions.length) {
    throw new Error("zero-pairs skipped list incomplete");
  }
  console.log("\n[test-phase5] blank sheet → empty grades, skipped", blankJson.skipped.length);
  if (pairs.length > 8) {
    console.log(
      `[test-phase5] paper had ${pairs.length} gradable pairs so live grading used ${Math.ceil(pairs.length / 8)} Gemini batches`,
    );
  }

  console.log("\n[test-phase5] PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
