import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { POST as gradePOST } from "../app/api/grade/route";
import { gradeAnswers } from "./gemini";
import {
  CROSSED_OUT_FEEDBACK_PREFIX,
  GRADE_BATCH_SIZE,
  LOW_CONFIDENCE_FEEDBACK_PREFIX,
  collectGradePairs,
  imagesForGradeBatch,
  parseGradeRequestBody,
  parseGradeResultsJson,
  previewDisplayGrades,
  skippedQuestionGrades,
} from "./grading";
import { mapAnswersToQuestions } from "./matching";
import type { Answer, GradePair, MappedResult, Question } from "./types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
    confidence: partial.confidence ?? 0.97,
    ...partial,
  };
}

function mapped(
  q: Question,
  a: Answer | null,
  extras: Partial<MappedResult> = {},
): MappedResult {
  return {
    question: q,
    answer: a,
    status: extras.status ?? (a ? "matched" : "unanswered"),
    matchConfidence: extras.matchConfidence ?? (a ? 0.9 : 0),
    ...extras,
  };
}

function extractInputPairs(prompt: string): GradePair[] {
  const marker = "INPUT_PAIRS:";
  const idx = prompt.indexOf(marker);
  assert.ok(idx >= 0, "prompt must embed INPUT_PAIRS");
  return JSON.parse(prompt.slice(idx + marker.length).trim()) as GradePair[];
}

function stubGrades(pairs: GradePair[]): string {
  return JSON.stringify(
    pairs.map((pair) => {
      if (pair.answerText.trim() === "") {
        return {
          questionId: pair.questionId,
          score: null,
          maxScore: pair.maxMarks,
          verdict: "not-gradable",
          feedback: "Looks fine.",
        };
      }
      return {
        questionId: pair.questionId,
        score: 8,
        maxScore: pair.maxMarks,
        verdict: "partially-correct",
        feedback: `The student correctly explained ${pair.questionText}.`,
      };
    }),
  );
}

describe("collectGradePairs", () => {
  it("grades matched and low-confidence only", () => {
    const q1 = question({ id: "q1", displayNumber: "1", maxMarks: 2 });
    const q2 = question({ id: "q2", displayNumber: "2" });
    const q3 = question({
      id: "q3",
      displayNumber: "3",
      isAlternativeOf: "4",
    });
    const results: MappedResult[] = [
      mapped(q1, answer({ id: "a1", text: "displacement over time" })),
      mapped(q2, null, { status: "unanswered" }),
      mapped(q3, null, { status: "not-attempted-choice" }),
    ];
    const { pairs, skipped } = collectGradePairs(results);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].questionId, "q1");
    assert.equal(pairs[0].regions?.length, 1);
    assert.equal(skipped.length, 2);
    assert.ok(skipped.some((s) => s.questionId === "q2" && /unanswered/.test(s.reason)));
    assert.ok(
      skipped.some(
        (s) => s.questionId === "q3" && /not-attempted-choice/.test(s.reason),
      ),
    );
  });

  it("excludes needsReview questions even when a match exists", () => {
    const q = question({
      id: "cont-b",
      displayNumber: "(b)",
      subPart: "b",
      needsReview: true,
    });
    const { pairs, skipped } = collectGradePairs([
      mapped(q, answer({ id: "a1", text: "504000 J" })),
    ]);
    assert.equal(pairs.length, 0);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /needsReview/);
  });

  it("does not turn unmatchedAnswers leftover objects into grade pairs", () => {
    const body = {
      results: [
        mapped(question({ id: "q1", displayNumber: "1" }), null, {
          status: "unanswered",
        }),
      ],
      unmatchedAnswers: [
        {
          answer: answer({
            id: "orphan",
            detectedQuestionNumber: "99",
            text: "this leftover must never be graded",
          }),
          note: "Extra answer for a question that already has a match.",
        },
      ],
    };
    const parsed = parseGradeRequestBody(body);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const { pairs, skipped } = collectGradePairs(parsed.results);
    assert.equal(pairs.length, 0);
    assert.equal(skipped.length, 1);
    assert.ok(
      !JSON.stringify(pairs).includes("this leftover must never be graded"),
    );
  });
});

describe("skippedQuestionGrades", () => {
  it("shows 0/maxMarks for unanswered questions so scores are visible", () => {
    const q1 = question({ id: "q3", displayNumber: "3", maxMarks: 2 });
    const grades = skippedQuestionGrades([
      mapped(q1, null, { status: "unanswered" }),
    ]);
    assert.equal(grades.length, 1);
    assert.equal(grades[0].score, 0);
    assert.equal(grades[0].maxScore, 2);
    assert.equal(grades[0].verdict, "incorrect");
    assert.match(grades[0].feedback, /No answer was found/);
  });

  it("defaults missing maxMarks to 10 so a red 0/10 badge can show", () => {
    const q1 = question({ id: "q7", displayNumber: "7" });
    const grades = skippedQuestionGrades([
      mapped(q1, null, { status: "unanswered" }),
    ]);
    assert.equal(grades[0].maxScore, 10);
    assert.equal(grades[0].score, 0);
  });
});

describe("previewDisplayGrades", () => {
  it("colors matched green and low-confidence amber before AI scores exist", () => {
    const matched = mapped(
      question({ id: "q1", displayNumber: "1", maxMarks: 2 }),
      answer({ id: "a1" }),
      { status: "matched" },
    );
    const low = mapped(
      question({ id: "q2", displayNumber: "2", maxMarks: 5 }),
      answer({ id: "a2" }),
      { status: "low-confidence", matchConfidence: 0.3 },
    );
    const grades = previewDisplayGrades([matched, low]);
    assert.equal(grades[0].verdict, "correct");
    assert.equal(grades[0].score, null);
    assert.equal(grades[0].maxScore, 2);
    assert.equal(grades[1].verdict, "partially-correct");
    assert.equal(grades[1].score, null);
  });
});

describe("imagesForGradeBatch", () => {
  it("attaches only the pages a batch's regions sit on", () => {
    const pages = [
      { pageNumber: 1, imageBase64: "p1" },
      { pageNumber: 2, imageBase64: "p2" },
      { pageNumber: 3, imageBase64: "p3" },
    ];
    const batch: GradePair[] = [
      {
        questionId: "q1",
        questionText: "Q",
        maxMarks: 2,
        answerText: "A",
        matchConfidence: 0.9,
        regions: [
          { page: 2, x: 0, y: 0, width: 1, height: 0.2 },
          { page: 3, x: 0, y: 0, width: 1, height: 0.2 },
        ],
      },
    ];
    const images = imagesForGradeBatch(batch, pages);
    assert.deepEqual(
      images.map((page) => page.pageNumber),
      [2, 3],
    );
  });
});

describe("parseGradeResultsJson", () => {
  it("drops hallucinated questionIds without throwing", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const parsed = parseGradeResultsJson(
        JSON.stringify([
          {
            questionId: "real",
            score: 2,
            maxScore: 2,
            verdict: "correct",
            feedback: "ok",
          },
          {
            questionId: "hallucinated-q",
            score: 10,
            maxScore: 10,
            verdict: "correct",
            feedback: "invented",
          },
        ]),
        new Set(["real"]),
      );
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].questionId, "real");
    assert.ok(warnings.some((line) => /hallucinated-q/.test(line)));
    } finally {
      console.warn = original;
    }
  });

  it("coerces numeric strings for score and maxScore", () => {
    const parsed = parseGradeResultsJson(
      JSON.stringify([
        {
          questionId: "real",
          score: "1",
          maxScore: "2",
          verdict: "partially-correct",
          feedback: "one mark",
        },
      ]),
      new Set(["real"]),
    );
    assert.equal(parsed[0].score, 1);
    assert.equal(parsed[0].maxScore, 2);
  });
});

describe("gradeAnswers", () => {
  it("grades a normal confident match without hedging prefixes", async () => {
    const pairs: GradePair[] = [
      {
        questionId: "q-velocity",
        questionText: "Define velocity.",
        maxMarks: 2,
        answerText: "Velocity is displacement per unit time, with direction.",
        matchConfidence: 0.9,
      },
    ];
    const grades = await gradeAnswers(pairs, async () =>
      JSON.stringify([
        {
          questionId: "q-velocity",
          score: 2,
          maxScore: 2,
          verdict: "correct",
          feedback: "Clear definition including direction.",
        },
      ]),
    );
    assert.equal(grades.length, 1);
    assert.equal(grades[0].verdict, "correct");
    assert.equal(grades[0].score, 2);
    assert.equal(grades[0].feedback, "Clear definition including direction.");
    assert.ok(!grades[0].feedback.includes(LOW_CONFIDENCE_FEEDBACK_PREFIX.trim()));
    assert.ok(!/crossed out/i.test(grades[0].feedback));
  });

  it("diagram-only empty text without regions is not-gradable and mentions a diagram", async () => {
    const pairs: GradePair[] = [
      {
        questionId: "q-diagram",
        questionText: "Sketch a labelled triangle.",
        maxMarks: 5,
        answerText: "",
        matchConfidence: 0.9,
      },
    ];
    const grades = await gradeAnswers(pairs, async () =>
      JSON.stringify([
        {
          questionId: "q-diagram",
          score: 5,
          maxScore: 5,
          verdict: "correct",
          feedback: "Full marks.",
        },
      ]),
    );
    assert.equal(grades[0].verdict, "not-gradable");
    assert.equal(grades[0].score, null);
    assert.match(grades[0].feedback, /diagram/i);
  });

  it("empty text with a region is graded from the image, not forced not-gradable", async () => {
    const pairs: GradePair[] = [
      {
        questionId: "q-diagram",
        questionText: "Sketch a labelled triangle.",
        maxMarks: 5,
        answerText: "",
        matchConfidence: 0.9,
        regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
      },
    ];
    const grades = await gradeAnswers(pairs, async () =>
      JSON.stringify([
        {
          questionId: "q-diagram",
          score: 4,
          maxScore: 5,
          verdict: "partially-correct",
          feedback: "Labels are present; one side is missing.",
        },
      ]),
    );
    assert.equal(grades[0].verdict, "partially-correct");
    assert.equal(grades[0].score, 4);
    assert.equal(grades[0].maxScore, 5);
  });

  it("keeps the question's maxMarks even if the model returns /10", async () => {
    const pairs: GradePair[] = [
      {
        questionId: "q1",
        questionText: "Define osmosis.",
        maxMarks: 2,
        answerText: "Movement of water.",
        matchConfidence: 0.9,
      },
    ];
    const grades = await gradeAnswers(pairs, async () =>
      JSON.stringify([
        {
          questionId: "q1",
          score: 8,
          maxScore: 10,
          verdict: "correct",
          feedback: "Correct definition.",
        },
      ]),
    );
    assert.equal(grades[0].maxScore, 2);
    assert.equal(grades[0].score, 2);
    assert.equal(grades[0].verdict, "correct");
  });

  it("crossed-out flagged answer prepends a teacher caveat even if the model omits it", async () => {
    const pairs: GradePair[] = [
      {
        questionId: "q9",
        questionText: "Capital of France?",
        maxMarks: 1,
        answerText: "London",
        matchConfidence: 0.9,
        flagged: "crossed-out",
      },
    ];
    const grades = await gradeAnswers(pairs, async () =>
      JSON.stringify([
        {
          questionId: "q9",
          score: 0,
          maxScore: 1,
          verdict: "incorrect",
          feedback: "The capital of France is Paris, not London.",
        },
      ]),
    );
    assert.equal(grades[0].score, 0);
    assert.match(grades[0].feedback, /crossed out/i);
    assert.ok(grades[0].feedback.startsWith(CROSSED_OUT_FEEDBACK_PREFIX.trim()));
    assert.ok(
      grades[0].feedback.indexOf("crossed out") <
        grades[0].feedback.indexOf("Paris"),
    );
  });

  it("low-confidence positional match hedges instead of asserting the pairing", async () => {
    const pairs: GradePair[] = [
      {
        questionId: "q-photo",
        questionText: "Write the word equation for photosynthesis.",
        maxMarks: 3,
        answerText: "carbon dioxide + water → glucose + oxygen",
        matchConfidence: 0.3,
      },
    ];
    const grades = await gradeAnswers(pairs, async () =>
      JSON.stringify([
        {
          questionId: "q-photo",
          score: 3,
          maxScore: 3,
          verdict: "correct",
          feedback:
            "The student correctly explained the word equation for photosynthesis.",
        },
      ]),
    );
    const feedback = grades[0].feedback;
    assert.ok(feedback.startsWith(LOW_CONFIDENCE_FEEDBACK_PREFIX.trim()));
    assert.match(feedback, /low-confidence|wrong question/i);
    assert.ok(
      feedback.indexOf("may match the wrong question") <
        feedback.indexOf("correctly explained"),
    );
  });

  it("splits more than 8 pairs into sequential batches and merges without dupes or drops", async () => {
    const pairs: GradePair[] = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q${i + 1}`,
      questionText: `Question ${i + 1}`,
      maxMarks: 10,
      answerText: `Answer ${i + 1}`,
      matchConfidence: 0.9,
    }));

    const prompts: string[] = [];
    const grades = await gradeAnswers(pairs, async (prompt) => {
      prompts.push(prompt);
      return stubGrades(extractInputPairs(prompt));
    });

    assert.equal(prompts.length, 2);
    assert.equal(extractInputPairs(prompts[0]).length, GRADE_BATCH_SIZE);
    assert.equal(extractInputPairs(prompts[1]).length, 2);
    assert.equal(grades.length, 10);
    const ids = grades.map((g) => g.questionId);
    assert.deepEqual(ids, pairs.map((p) => p.questionId));
    assert.equal(new Set(ids).size, 10);
  });

  it("does not call Gemini when there are zero pairs", async () => {
    let called = 0;
    const grades = await gradeAnswers([], async () => {
      called += 1;
      throw new Error("Gemini should not be called");
    });
    assert.equal(called, 0);
    assert.deepEqual(grades, []);
  });
});

describe("POST /api/grade", () => {
  it("returns empty grades and a full skipped list for a blank sheet", async () => {
    const results: MappedResult[] = [
      mapped(question({ id: "q1", displayNumber: "1" }), null, {
        status: "unanswered",
      }),
      mapped(question({ id: "q2", displayNumber: "2" }), null, {
        status: "unanswered",
      }),
    ];
    const response = await gradePOST(
      new Request("http://localhost/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results, unmatchedAnswers: [] }),
      }),
    );
    assert.equal(response.status, 200);
    const json = (await response.json()) as {
      grades: unknown[];
      skipped: { questionId: string; reason: string }[];
    };
    assert.equal(json.grades.length, 0);
    assert.equal(json.skipped.length, 2);
  });

  it("ignores unmatchedAnswers leftover { answer, note } objects", async () => {
    const response = await gradePOST(
      new Request("http://localhost/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: [
            mapped(question({ id: "q1", displayNumber: "1" }), null, {
              status: "unanswered",
            }),
          ],
          unmatchedAnswers: [
            {
              answer: answer({
                id: "leftover",
                text: "grade me please",
                detectedQuestionNumber: "99",
              }),
              note: "Crossed-out; replaced by a later answer with the same question number.",
            },
          ],
        }),
      }),
    );
    const json = (await response.json()) as {
      grades: { questionId: string }[];
      skipped: { questionId: string }[];
    };
    assert.equal(json.grades.length, 0);
    assert.equal(json.skipped[0]?.questionId, "q1");
  });
});

describe("Phase 4 mapped paper wiring", () => {
  it("sends flagged and duplicate-Q1 low-confidence into pairs, not leftovers", () => {
    const raw = JSON.parse(
      readFileSync(resolve(ROOT, "test-assets/output-questions.json"), "utf8"),
    ) as { page1: Question[]; page2: Question[] };
    const questions = [...raw.page1, ...raw.page2];
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
        text: "V = IR",
        regions: [{ page: 1, x: 0.1, y: 0.25, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-q5",
        detectedQuestionNumber: "5",
        text: "Nucleus, electrons, protons.",
        regions: [{ page: 1, x: 0.1, y: 0.4, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-8ai",
        detectedQuestionNumber: "8(a)(i)",
        text: "Shared pair of electrons.",
        regions: [{ page: 1, x: 0.1, y: 0.55, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-8aii",
        detectedQuestionNumber: "8a(ii)",
        text: "Water",
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
        text: "light intensity, carbon dioxide concentration",
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
        text: "diffusion of water",
        isCrossedOut: true,
        regions: [{ page: 2, x: 0.1, y: 0.55, width: 0.7, height: 0.08 }],
      }),
      answer({
        id: "a-orphan",
        detectedQuestionNumber: "99",
        text: "leftover",
        regions: [{ page: 2, x: 0.1, y: 0.9, width: 0.4, height: 0.05 }],
      }),
    ];

    const { results, unmatchedAnswers } = mapAnswersToQuestions(
      questions,
      answers,
    );
    const { pairs, skipped } = collectGradePairs(results);

    assert.equal(unmatchedAnswers.length, 1);
    assert.equal(unmatchedAnswers[0].answer.id, "a-orphan");
    assert.ok(unmatchedAnswers[0].note === undefined);

    const byId = Object.fromEntries(pairs.map((p) => [p.questionId, p]));
    assert.equal(byId["section-a-physics-1"].matchConfidence, 0.5);
    assert.equal(byId["section-c-biology-continued-1"].matchConfidence, 0.5);
    assert.equal(byId["section-c-biology-continued-3"].flagged, "crossed-out");
    assert.ok(!pairs.some((p) => p.answerText === "leftover"));
    assert.ok(
      skipped.some((s) => s.questionId === "section-b-chemistry-6"),
    );
  });
});
