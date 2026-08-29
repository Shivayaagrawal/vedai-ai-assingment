import { mapAnswersToQuestions } from "./matching";
import type { MappingSession } from "./pipeline";
import type { Answer, Question } from "./types";

function linedPage(label: string, lines: string[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 1100;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#f7f4ea";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#c5d4e8";
  ctx.lineWidth = 1;
  for (let y = 80; y < canvas.height; y += 28) {
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(canvas.width - 32, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "20px sans-serif";
  ctx.fillText(label, 48, 48);
  ctx.font = "18px sans-serif";
  lines.forEach((line, index) => {
    ctx.fillText(line, 56, 108 + index * 28);
  });
  return canvas.toDataURL("image/png");
}

function q(
  partial: Pick<Question, "id" | "displayNumber"> & Partial<Question>,
): Question {
  return {
    text: partial.text ?? `Question ${partial.displayNumber}`,
    page: partial.page ?? 1,
    ...partial,
  };
}

function a(partial: Pick<Answer, "id"> & Partial<Answer>): Answer {
  return {
    detectedQuestionNumber: partial.detectedQuestionNumber ?? null,
    text: partial.text ?? "",
    regions: partial.regions ?? [
      { page: 1, x: 0.08, y: 0.12, width: 0.84, height: 0.1 },
    ],
    confidence: partial.confidence ?? 0.95,
    ...partial,
  };
}

export function buildResultsDemoSession(): MappingSession {
  const page1 = linedPage("Answer sheet — page 1", [
    "Q1. Osmosis is the movement of water.",
    "Q2. Photosynthesis occurs in the chloroplast.",
    "Q8 continues onto the next page…",
    "Q11 a. Mitochondria release energy.",
  ]);
  const page2 = linedPage("Answer sheet — page 2", [
    "…Q8 remainder: the diagram is labelled.",
    "Q11 b. The nucleus holds genetic material.",
    "Unlabelled extra working at the bottom.",
  ]);

  const questions: Question[] = [
    q({
      id: "q1",
      displayNumber: "1",
      text: "Define osmosis.",
      maxMarks: 2,
    }),
    q({
      id: "q2",
      displayNumber: "2",
      text: "Name the organelle where photosynthesis takes place.",
      maxMarks: 2,
    }),
    q({
      id: "q3",
      displayNumber: "3",
      text: "This question was not answered on the sheet.",
      maxMarks: 2,
    }),
    q({
      id: "q6",
      displayNumber: "6",
      text: "   ",
      maxMarks: 2,
    }),
    q({
      id: "q7",
      displayNumber: "7",
      text: "This is a deliberately long question stem so the card can demonstrate consistent two-line truncation with an extra toggle instead of stretching the collapsed row height relative to neighbouring cards in the list.",
      maxMarks: 3,
    }),
    q({
      id: "q8",
      displayNumber: "8",
      text: "An answer that spans two pages.",
      maxMarks: 4,
    }),
    q({
      id: "q9s",
      displayNumber: "9",
      section: "Section A",
      page: 1,
      text: "First of two questions numbered 9 — shown as a low-confidence match.",
      maxMarks: 5,
    }),
    q({
      id: "q9t",
      displayNumber: "9",
      section: "Section C",
      page: 2,
      text: "Second question numbered 9.",
      maxMarks: 5,
    }),
    q({
      id: "q11a",
      displayNumber: "11",
      subPart: "a",
      text: "State the function of mitochondria.",
      maxMarks: 2,
    }),
    q({
      id: "q11b",
      displayNumber: "11",
      subPart: "b",
      text: "State the function of the nucleus.",
      maxMarks: 2,
    }),
    q({
      id: "q12",
      displayNumber: "12",
      text: "Optional question A.",
      isAlternativeOf: "13",
      maxMarks: 5,
    }),
    q({
      id: "q13",
      displayNumber: "13",
      text: "Optional question B.",
      isAlternativeOf: "12",
      maxMarks: 5,
    }),
  ];

  const answers: Answer[] = [
    a({
      id: "a1",
      detectedQuestionNumber: "1",
      text: "Osmosis is the movement of water.",
      regions: [{ page: 1, x: 0.07, y: 0.08, width: 0.82, height: 0.08 }],
    }),
    a({
      id: "a2",
      detectedQuestionNumber: "2",
      text: "Chloroplast.",
      regions: [{ page: 1, x: 0.07, y: 0.18, width: 0.82, height: 0.1 }],
    }),
    a({
      id: "a6",
      detectedQuestionNumber: "6",
      text: "Answer for blank stem.",
      regions: [{ page: 1, x: 0.07, y: 0.42, width: 0.6, height: 0.07 }],
    }),
    a({
      id: "a7",
      detectedQuestionNumber: "7",
      text: "Long-question answer.",
      regions: [{ page: 1, x: 0.07, y: 0.52, width: 0.75, height: 0.08 }],
    }),
    a({
      id: "a8",
      detectedQuestionNumber: "8",
      text: "Part on page 1 and part on page 2.",
      regions: [
        { page: 1, x: 0.07, y: 0.72, width: 0.84, height: 0.18 },
        { page: 2, x: 0.07, y: 0.08, width: 0.84, height: 0.16 },
      ],
    }),
    a({
      id: "a9",
      detectedQuestionNumber: "9",
      text: "Answer claimed by the closer of two Q9s.",
      regions: [{ page: 1, x: 0.07, y: 0.32, width: 0.7, height: 0.08 }],
    }),
    a({
      id: "a11a",
      detectedQuestionNumber: "11a",
      text: "Mitochondria release energy.",
      regions: [{ page: 1, x: 0.07, y: 0.62, width: 0.8, height: 0.08 }],
    }),
    a({
      id: "a11b",
      detectedQuestionNumber: "11b",
      text: "Nucleus holds DNA.",
      regions: [{ page: 2, x: 0.07, y: 0.28, width: 0.8, height: 0.1 }],
    }),
    a({
      id: "a-stray",
      detectedQuestionNumber: "99",
      text: "Stray numbered working.",
      regions: [{ page: 2, x: 0.1, y: 0.5, width: 0.7, height: 0.1 }],
    }),
  ];

  const mapping = mapAnswersToQuestions(questions, answers);
  mapping.unmatchedAnswers.push({
    answer: a({
      id: "a-unlabeled",
      detectedQuestionNumber: null,
      text: "Unlabelled extra working.",
      regions: [{ page: 2, x: 0.1, y: 0.72, width: 0.75, height: 0.12 }],
    }),
  });

  return {
    mapping,
    warnings: [],
    questionPages: [{ pageNumber: 1, imageBase64: page1 }],
    answerPages: [
      { pageNumber: 1, imageBase64: page1 },
      { pageNumber: 2, imageBase64: page2 },
    ],
  };
}

function placeholderPage(label: string): string {
  return linedPage(label, []);
}

export function buildExtractEmptyDemoSession(
  kind: "questions" | "answers" | "both",
): MappingSession {
  const q1: Question = q({
    id: "q1",
    displayNumber: "1",
    text: "Define osmosis.",
    maxMarks: 2,
  });
  const leftover: Answer = a({
    id: "a-orphan",
    detectedQuestionNumber: "4",
    text: "Working with no matching question.",
  });

  if (kind === "both") {
    return {
      mapping: { results: [], unmatchedAnswers: [] },
      warnings: [],
      questionPages: [{ pageNumber: 1, imageBase64: placeholderPage("Question paper") }],
      answerPages: [{ pageNumber: 1, imageBase64: placeholderPage("Answer sheet") }],
    };
  }

  if (kind === "questions") {
    return {
      mapping: {
        results: [],
        unmatchedAnswers: [{ answer: leftover }],
      },
      warnings: [],
      questionPages: [{ pageNumber: 1, imageBase64: placeholderPage("Not a question paper") }],
      answerPages: [{ pageNumber: 1, imageBase64: placeholderPage("Answer sheet") }],
    };
  }

  return {
    mapping: mapAnswersToQuestions([q1], []),
    warnings: [],
    questionPages: [{ pageNumber: 1, imageBase64: placeholderPage("Question paper") }],
    answerPages: [{ pageNumber: 1, imageBase64: placeholderPage("Blank answer sheet") }],
  };
}
