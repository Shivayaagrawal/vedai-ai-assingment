import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentOverlapScore,
  mapAnswersToQuestions,
  normalizeNumber,
  questionMatchKey,
} from "./matching";
import type { Answer, Question } from "./types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function question(partial: Partial<Question> & Pick<Question, "id" | "displayNumber">): Question {
  return {
    text: partial.text ?? `Question ${partial.displayNumber}`,
    page: partial.page ?? 1,
    ...partial,
  };
}

function answer(
  partial: Partial<Answer> & Pick<Answer, "id">,
): Answer {
  return {
    detectedQuestionNumber: partial.detectedQuestionNumber ?? null,
    text: partial.text ?? "",
    regions: partial.regions ?? [{ page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.1 }],
    confidence: partial.confidence ?? 0.97,
    ...partial,
  };
}

describe("normalizeNumber", () => {
  it("collapses equivalent labels without colliding 8a and 8a(i)", () => {
    const elevenA = ["11 (a)", "11a", "Q11a", "11.a", "11(a)"].map(normalizeNumber);
    assert.ok(elevenA.every((key) => key === "11a"));

    assert.equal(normalizeNumber("8(a)(i)"), "8ai");
    assert.equal(normalizeNumber("8a(i)"), "8ai");
    assert.equal(normalizeNumber("8ai"), "8ai");
    assert.notEqual(normalizeNumber("8a"), normalizeNumber("8a(i)"));
    assert.notEqual(questionMatchKey(question({ id: "8a", displayNumber: "8", subPart: "a" })), "8ai");
    assert.equal(
      questionMatchKey(question({ id: "8ai", displayNumber: "8", subPart: "a(i)" })),
      "8ai",
    );
  });
});

describe("mapAnswersToQuestions", () => {
  it("clean exact match", () => {
    const questions = [
      question({ id: "q2", displayNumber: "2", page: 1 }),
      question({ id: "q4", displayNumber: "4", page: 1 }),
    ];
    const answers = [
      answer({ id: "a4", detectedQuestionNumber: "4", text: "four" }),
      answer({ id: "a2", detectedQuestionNumber: "Q2", text: "two" }),
    ];
    const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].status, "matched");
    assert.equal(results[0].matchConfidence, 0.9);
    assert.equal(results[0].answer?.id, "a2");
    assert.equal(results[1].answer?.id, "a4");
    assert.equal(unmatchedAnswers.length, 0);
  });

  it("out-of-order answering still keys off the number", () => {
    const questions = [
      question({ id: "q1", displayNumber: "1", page: 1 }),
      question({ id: "q2", displayNumber: "2", page: 1 }),
      question({ id: "q3", displayNumber: "3", page: 1 }),
    ];
    const answers = [
      answer({
        id: "a3",
        detectedQuestionNumber: "3",
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.1 }],
      }),
      answer({
        id: "a1",
        detectedQuestionNumber: "1",
        regions: [{ page: 1, x: 0.1, y: 0.5, width: 0.4, height: 0.1 }],
      }),
      answer({
        id: "a2",
        detectedQuestionNumber: "2",
        regions: [{ page: 1, x: 0.1, y: 0.8, width: 0.4, height: 0.1 }],
      }),
    ];
    const { results } = mapAnswersToQuestions(questions, answers);
    assert.deepEqual(
      results.map((r) => r.answer?.id),
      ["a1", "a2", "a3"],
    );
    assert.ok(results.every((r) => r.status === "matched" && r.matchConfidence === 0.9));
  });

  it("unanswered question", () => {
    const questions = [question({ id: "q1", displayNumber: "1" })];
    const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, []);
    assert.equal(results[0].status, "unanswered");
    assert.equal(results[0].answer, null);
    assert.equal(unmatchedAnswers.length, 0);
  });

  it("unmatched labeled answer is not force-fit", () => {
    const questions = [question({ id: "q1", displayNumber: "1" })];
    const answers = [answer({ id: "a9", detectedQuestionNumber: "9", text: "orphan" })];
    const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].status, "unanswered");
    assert.equal(unmatchedAnswers.length, 1);
    assert.equal(unmatchedAnswers[0].answer.id, "a9");
  });

  it("OR pair: one side answered, the other stays unanswered", () => {
    const questions = [
      question({ id: "q5", displayNumber: "5", isAlternativeOf: "6" }),
      question({ id: "q6", displayNumber: "6", isAlternativeOf: "5" }),
    ];
    const answers = [answer({ id: "a5", detectedQuestionNumber: "5" })];
    const { results } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].status, "matched");
    assert.equal(results[1].status, "unanswered");
    assert.equal(results[1].answer, null);
  });

  it("OR pair: neither answered -> not-attempted-choice on both", () => {
    const questions = [
      question({ id: "q5", displayNumber: "5", isAlternativeOf: "6" }),
      question({ id: "q6", displayNumber: "6", isAlternativeOf: "5" }),
    ];
    const { results } = mapAnswersToQuestions(questions, []);
    assert.equal(results[0].status, "not-attempted-choice");
    assert.equal(results[1].status, "not-attempted-choice");
  });

  it("late Q2 answer prefers question text overlap over last-section page distance", () => {
    const a2 = question({
      id: "section-a-physics-2",
      displayNumber: "2",
      section: "SECTION A — PHYSICS",
      page: 1,
      text: "State the SI unit of force and define one newton.",
    });
    const b2 = question({
      id: "section-b-biology-chemistry-2",
      displayNumber: "2",
      section: "SECTION B — BIOLOGY & CHEMISTRY",
      page: 2,
      text: "What is photosynthesis? Write the balanced chemical equation for photosynthesis.",
    });
    const newtonOnPage3 = answer({
      id: "page3-answer2",
      detectedQuestionNumber: "Q2",
      text: "The SI unit of force is the newton (N). One newton is the force required to give a mass of 1kg an acceleration of 1 m/s^2.",
      regions: [{ page: 3, x: 0.09, y: 0.31, width: 0.78, height: 0.08 }],
    });

    assert.ok(a2.page !== b2.page, "dump A2 is p1, B2 is p2 — not a page tie");
    assert.equal(newtonOnPage3.regions[0].page, 3);
    assert.ok(
      contentOverlapScore(newtonOnPage3.text, a2.text) >
        contentOverlapScore(newtonOnPage3.text, b2.text),
    );

    const { results } = mapAnswersToQuestions([a2, b2], [newtonOnPage3]);
    assert.equal(results[0].answer?.id, "page3-answer2");
    assert.equal(results[0].question.id, "section-a-physics-2");
    assert.equal(results[1].status, "unanswered");
    assert.equal(results[0].status, "low-confidence");
  });

  it("late answer that belongs to the last section still matches via Jaccard", () => {
    const a2 = question({
      id: "section-a-physics-2",
      displayNumber: "2",
      page: 1,
      text: "State the SI unit of force and define one newton.",
    });
    const b2 = question({
      id: "section-b-biology-chemistry-2",
      displayNumber: "2",
      page: 2,
      text: "What is photosynthesis? Write the balanced chemical equation for photosynthesis.",
    });
    const photosynthesisOnPage3 = answer({
      id: "a-photo",
      detectedQuestionNumber: "Q2",
      text: "Photosynthesis is 6CO2 + 6H2O + light -> C6H12O6 + 6O2.",
      regions: [{ page: 3, x: 0.1, y: 0.3, width: 0.7, height: 0.08 }],
    });
    const { results } = mapAnswersToQuestions([a2, b2], [photosynthesisOnPage3]);
    assert.equal(results[1].answer?.id, "a-photo");
    assert.equal(results[0].status, "unanswered");
  });

  it("sparse late answer does not let noisy Jaccard beat unique-nearest", () => {
    const a2 = question({
      id: "a2",
      displayNumber: "2",
      page: 1,
      text: "State the SI unit of force and define one newton.",
    });
    const b2 = question({
      id: "b2",
      displayNumber: "2",
      page: 2,
      text: "What is photosynthesis? Write the balanced chemical equation for photosynthesis.",
    });
    const terse = answer({
      id: "a-42",
      detectedQuestionNumber: "2",
      text: "42",
      regions: [{ page: 3, x: 0.1, y: 0.3, width: 0.2, height: 0.05 }],
    });
    assert.equal(contentOverlapScore(terse.text, a2.text), 0);
    assert.equal(contentOverlapScore(terse.text, b2.text), 0);
    const { results } = mapAnswersToQuestions([a2, b2], [terse]);
    assert.equal(results[1].answer?.id, "a-42");
    assert.equal(results[0].status, "unanswered");
  });

  it("duplicate Q1 keys resolve by page proximity, not first-match", () => {
    const questions = [
      question({
        id: "section-a-physics-1",
        displayNumber: "1",
        section: "SECTION A — Physics",
        page: 1,
      }),
      question({
        id: "section-c-biology-continued-1",
        displayNumber: "1",
        section: "SECTION C — Biology (continued)",
        page: 2,
      }),
    ];
    const answers = [
      answer({
        id: "a-p2",
        detectedQuestionNumber: "1",
        text: "mitochondria",
        regions: [{ page: 2, x: 0.1, y: 0.4, width: 0.5, height: 0.1 }],
      }),
      answer({
        id: "a-p1",
        detectedQuestionNumber: "1",
        text: "velocity",
        regions: [{ page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
      }),
    ];
    const { results } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].answer?.id, "a-p1");
    assert.equal(results[1].answer?.id, "a-p2");
    assert.equal(results[0].status, "low-confidence");
    assert.equal(results[0].matchConfidence, 0.5);
    assert.equal(results[1].matchConfidence, 0.5);
  });

  it("positional fallback uses page order, not array index", () => {
    const questions = [
      question({ id: "q3", displayNumber: "3", page: 2 }),
      question({ id: "q2", displayNumber: "2", page: 1 }),
    ];
    const answers = [
      answer({
        id: "unlabeled-p2",
        detectedQuestionNumber: null,
        regions: [{ page: 2, x: 0.1, y: 0.2, width: 0.4, height: 0.1 }],
      }),
      answer({
        id: "unlabeled-p1",
        detectedQuestionNumber: null,
        regions: [{ page: 1, x: 0.1, y: 0.2, width: 0.4, height: 0.1 }],
      }),
    ];
    const { results } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].answer?.id, "unlabeled-p2");
    assert.equal(results[1].answer?.id, "unlabeled-p1");
    assert.equal(results[0].status, "low-confidence");
    assert.equal(results[0].matchConfidence, 0.3);
  });

  it("crossed-out vs clean for the same number: clean wins", () => {
    const questions = [question({ id: "q9", displayNumber: "9" })];
    const answers = [
      answer({
        id: "crossed",
        detectedQuestionNumber: "9",
        isCrossedOut: true,
        text: "London",
      }),
      answer({
        id: "clean",
        detectedQuestionNumber: "9",
        isCrossedOut: false,
        text: "Paris",
      }),
    ];
    const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].status, "matched");
    assert.equal(results[0].answer?.id, "clean");
    assert.equal(results[0].flagged, undefined);
    assert.equal(unmatchedAnswers.length, 1);
    assert.equal(unmatchedAnswers[0].answer.id, "crossed");
    assert.ok(unmatchedAnswers[0].note);
  });

  it("crossed-out-only answer is matched and flagged", () => {
    const questions = [question({ id: "q9", displayNumber: "9" })];
    const answers = [
      answer({
        id: "crossed",
        detectedQuestionNumber: "9",
        isCrossedOut: true,
        text: "London",
      }),
    ];
    const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].status, "matched");
    assert.equal(results[0].flagged, "crossed-out");
    assert.equal(results[0].answer?.id, "crossed");
    assert.equal(unmatchedAnswers.length, 0);
  });

  it("Pin #2 split of a merged Q1 box feeds the unlabeled half to positional fallback", () => {
    // Real-paper shape: page-1 Q1 was inertia + a photosynthesis equation in ONE
    // labeled box. After a prompt-level split, the unlabeled half should bind
    // to B2 via topic overlap, not to A2 via paper-order fallback.
    const questions = [
      question({
        id: "a1",
        displayNumber: "1",
        section: "SECTION A — PHYSICS",
        text: "Define the term inertia.",
        page: 1,
      }),
      question({
        id: "a2",
        displayNumber: "2",
        section: "SECTION A — PHYSICS",
        text: "State the SI unit of force and define one newton.",
        page: 1,
      }),
      question({
        id: "b2",
        displayNumber: "2",
        section: "SECTION B — BIOLOGY",
        text: "What is photosynthesis? Write the balanced chemical equation.",
        page: 2,
      }),
      question({
        id: "q10",
        displayNumber: "10",
        text: "Balance Fe + O2 -> Fe2O3",
        page: 2,
      }),
    ];
    const labeledQ1 = answer({
      id: "q1-inertia",
      detectedQuestionNumber: "1",
      text: "Inertia is the tendency of a body to resist change of motion.",
      regions: [{ page: 1, x: 0.09, y: 0.29, width: 0.7, height: 0.05 }],
    });
    const unlabeledPhotosynthesis = answer({
      id: "orphan-photosynthesis",
      detectedQuestionNumber: null,
      text: "6 CO2 + 6 H2O + light energy -> C6H12O6 + 6 O2 (photosynthesis)",
      regions: [{ page: 1, x: 0.09, y: 0.35, width: 0.7, height: 0.04 }],
    });
    const labeledQ10 = answer({
      id: "q10-fe",
      detectedQuestionNumber: "10",
      text: "4 Fe + 3 O2 -> 2 Fe2O3",
      regions: [{ page: 1, x: 0.09, y: 0.1, width: 0.3, height: 0.05 }],
    });

    const merged = mapAnswersToQuestions(questions, [
      answer({
        id: "q1-merged",
        detectedQuestionNumber: "1",
        text: `${labeledQ1.text}\n\n${unlabeledPhotosynthesis.text}`,
        regions: [{ page: 1, x: 0.09, y: 0.29, width: 0.77, height: 0.09 }],
      }),
      labeledQ10,
    ]);
    assert.equal(merged.results.find((row) => row.question.id === "a1")?.answer?.id, "q1-merged");
    assert.equal(merged.results.find((row) => row.question.id === "a2")?.status, "unanswered");
    assert.equal(merged.results.find((row) => row.question.id === "b2")?.status, "unanswered");
    assert.equal(
      merged.results.filter((row) => row.matchConfidence === 0.3).length,
      0,
    );

    const split = mapAnswersToQuestions(questions, [
      labeledQ1,
      unlabeledPhotosynthesis,
      labeledQ10,
    ]);
    const a1 = split.results.find((row) => row.question.id === "a1");
    const a2 = split.results.find((row) => row.question.id === "a2");
    const b2 = split.results.find((row) => row.question.id === "b2");
    assert.equal(a1?.answer?.id, "q1-inertia");
    assert.equal(a1?.matchConfidence, 0.9);
    assert.equal(a2?.status, "unanswered");
    assert.equal(a2?.answer, null);
    assert.equal(b2?.answer?.id, "orphan-photosynthesis");
    assert.equal(b2?.status, "low-confidence");
    assert.equal(b2?.matchConfidence, 0.3);
  });

  it("Pin #2 unlabeled photosynthesis does not uniquely attach to Fe2O3 via o2", () => {
    const questions = [
      question({
        id: "a2",
        displayNumber: "2",
        text: "State the SI unit of force and define one newton.",
        page: 1,
      }),
      question({
        id: "b2",
        displayNumber: "2",
        text: "What is photosynthesis? Write the balanced chemical equation.",
        page: 2,
      }),
      question({
        id: "q10",
        displayNumber: "10",
        text: "Balance Fe + O2 -> Fe2O3",
        page: 2,
      }),
    ];
    const orphan = answer({
      id: "orphan-photosynthesis",
      detectedQuestionNumber: null,
      text: "6 CO2 + 6 H2O + light energy -> C6H12O6 + 6 O2 (photosynthesis)",
      regions: [{ page: 1, x: 0.09, y: 0.35, width: 0.7, height: 0.04 }],
    });
    // Default min-length-2 Jaccard uniquely prefers Q10 (o2). Fallback uses 3.
    assert.ok(
      contentOverlapScore(orphan.text, questions[2].text) >
        contentOverlapScore(orphan.text, questions[1].text),
    );
    const { results } = mapAnswersToQuestions(questions, [orphan]);
    assert.equal(results[1].answer?.id, "orphan-photosynthesis");
    assert.equal(results[0].status, "unanswered");
    assert.equal(results[2].status, "unanswered");
  });

  it("unlabeled sparse text still uses paper-order positional fallback", () => {
    const questions = [
      question({
        id: "a2",
        displayNumber: "2",
        text: "State the SI unit of force and define one newton.",
        page: 1,
      }),
      question({
        id: "b2",
        displayNumber: "2",
        text: "What is photosynthesis? Write the balanced chemical equation.",
        page: 2,
      }),
    ];
    const { results } = mapAnswersToQuestions(questions, [
      answer({
        id: "orphan-42",
        detectedQuestionNumber: null,
        text: "42",
        regions: [{ page: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.05 }],
      }),
    ]);
    assert.equal(contentOverlapScore("42", questions[0].text, 3), 0);
    assert.equal(contentOverlapScore("42", questions[1].text, 3), 0);
    assert.equal(results[0].answer?.id, "orphan-42");
    assert.equal(results[0].matchConfidence, 0.3);
    assert.equal(results[1].status, "unanswered");
  });

  it("Pin #2 unlabeled orphan binds to B2 only when B2 is the first unanswered slot", () => {
    const questions = [
      question({
        id: "a1",
        displayNumber: "1",
        text: "Define inertia.",
        page: 1,
      }),
      question({
        id: "b2",
        displayNumber: "2",
        section: "SECTION B",
        text: "What is photosynthesis?",
        page: 2,
      }),
    ];
    const { results } = mapAnswersToQuestions(questions, [
      answer({
        id: "q1",
        detectedQuestionNumber: "1",
        text: "Inertia is resistance to change of motion.",
      }),
      answer({
        id: "orphan-photosynthesis",
        detectedQuestionNumber: null,
        text: "6 CO2 + 6 H2O -> C6H12O6 + 6 O2 (photosynthesis)",
        regions: [{ page: 1, x: 0.09, y: 0.35, width: 0.7, height: 0.04 }],
      }),
    ]);
    assert.equal(results[0].answer?.id, "q1");
    assert.equal(results[1].answer?.id, "orphan-photosynthesis");
    assert.equal(results[1].matchConfidence, 0.3);
  });

  it("11(b) continuation with null section still matches by number+subPart", () => {
    const questions = [
      question({
        id: "11a",
        displayNumber: "11",
        subPart: "a",
        section: "SECTION C — Biology",
        page: 1,
      }),
      question({
        id: "11-b",
        displayNumber: "11",
        subPart: "b",
        page: 2,
      }),
    ];
    const answers = [
      answer({
        id: "ans-11b",
        detectedQuestionNumber: "11(b)",
        regions: [{ page: 2, x: 0.1, y: 0.1, width: 0.5, height: 0.15 }],
      }),
    ];
    const { results } = mapAnswersToQuestions(questions, answers);
    assert.equal(results[0].status, "unanswered");
    assert.equal(results[1].status, "matched");
    assert.equal(results[1].matchConfidence, 0.9);
    assert.equal(results[1].answer?.id, "ans-11b");
  });
});

describe("Phase 2 fixture audit", () => {
  it("maps the real 10-question paper including nested 8a(i) and two Q1s", () => {
    const raw = JSON.parse(
      readFileSync(resolve(ROOT, "test-assets/output-questions.json"), "utf8"),
    ) as { page1: Question[]; page2: Question[] };
    const questions = [...raw.page1, ...raw.page2];
    assert.equal(questions.length, 10);

    const answers: Answer[] = [
      answer({
        id: "a-q1-p1",
        detectedQuestionNumber: "1",
        text: "Velocity is rate of change of displacement.",
        regions: [{ page: 1, x: 0.1, y: 0.15, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-q2",
        detectedQuestionNumber: "2",
        regions: [{ page: 1, x: 0.1, y: 0.25, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-q5",
        detectedQuestionNumber: "5",
        regions: [{ page: 1, x: 0.1, y: 0.4, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-8ai",
        detectedQuestionNumber: "8(a)(i)",
        regions: [{ page: 1, x: 0.1, y: 0.55, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-8aii",
        detectedQuestionNumber: "8a(ii)",
        regions: [{ page: 1, x: 0.1, y: 0.65, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-11a",
        detectedQuestionNumber: "11a",
        regions: [{ page: 1, x: 0.1, y: 0.8, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-11b",
        detectedQuestionNumber: "11 (b)",
        regions: [{ page: 2, x: 0.1, y: 0.1, width: 0.7, height: 0.1 }],
      }),
      answer({
        id: "a-q1-p2",
        detectedQuestionNumber: "1",
        text: "mitochondria",
        regions: [{ page: 2, x: 0.1, y: 0.35, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-orphan",
        detectedQuestionNumber: "99",
        regions: [{ page: 2, x: 0.1, y: 0.9, width: 0.4, height: 0.05 }],
      }),
    ];

    const { results, unmatchedAnswers } = mapAnswersToQuestions(questions, answers);
    const byId = Object.fromEntries(results.map((r) => [r.question.id, r]));

    assert.equal(byId["section-a-physics-1"].answer?.id, "a-q1-p1");
    assert.equal(byId["section-c-biology-continued-1"].answer?.id, "a-q1-p2");
    assert.equal(byId["section-a-physics-1"].matchConfidence, 0.5);

    assert.equal(byId["section-b-chemistry-8-a-i"].answer?.id, "a-8ai");
    assert.equal(byId["section-b-chemistry-8-a-ii"].answer?.id, "a-8aii");
    assert.notEqual(
      questionMatchKey(byId["section-b-chemistry-8-a-i"].question),
      questionMatchKey(byId["section-b-chemistry-8-a-ii"].question),
    );

    assert.equal(byId["section-c-biology-11-a"].status, "matched");
    assert.equal(byId["11-b"].status, "matched");
    assert.equal(byId["11-b"].answer?.id, "a-11b");
    assert.equal(byId["11-b"].matchConfidence, 0.9);

    assert.equal(byId["section-b-chemistry-5"].status, "matched");
    assert.equal(byId["section-b-chemistry-6"].status, "unanswered");

    assert.equal(byId["section-c-biology-continued-3"].status, "unanswered");
    assert.equal(byId["section-a-physics-2"].answer?.id, "a-q2");

    assert.equal(unmatchedAnswers.length, 1);
    assert.equal(unmatchedAnswers[0].answer.id, "a-orphan");
  });
});
