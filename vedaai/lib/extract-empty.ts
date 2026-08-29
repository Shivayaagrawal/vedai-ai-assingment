import type { MappingOutput } from "./matching";

export const ZERO_QUESTIONS_MESSAGE =
  "We couldn't find any questions in this file. Double check it's the question paper, not the answer sheet, and that the pages are readable.";

export const ZERO_ANSWERS_MESSAGE =
  "We couldn't find any answers in this file. If the sheet is blank or the writing is very faint, that's expected — otherwise double check the file.";

export type ExtractEmptyKind = "questions" | "answers" | "both";

/**
 * Empty-state only when extraction returned nothing on one or both sides.
 * Partial maps (some unanswered, some matched, leftover unmatched answers)
 * stay on the normal results view.
 *
 * Assumption: "no answers extracted" is `answer === null` on every question
 * and no unmatched leftovers — that includes OR-pairs that become
 * `not-attempted-choice` on a blank sheet, not only `status === "unanswered"`.
 */
export function classifyExtractEmpty(
  mapping: MappingOutput,
): ExtractEmptyKind | null {
  const noQuestions = mapping.results.length === 0;
  const noUnmatched = mapping.unmatchedAnswers.length === 0;
  const noMappedAnswers = mapping.results.every((result) => result.answer === null);

  if (noQuestions && noUnmatched) return "both";
  if (noQuestions) return "questions";
  if (noUnmatched && noMappedAnswers) return "answers";
  return null;
}

export function emptyStateMessages(kind: ExtractEmptyKind): string[] {
  if (kind === "questions") return [ZERO_QUESTIONS_MESSAGE];
  if (kind === "answers") return [ZERO_ANSWERS_MESSAGE];
  return [ZERO_QUESTIONS_MESSAGE, ZERO_ANSWERS_MESSAGE];
}
