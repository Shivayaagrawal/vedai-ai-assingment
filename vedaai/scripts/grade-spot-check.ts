/**
 * Grades the real question_paper / answer_sheet mapping (from the saved
 * extract dump) and checks three things synthetic Phase 5 never covered:
 *   1. Merged multi-page Q12 (joined text + two regions) is not forced
 *      to not-gradable.
 *   2. needsReview rows are excluded from collectGradePairs.
 *   3. Duplicate Q1s (A1 inertia vs B1 mitochondria) are graded against
 *      their own question text.
 *
 * Usage (from vedaai/):
 *   npx tsx scripts/grade-spot-check.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stitchAnswerContinuations,
  stitchQuestionContinuations,
} from "../lib/continuation-stitching";
import { gradeAnswers } from "../lib/gemini";
import { collectGradePairs } from "../lib/grading";
import { mapAnswersToQuestions } from "../lib/matching";
import type { Answer, Question } from "../lib/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DUMP_PATH = resolve(ROOT, "test-assets/output-real-pipeline.json");
const OUT_PATH = resolve(
  ROOT,
  "test-assets/diagnostics/grade-spot-check-results.json",
);
const MANIFEST_CANDIDATES = [
  resolve(ROOT, "test_case_manifest.md"),
  resolve(ROOT, "../test_case_manifest.md"),
  resolve(ROOT, "test-assets/test_case_manifest.md"),
];

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

function findManifest(): string | null {
  return MANIFEST_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

function loadMappedFromDump() {
  if (!existsSync(DUMP_PATH)) {
    throw new Error(
      `Missing ${DUMP_PATH}. Run npx tsx scripts/test-real-papers.ts first.`,
    );
  }
  const raw = JSON.parse(readFileSync(DUMP_PATH, "utf8")) as {
    questions: Question[];
    answers: Answer[];
  };
  if (!Array.isArray(raw.questions) || !Array.isArray(raw.answers)) {
    throw new Error("Dump must include questions[] and answers[]");
  }
  const questions = stitchQuestionContinuations(raw.questions);
  const answers = stitchAnswerContinuations(raw.answers);
  return mapAnswersToQuestions(questions, answers);
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }

  const mapping = loadMappedFromDump();
  const { pairs, skipped } = collectGradePairs(mapping.results);

  const excludedForReview = skipped.filter((item) =>
    /needsReview/.test(item.reason),
  );
  const excludedOther = skipped.filter(
    (item) => !/needsReview/.test(item.reason),
  );

  console.log(`Total mapped results: ${mapping.results.length}`);
  console.log(
    `Excluded (needsReview, not sent to grading): ${excludedForReview.length}`,
  );
  for (const item of excludedForReview) {
    const q = mapping.results.find((r) => r.question.id === item.questionId);
    console.log(
      `   - ${q?.question.displayNumber ?? item.questionId}${q?.question.subPart ?? ""} (${item.reason})`,
    );
  }
  console.log(
    `Excluded (unanswered / not-attempted / unmatched, expected): ${excludedOther.length}`,
  );
  console.log(`Sending to gradeAnswers: ${pairs.length}\n`);

  const grades = await gradeAnswers(pairs);
  const byQuestionId = new Map(grades.map((grade) => [grade.questionId, grade]));

  const missingIds = pairs
    .map((pair) => pair.questionId)
    .filter((id) => !byQuestionId.has(id));
  console.log("--- Check 1: response completeness ---");
  if (missingIds.length === 0) {
    console.log("OK — every graded pair got a GradeResult back.\n");
  } else {
    console.log(`MISMATCH — missing GradeResults for: ${missingIds.join(", ")}\n`);
  }

  console.log("--- Check 2: Q12 merged-answer grading ---");
  const q12Result = mapping.results.find(
    (item) => item.question.displayNumber === "12" && !item.question.subPart,
  );
  const q12Pair = pairs.find((pair) => pair.questionId === q12Result?.question.id);
  if (!q12Result || !q12Pair || !q12Result.answer) {
    console.log(
      "Q12 not found in gradable input — check it mapped correctly upstream.\n",
    );
  } else {
    const grade = byQuestionId.get(q12Result.question.id);
    console.log(`Q12 answer text sent: "${q12Pair.answerText.slice(0, 160)}"`);
    console.log(
      `Q12 regions: ${q12Result.answer.regions.length} (pages: ${q12Result.answer.regions.map((region) => region.page).join(", ")})`,
    );
    console.log(
      `Q12 verdict: ${grade?.verdict}, score: ${grade?.score}/${grade?.maxScore}`,
    );
    if (
      grade?.verdict === "not-gradable" &&
      q12Pair.answerText.trim().length > 0
    ) {
      console.log(
        "FLAG — verdict is not-gradable despite non-empty joined text.",
      );
    } else if (grade?.verdict && grade.verdict !== "not-gradable") {
      console.log(
        "OK — graded on its merged text rather than defaulting to not-gradable.",
      );
    }
    console.log("");
  }

  console.log("--- Check 3: duplicate-Q1 (A1 vs B1) disambiguation ---");
  const a1 = mapping.results.find(
    (item) =>
      item.question.displayNumber === "1" &&
      /section\s*a/i.test(item.question.section ?? ""),
  );
  const b1 = mapping.results.find(
    (item) =>
      item.question.displayNumber === "1" &&
      /section\s*b/i.test(item.question.section ?? ""),
  );
  if (!a1 || !b1) {
    console.log(
      "Could not find both A1 and B1 in mapped results — check section field.\n",
    );
  } else {
    console.log(`A1 question text: "${a1.question.text.slice(0, 80)}"`);
    console.log(`A1 answer text:   "${(a1.answer?.text ?? "").slice(0, 80)}"`);
    console.log(`B1 question text: "${b1.question.text.slice(0, 80)}"`);
    console.log(`B1 answer text:   "${(b1.answer?.text ?? "").slice(0, 80)}"`);

    const questionsDistinct =
      /inertia/i.test(a1.question.text) &&
      /powerhouse|mitochondri/i.test(b1.question.text);
    if (questionsDistinct) {
      console.log(
        "OK — A1 and B1 were sent with distinct question text (inertia vs powerhouse/mitochondria).",
      );
    } else {
      console.log("FLAG — A1/B1 question texts are not the expected distinct pair.");
    }

    const a1LooksLikeInertia = /inertia/i.test(a1.answer?.text ?? "");
    const b1LooksLikeMitochondria = /mitochondri/i.test(b1.answer?.text ?? "");
    if (a1LooksLikeInertia && b1LooksLikeMitochondria) {
      console.log(
        "OK — A1 has inertia content, B1 has mitochondria content.",
      );
    } else {
      console.log(
        "FLAG — expected A1~inertia and B1~mitochondria in the *answer* text. " +
          "If A1 also contains photosynthesis, that is the remaining Q1 bbox-gluing extraction bug, not a mapping mix-up.",
      );
    }

    const a1Grade = byQuestionId.get(a1.question.id);
    const b1Grade = byQuestionId.get(b1.question.id);
    console.log(
      `A1 verdict: ${a1Grade?.verdict}, score: ${a1Grade?.score}/${a1Grade?.maxScore}`,
    );
    console.log(
      `B1 verdict: ${b1Grade?.verdict}, score: ${b1Grade?.score}/${b1Grade?.maxScore}`,
    );
    console.log("");
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        totalMapped: mapping.results.length,
        excludedForReview: excludedForReview.map((item) => item.questionId),
        skipped,
        gradedCount: pairs.length,
        pairs,
        grades,
      },
      null,
      2,
    ),
  );
  console.log(`Full results saved to: ${OUT_PATH}`);

  const manifest = findManifest();
  if (manifest) {
    console.log(`Diff scores/verdicts against ${manifest} for the remaining spot-check.`);
  } else {
    console.log(
      "No test_case_manifest.md in the repo — compare scores/verdicts against the assignment manifest locally if you have it.",
    );
  }
}

main().catch((error) => {
  console.error("Grading spot-check failed:", error);
  process.exit(1);
});
