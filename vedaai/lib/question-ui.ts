import type { GradeResult, GradeVerdict, Question } from "./types";

export const UNAVAILABLE_QUESTION_TEXT = "(question text unavailable)";

export type ScoreTone = "success" | "warning" | "error";

export function questionBodyText(text: string): string {
  return text.trim() === "" ? UNAVAILABLE_QUESTION_TEXT : text;
}

export function subPartLabel(subPart: string | undefined): string | null {
  if (!subPart || subPart.trim() === "") return null;
  const trimmed = subPart.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

export function isLongQuestionText(text: string): boolean {
  return questionBodyText(text).length > 90;
}

export function scoreTone(grade: GradeResult): ScoreTone {
  if (grade.verdict === "correct") return "success";
  if (grade.verdict === "partially-correct") return "warning";
  if (grade.verdict === "incorrect") return "error";

  if (
    typeof grade.score === "number" &&
    typeof grade.maxScore === "number" &&
    grade.maxScore > 0
  ) {
    if (grade.score <= 0) return "error";
    if (grade.score >= grade.maxScore) return "success";
    return "warning";
  }

  return "warning";
}

function formatMarks(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 10) / 10);
}

export function formatScoreLabel(grade: GradeResult): string | null {
  if (grade.verdict === "not-gradable") return null;
  if (typeof grade.maxScore !== "number") return null;
  if (typeof grade.score === "number") {
    return `${formatMarks(grade.score)}/${formatMarks(grade.maxScore)}`;
  }
  // Pending AI grade — color comes from verdict, number is not claimed yet.
  return `–/${formatMarks(grade.maxScore)}`;
}

export function highlightToneForGrade(
  grade: GradeResult | undefined,
): ScoreTone | undefined {
  if (!grade || grade.verdict === "not-gradable") return undefined;
  return scoreTone(grade);
}

export function verdictCountLabel(verdict: GradeVerdict): string {
  switch (verdict) {
    case "correct":
      return "Correct";
    case "partially-correct":
      return "Partial";
    case "incorrect":
      return "Incorrect";
    case "not-gradable":
      return "Not gradable";
  }
}

export function questionNumberForBadge(question: Question): string {
  const raw = question.displayNumber.replace(/^q\s*/i, "").trim();
  return raw || "?";
}

export function unmatchedAnswerLabel(detectedQuestionNumber: string | null): string {
  const raw =
    typeof detectedQuestionNumber === "string"
      ? detectedQuestionNumber.trim()
      : "";
  if (raw === "") {
    return "Unmatched answer (unlabeled)";
  }
  const number = raw.replace(/^q\s*/i, "");
  return `Unmatched answer (detected as Q${number})`;
}
