import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatScoreLabel,
  highlightToneForGrade,
  questionBodyText,
  scoreTone,
  subPartLabel,
  unmatchedAnswerLabel,
  UNAVAILABLE_QUESTION_TEXT,
} from "./question-ui";
import type { GradeResult } from "./types";

describe("question display helpers", () => {
  it("replaces blank question text", () => {
    assert.equal(questionBodyText("   "), UNAVAILABLE_QUESTION_TEXT);
    assert.equal(questionBodyText("What is osmosis?"), "What is osmosis?");
  });

  it("renders shared-number sub-part labels as a./b.", () => {
    assert.equal(subPartLabel("a"), "a.");
    assert.equal(subPartLabel("b"), "b.");
    assert.equal(subPartLabel("a(i)"), "a(i).");
    assert.equal(subPartLabel(undefined), null);
  });

  it("never prints null/undefined for unmatched labels", () => {
    assert.equal(
      unmatchedAnswerLabel(null),
      "Unmatched answer (unlabeled)",
    );
    assert.equal(
      unmatchedAnswerLabel("  "),
      "Unmatched answer (unlabeled)",
    );
    assert.equal(
      unmatchedAnswerLabel("99"),
      "Unmatched answer (detected as Q99)",
    );
    assert.doesNotMatch(unmatchedAnswerLabel(null), /null|undefined/);
  });
});

describe("score badges", () => {
  it("uses success / warning / error from verdict", () => {
    const base: Omit<GradeResult, "verdict" | "score"> = {
      questionId: "q1",
      maxScore: 5,
      feedback: "ok",
    };
    assert.equal(
      scoreTone({ ...base, verdict: "correct", score: 5 }),
      "success",
    );
    assert.equal(
      scoreTone({ ...base, verdict: "partially-correct", score: 3 }),
      "warning",
    );
    assert.equal(
      scoreTone({ ...base, verdict: "incorrect", score: 0 }),
      "error",
    );
    assert.equal(
      formatScoreLabel({ ...base, verdict: "correct", score: 5 }),
      "5/5",
    );
    assert.equal(
      formatScoreLabel({
        ...base,
        verdict: "incorrect",
        score: 0,
        maxScore: 2,
      }),
      "0/2",
    );
    assert.equal(
      formatScoreLabel({
        ...base,
        verdict: "not-gradable",
        score: null,
        maxScore: 10,
      }),
      null,
    );
    assert.equal(
      formatScoreLabel({
        ...base,
        verdict: "correct",
        score: null,
        maxScore: 2,
      }),
      "–/2",
    );
  });
});

describe("highlightToneForGrade", () => {
  it("maps correct to green and incorrect to red", () => {
    const base: Omit<GradeResult, "verdict" | "score"> = {
      questionId: "q1",
      maxScore: 2,
      feedback: "ok",
    };
    assert.equal(
      highlightToneForGrade({ ...base, verdict: "correct", score: 2 }),
      "success",
    );
    assert.equal(
      highlightToneForGrade({ ...base, verdict: "incorrect", score: 0 }),
      "error",
    );
    assert.equal(
      highlightToneForGrade({
        ...base,
        verdict: "partially-correct",
        score: 1,
      }),
      "warning",
    );
    assert.equal(highlightToneForGrade(undefined), undefined);
  });
});
