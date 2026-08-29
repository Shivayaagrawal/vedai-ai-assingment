import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  answerContinuationKey,
  isNaturalPredecessor,
  stitchAnswerContinuations,
  stitchQuestionContinuations,
} from "./continuation-stitching";
import { questionIdFromParts } from "./gemini";
import { mapAnswersToQuestions } from "./matching";
import type { Answer, Question } from "./types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL = resolve(ROOT, "test-assets/output-real-pipeline.json");

function question(
  partial: Partial<Question> & Pick<Question, "id" | "displayNumber" | "page">,
): Question {
  return {
    text: partial.text ?? `Question ${partial.displayNumber}`,
    ...partial,
  };
}

function region(page: number, y = 0.1): Answer["regions"][number] {
  return { page, x: 0.1, y, width: 0.4, height: 0.2 };
}

function answer(
  partial: Partial<Answer> & Pick<Answer, "id" | "detectedQuestionNumber">,
): Answer {
  return {
    text: partial.text ?? "",
    regions: partial.regions ?? [region(1)],
    confidence: partial.confidence ?? 0.9,
    ...partial,
  };
}

describe("isNaturalPredecessor", () => {
  it("follows a→b and i→ii without treating i as a letter", () => {
    assert.equal(isNaturalPredecessor("a", "b"), true);
    assert.equal(isNaturalPredecessor("b", "c"), true);
    assert.equal(isNaturalPredecessor("a", "c"), false);
    assert.equal(isNaturalPredecessor("i", "ii"), true);
    assert.equal(isNaturalPredecessor("a(i)", "ii"), true);
    assert.equal(isNaturalPredecessor("ii", "iii"), true);
  });
});

describe("stitchQuestionContinuations", () => {
  it("attaches a bare (b) on the next page to the only 8(a) parent", () => {
    const stitched = stitchQuestionContinuations([
      question({
        id: "section-a-8-a",
        displayNumber: "8",
        subPart: "a",
        section: "Section A",
        page: 1,
        text: "Define specific heat capacity.",
      }),
      question({
        id: "continued-b",
        displayNumber: "(b)",
        subPart: "b",
        page: 2,
        text: "Calculate the heat required.",
        maxMarks: 3,
      }),
    ]);
    const eightB = stitched.find((item) => item.subPart === "b");
    assert.ok(eightB);
    assert.equal(eightB.displayNumber, "8");
    assert.equal(eightB.section, "Section A");
    assert.equal(eightB.id, questionIdFromParts("Section A", "8", "b"));
    assert.equal(eightB.needsReview, undefined);
  });

  it("flags needsReview when two a-parts could parent the same (b)", () => {
    const stitched = stitchQuestionContinuations([
      question({
        id: "q8a",
        displayNumber: "8",
        subPart: "a",
        page: 1,
      }),
      question({
        id: "q11a",
        displayNumber: "11",
        subPart: "a",
        page: 1,
      }),
      question({
        id: "cont",
        displayNumber: "(b)",
        subPart: "b",
        page: 2,
      }),
    ]);
    const cont = stitched.find((item) => item.id === "cont");
    assert.equal(cont?.needsReview, true);
    assert.equal(cont?.displayNumber, "(b)");
  });

  it("does not stitch across a skipped page", () => {
    const stitched = stitchQuestionContinuations([
      question({
        id: "q8a",
        displayNumber: "8",
        subPart: "a",
        page: 1,
      }),
      question({
        id: "cont",
        displayNumber: "(b)",
        subPart: "b",
        page: 3,
      }),
    ]);
    assert.equal(stitched[1].needsReview, true);
    assert.equal(stitched[1].displayNumber, "(b)");
  });
});

describe("stitchAnswerContinuations", () => {
  it("merges Q12 and Q12 (contd.) on adjacent pages into one multi-region answer", () => {
    const stitched = stitchAnswerContinuations([
      answer({
        id: "p2",
        detectedQuestionNumber: "Q12",
        text: "mouth oesophagus stomach",
        regions: [region(2, 0.7)],
        confidence: 0.95,
      }),
      answer({
        id: "p3",
        detectedQuestionNumber: "Q12 (contd.)",
        text: "small intestine large intestine",
        regions: [region(3, 0.1)],
        confidence: 0.9,
      }),
    ]);
    assert.equal(stitched.length, 1);
    assert.equal(stitched[0].id, "p2");
    assert.equal(stitched[0].regions.length, 2);
    assert.deepEqual(
      stitched[0].regions.map((item) => item.page),
      [2, 3],
    );
    assert.match(stitched[0].text, /mouth.*small intestine/s);
    assert.equal(stitched[0].confidence, 0.9);
  });

  it("does not merge the same label across a page gap", () => {
    const stitched = stitchAnswerContinuations([
      answer({
        id: "p2",
        detectedQuestionNumber: "Q12",
        regions: [region(2)],
      }),
      answer({
        id: "p4",
        detectedQuestionNumber: "Q12",
        regions: [region(4)],
      }),
    ]);
    assert.equal(stitched.length, 2);
  });

  it("normalizes the dump's exact Q12 labels to the same key", () => {
    // Raw detectedQuestionNumber values from test-assets/output-real-pipeline.json
    assert.equal(answerContinuationKey("Q12"), "12");
    assert.equal(answerContinuationKey("Q12 (contd.)"), "12");
    assert.equal(
      answerContinuationKey("Q12"),
      answerContinuationKey("Q12 (contd.)"),
    );
  });

  it("merges the dump's exact Q12 fragments, which are not label-only", () => {
    const page2Text =
      "Q12\n(diagram - human digestive system)\nmouth\noesophagus\nstomach";
    const page3Text = "small intestine\nlarge intestine";
    assert.doesNotMatch(page2Text.trim(), /^(?:q\s*\d+|\(\s*contd\.?\s*\))$/i);
    assert.doesNotMatch(page3Text.trim(), /^(?:q\s*\d+|\(\s*contd\.?\s*\))$/i);

    const stitched = stitchAnswerContinuations([
      answer({
        id: "page2-answer7",
        detectedQuestionNumber: "Q12",
        text: page2Text,
        regions: [region(2, 0.66)],
        confidence: 0.95,
      }),
      answer({
        id: "page3-answer1",
        detectedQuestionNumber: "Q12 (contd.)",
        text: page3Text,
        regions: [region(3, 0.04)],
        confidence: 0.9,
      }),
    ]);
    assert.equal(stitched.length, 1);
    assert.equal(stitched[0].regions.length, 2);
    assert.match(stitched[0].text, /mouth/);
    assert.match(stitched[0].text, /small intestine/);
  });
});

function dumpHasFullPaper(): boolean {
  if (!existsSync(REAL)) return false;
  const dump = JSON.parse(readFileSync(REAL, "utf8")) as {
    questions?: Question[];
    answers?: Answer[];
  };
  const questions = dump.questions ?? [];
  const answers = dump.answers ?? [];
  const hasPage2Question = questions.some((item) => item.page >= 2);
  const hasLaterAnswer = answers.some((item) =>
    item.regions.some((region) => region.page >= 2),
  );
  return hasPage2Question && hasLaterAnswer;
}

describe("real pipeline dump", () => {
  it("stitches 8(b) and Q12 on the last extract+map dump", { skip: !dumpHasFullPaper() }, () => {
    const dump = JSON.parse(readFileSync(REAL, "utf8")) as {
      questions: Question[];
      answers: Answer[];
    };
    const questions = stitchQuestionContinuations(dump.questions);
    const answers = stitchAnswerContinuations(dump.answers);
    const mapping = mapAnswersToQuestions(questions, answers);

    const eightB = mapping.results.find(
      (item) =>
        item.question.displayNumber === "8" && item.question.subPart === "b",
    );
    assert.ok(eightB, "expected stitched 8(b)");
    assert.ok(eightB.answer, "8(b) should match the student's Q8(b) block");
    assert.match(
      (eightB.answer?.detectedQuestionNumber ?? "").toLowerCase(),
      /8\s*\(?b\)?/,
    );

    const twelve = mapping.results.find(
      (item) => item.question.displayNumber === "12",
    );
    assert.ok(twelve?.answer);
    assert.equal(twelve.answer?.regions.length, 2);
    assert.deepEqual(
      twelve.answer?.regions.map((region) => region.page).sort((a, b) => a - b),
      [2, 3],
    );
    assert.equal(
      mapping.unmatchedAnswers.some((item) =>
        /q12\s*\(contd/i.test(item.answer.detectedQuestionNumber ?? ""),
      ),
      false,
    );

    const a2 = mapping.results.find(
      (item) => item.question.id === "section-a-physics-2",
    );
    const b2 = mapping.results.find(
      (item) => item.question.id === "section-b-biology-chemistry-2",
    );
    assert.equal(a2?.question.page, 1);
    assert.equal(b2?.question.page, 2);
    assert.ok(a2?.answer, "A2 (newton) should receive the page-3 Q2 block");
    assert.match((a2?.answer?.text ?? "").toLowerCase(), /newton/);
    assert.equal(b2?.status, "unanswered");
    assert.equal(a2?.answer?.regions[0]?.page, 3);
  });
});
