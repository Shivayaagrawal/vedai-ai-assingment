import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyExtractEmpty } from "./extract-empty";
import { mapAnswersToQuestions } from "./matching";
import type { Answer, MappedResult, Question } from "./types";

function question(
  partial: Partial<Question> & Pick<Question, "id" | "displayNumber">,
): Question {
  return {
    text: partial.text ?? `Question ${partial.displayNumber}`,
    page: partial.page ?? 1,
    ...partial,
  };
}

function answer(partial: Partial<Answer> & Pick<Answer, "id">): Answer {
  return {
    detectedQuestionNumber: partial.detectedQuestionNumber ?? null,
    text: partial.text ?? "",
    regions: partial.regions ?? [
      { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
    ],
    confidence: partial.confidence ?? 0.9,
    ...partial,
  };
}

function mapped(
  q: Question,
  a: Answer | null,
  status: MappedResult["status"],
): MappedResult {
  return {
    question: q,
    answer: a,
    status,
    matchConfidence: a ? 0.9 : 0,
  };
}

describe("classifyExtractEmpty", () => {
  it("returns both when there are no questions and no leftover answers", () => {
    assert.equal(
      classifyExtractEmpty({ results: [], unmatchedAnswers: [] }),
      "both",
    );
  });

  it("returns questions when mapping is empty but unmatched answers exist", () => {
    const leftover = answer({ id: "a1", detectedQuestionNumber: "1" });
    assert.equal(
      classifyExtractEmpty({
        results: [],
        unmatchedAnswers: [{ answer: leftover }],
      }),
      "questions",
    );
  });

  it("returns answers when questions exist and nothing was extracted from the sheet", () => {
    const q1 = question({ id: "q1", displayNumber: "1" });
    const mapping = mapAnswersToQuestions([q1], []);
    assert.equal(mapping.results[0].status, "unanswered");
    assert.equal(classifyExtractEmpty(mapping), "answers");
  });

  it("does not fire when some questions are unanswered on a normal map", () => {
    const q1 = question({ id: "q1", displayNumber: "1" });
    const q2 = question({ id: "q2", displayNumber: "2" });
    const a1 = answer({ id: "a1", detectedQuestionNumber: "1" });
    const mapping = mapAnswersToQuestions([q1, q2], [a1]);
    assert.equal(mapping.results.find((r) => r.question.id === "q2")?.status, "unanswered");
    assert.equal(classifyExtractEmpty(mapping), null);
  });

  it("does not fire when leftover unmatched answers exist alongside questions", () => {
    const q1 = question({ id: "q1", displayNumber: "1" });
    const a99 = answer({ id: "a99", detectedQuestionNumber: "99" });
    const mapping = mapAnswersToQuestions([q1], [a99]);
    assert.ok(mapping.unmatchedAnswers.length > 0);
    assert.equal(classifyExtractEmpty(mapping), null);
  });

  it("treats a blank sheet on an OR-only paper as zero answers, not a mapped list", () => {
    const q5 = question({
      id: "q5",
      displayNumber: "5",
      isAlternativeOf: "6",
    });
    const q6 = question({
      id: "q6",
      displayNumber: "6",
      isAlternativeOf: "5",
    });
    const mapping = mapAnswersToQuestions([q5, q6], []);
    assert.ok(
      mapping.results.every((result) => result.status === "not-attempted-choice"),
    );
    assert.equal(classifyExtractEmpty(mapping), "answers");
  });

  it("does not treat mixed mapped rows as empty even if statuses vary", () => {
    const q1 = question({ id: "q1", displayNumber: "1" });
    const q2 = question({ id: "q2", displayNumber: "2" });
    const a1 = answer({ id: "a1", detectedQuestionNumber: "1" });
    assert.equal(
      classifyExtractEmpty({
        results: [
          mapped(q1, a1, "matched"),
          mapped(q2, null, "unanswered"),
        ],
        unmatchedAnswers: [],
      }),
      null,
    );
  });
});
