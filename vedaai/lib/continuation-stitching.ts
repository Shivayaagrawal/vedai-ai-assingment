import { questionIdFromParts } from "./gemini";
import { normalizeNumber } from "./matching";
import type { Answer, Question } from "./types";

/** Adjacent pages only — same conservative rule on both question and answer sides. */
export function isAdjacentContinuation(
  earlierPage: number,
  laterPage: number,
): boolean {
  return laterPage === earlierPage + 1;
}

/**
 * A "bare sub-part" has no leading question number of its own: "(b)", "b", "(ii)".
 * "8(b)" and "11(a)(ii)" are already fully qualified and are not continuations.
 */
export function isBareSubPart(label: string | null | undefined): boolean {
  if (label == null) return true;
  const trimmed = label.trim();
  if (trimmed === "") return true;
  return /^\(?[a-z]\)?$/i.test(trimmed) || /^\(?[ivx]+\)?$/i.test(trimmed);
}

export function isBareContinuationQuestion(question: Question): boolean {
  if (/\d/.test(question.displayNumber ?? "")) return false;
  return (
    isBareSubPart(question.displayNumber) || isBareSubPart(question.subPart)
  );
}

const LETTER_SEQ = "abcdefgh";
const ROMAN_SEQ = ["i", "ii", "iii", "iv", "v"];

function lastSubPartToken(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[()]/g, " ").trim();
  const tokens = cleaned.split(/[\s./-]+/).filter(Boolean);
  return tokens[tokens.length - 1] ?? cleaned;
}

export function extractSubPartLetter(question: Question): string | null {
  if (question.subPart) return lastSubPartToken(question.subPart);
  if (question.displayNumber) {
    const match = question.displayNumber.match(/\(?([a-z]+|[ivx]+)\)?$/i);
    return match ? lastSubPartToken(match[1]) : null;
  }
  return null;
}

/** a→b, i→ii, ii→iii. Roman is checked first so "i" is not treated as a letter. */
export function isNaturalPredecessor(
  prevLetter: string,
  nextLetter: string | null,
): boolean {
  if (!nextLetter) return false;
  const prev = lastSubPartToken(prevLetter);
  const next = lastSubPartToken(nextLetter);

  const romanIdx = ROMAN_SEQ.indexOf(prev);
  if (romanIdx !== -1 || ROMAN_SEQ.includes(next)) {
    return romanIdx !== -1 && ROMAN_SEQ[romanIdx + 1] === next;
  }

  const letterIdx = LETTER_SEQ.indexOf(prev);
  if (letterIdx !== -1) return LETTER_SEQ[letterIdx + 1] === next;
  return false;
}

function stripContinuationMarker(raw: string): string {
  return raw
    .replace(/\(contd\.?\)/gi, "")
    .replace(/\(cont\.?\)/gi, "")
    .replace(/\bcontinued\b/gi, "")
    .replace(/\bcontd\.?\b/gi, "")
    .trim();
}

/** Same identity as matching, after dropping "contd." / "continued" suffixes. */
export function answerContinuationKey(
  detectedQuestionNumber: string | null | undefined,
): string {
  if (!detectedQuestionNumber) return "";
  return normalizeNumber(stripContinuationMarker(detectedQuestionNumber));
}

export function stitchQuestionContinuations(questions: Question[]): Question[] {
  const ordered = questions.map((question, index) => ({ question, index }));
  ordered.sort(
    (left, right) =>
      left.question.page - right.question.page || left.index - right.index,
  );

  const result: Question[] = [];

  for (const { question } of ordered) {
    if (!isBareContinuationQuestion(question)) {
      result.push(question);
      continue;
    }

    const nextPart = extractSubPartLetter(question);
    const candidates = result.filter(
      (prev) =>
        isAdjacentContinuation(prev.page, question.page) &&
        prev.subPart != null &&
        isNaturalPredecessor(prev.subPart, nextPart),
    );

    if (candidates.length === 1) {
      const parent = candidates[0];
      const mergedSubPart =
        question.subPart?.trim() || nextPart || parent.subPart || "";
      result.push({
        ...question,
        id: questionIdFromParts(
          question.section ?? parent.section,
          parent.displayNumber,
          mergedSubPart,
        ),
        displayNumber: parent.displayNumber,
        subPart: mergedSubPart,
        section: question.section ?? parent.section,
      });
      continue;
    }

    // 0 or >1 parents: do not guess.
    console.warn(
      `[continuation] page ${question.page} continuation ${question.displayNumber}${question.subPart ? `(${question.subPart})` : ""} has ${candidates.length} parent candidate(s); leaving standalone with needsReview`,
    );
    result.push({ ...question, needsReview: true });
  }

  return result;
}

export function stitchAnswerContinuations(answers: Answer[]): Answer[] {
  const sorted = [...answers].sort((left, right) => {
    const pageLeft = left.regions[0]?.page ?? 0;
    const pageRight = right.regions[0]?.page ?? 0;
    if (pageLeft !== pageRight) return pageLeft - pageRight;
    const yLeft = left.regions[0]?.y ?? 0;
    const yRight = right.regions[0]?.y ?? 0;
    return yLeft - yRight;
  });

  const merged: Answer[] = [];

  for (const answer of sorted) {
    const key = answerContinuationKey(answer.detectedQuestionNumber);
    const page = answer.regions[0]?.page ?? 0;

    const openMatch = key
      ? merged.find((existing) => {
          const existingKey = answerContinuationKey(
            existing.detectedQuestionNumber,
          );
          const lastPage = Math.max(
            ...existing.regions.map((region) => region.page),
          );
          return (
            existingKey === key && isAdjacentContinuation(lastPage, page)
          );
        })
      : undefined;

    if (openMatch) {
      openMatch.regions = [...openMatch.regions, ...answer.regions];
      openMatch.text = [openMatch.text, answer.text]
        .filter((text) => text.trim().length > 0)
        .join(" ");
      openMatch.isCrossedOut = Boolean(
        openMatch.isCrossedOut || answer.isCrossedOut,
      );
      openMatch.confidence = Math.min(openMatch.confidence, answer.confidence);
      continue;
    }

    merged.push({ ...answer, regions: [...answer.regions] });
  }

  return merged;
}
