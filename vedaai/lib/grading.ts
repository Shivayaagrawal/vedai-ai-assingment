import type {
  ExtractPageInput,
  GradePair,
  GradeResult,
  GradeVerdict,
  MappedResult,
  SkippedGrade,
} from "./types";

export const GRADE_BATCH_SIZE = 8;
export const DEFAULT_MAX_MARKS = 10;

export const CROSSED_OUT_FEEDBACK_PREFIX =
  "Note for the teacher: this was the student's only answer for this question, but it was crossed out / struck through — treat the score with judgment rather than as final. ";

export const LOW_CONFIDENCE_FEEDBACK_PREFIX =
  "This pairing is low-confidence and may match the wrong question; the comments below are about the written text as given, not a confirmation that it belongs here. ";

const GRADABLE_STATUSES = new Set<MappedResult["status"]>([
  "matched",
  "low-confidence",
]);

const VERDICTS = new Set<GradeVerdict>([
  "correct",
  "partially-correct",
  "incorrect",
  "not-gradable",
]);

export const GRADE_PROMPT_INSTRUCTIONS = `You are grading student exam answers.
Use BOTH the OCR text in INPUT_PAIRS AND the attached answer-sheet page image(s) when images are provided. The image is the source of truth for handwriting, diagrams, ticks, and teacher marks.

Return a JSON array of objects:
{questionId, score, maxScore, verdict, feedback}

Rules:
- maxScore MUST equal that pair's maxMarks. Never default a 2-mark question to /10. Scores look like 2/2, 1/2, 0/2 depending on the question.
- Always write specific feedback: what was right, what was wrong, and why the score is that number. Do not leave feedback empty.
- Grade from the image when answerText is empty or thin — diagrams, labelled figures, and handwriting in the boxed region still count.
- regions are normalized 0–1 boxes on that page; look at that area of the matching page image.
- If the sheet already has green boxes/ticks or red boxes/crosses (teacher marks), treat green as credit and red as error, then confirm against the question. Mention those marks in feedback when you use them.
- If answerText is empty AND there are no regions and no image to inspect, verdict = "not-gradable", score = null, feedback noting nothing visual was available.
- If flagged is "crossed-out", this is the student's ONLY answer for this question but it was crossed out/struck through — grade it as normal but prepend the feedback with a note that this answer was crossed out, so the teacher knows to treat the score with judgment rather than as final.
- If matchConfidence is 0.3 or 0.5 (a low-confidence match), the pairing of this answer to this question may be wrong. Grade the answer as given, but in feedback, do not assert the pairing is correct — phrase feedback neutrally in case the match itself needs teacher review. Do not write as if you know this answer belongs to this question (avoid phrasing like "the student correctly explained [the question's topic]").

verdict must be one of: correct, partially-correct, incorrect, not-gradable.
score is a number from 0 to maxScore, or null when not-gradable.
Use the input questionId values exactly. Do not invent ids.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function skipReasonFor(result: MappedResult): string | null {
  if (result.question.needsReview) {
    return "needsReview — ambiguous continuation, not graded";
  }
  if (result.status === "unanswered") {
    return "unanswered — no mapped answer to grade";
  }
  if (result.status === "not-attempted-choice") {
    return "not-attempted-choice — nothing to grade";
  }
  if (result.status === "unmatched") {
    return "unmatched — leftover answers are not graded via this route";
  }
  if (!GRADABLE_STATUSES.has(result.status) || result.answer === null) {
    return `${result.status} — no gradable answer`;
  }
  return null;
}

export function collectGradePairs(results: MappedResult[]): {
  pairs: GradePair[];
  skipped: SkippedGrade[];
} {
  const pairs: GradePair[] = [];
  const skipped: SkippedGrade[] = [];

  for (const result of results) {
    const reason = skipReasonFor(result);
    if (reason) {
      skipped.push({ questionId: result.question.id, reason });
      continue;
    }

    const answer = result.answer;
    if (!answer) {
      skipped.push({
        questionId: result.question.id,
        reason: "no answer object to grade",
      });
      continue;
    }

    pairs.push({
      questionId: result.question.id,
      questionText: result.question.text,
      maxMarks: result.question.maxMarks ?? null,
      answerText: answer.text,
      matchConfidence: result.matchConfidence,
      regions: answer.regions,
      ...(result.flagged === "crossed-out"
        ? { flagged: "crossed-out" as const }
        : {}),
    });
  }

  return { pairs, skipped };
}

export function parseGradeRequestBody(body: unknown):
  | { ok: true; results: MappedResult[] }
  | { ok: false; error: string } {
  const raw = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.results)
      ? body.results
      : isRecord(body) && Array.isArray(body.mappings)
        ? body.mappings
        : null;

  if (!raw) {
    return {
      ok: false,
      error:
        "Request body must be MappedResult[] or { results: MappedResult[] }. unmatchedAnswers are ignored and never graded.",
    };
  }

  const results: MappedResult[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item) || !isRecord(item.question)) {
      return {
        ok: false,
        error: `Mapped result at index ${index} must include a question object.`,
      };
    }
    if (typeof item.question.id !== "string" || item.question.id.trim() === "") {
      return {
        ok: false,
        error: `Mapped result at index ${index} is missing question.id.`,
      };
    }
    results.push(item as MappedResult);
  }

  return { ok: true, results };
}

export function parseAnswerPagesFromBody(body: unknown): ExtractPageInput[] {
  if (!isRecord(body) || !Array.isArray(body.answerPages)) return [];
  const pages: ExtractPageInput[] = [];
  for (const item of body.answerPages) {
    if (!isRecord(item)) continue;
    const pageNumber =
      typeof item.pageNumber === "number" && Number.isFinite(item.pageNumber)
        ? item.pageNumber
        : null;
    const imageBase64 =
      typeof item.imageBase64 === "string" ? item.imageBase64 : "";
    if (pageNumber === null || imageBase64.trim() === "") continue;
    pages.push({ pageNumber, imageBase64 });
  }
  return pages;
}

function maxScoreForQuestion(result: MappedResult): number {
  if (
    typeof result.question.maxMarks === "number" &&
    Number.isFinite(result.question.maxMarks)
  ) {
    return result.question.maxMarks;
  }
  return DEFAULT_MAX_MARKS;
}

export function skippedQuestionGrades(results: MappedResult[]): GradeResult[] {
  const grades: GradeResult[] = [];
  for (const result of results) {
    const maxScore = maxScoreForQuestion(result);

    if (result.question.needsReview) {
      grades.push({
        questionId: result.question.id,
        score: null,
        maxScore,
        verdict: "not-gradable",
        feedback:
          "This question needs teacher review (ambiguous continuation) and was not auto-graded.",
      });
      continue;
    }

    if (
      result.status !== "unanswered" &&
      result.status !== "not-attempted-choice"
    ) {
      continue;
    }

    const feedback =
      result.status === "not-attempted-choice"
        ? "This optional question was not attempted."
        : "No answer was found for this question.";

    grades.push({
      questionId: result.question.id,
      score: 0,
      maxScore,
      verdict: "incorrect",
      feedback,
    });
  }
  return grades;
}

/**
 * Card/highlight colors before Gemini returns. Not used for the total-score
 * summary — matched/low-confidence scores stay null so they do not inflate
 * the running total. Figma badges are real scores; the pending "–/max"
 * label is inferred so green / amber / red show immediately.
 */
export function previewDisplayGrades(results: MappedResult[]): GradeResult[] {
  const grades: GradeResult[] = [];
  for (const result of results) {
    if (result.question.needsReview) continue;
    if (
      result.status === "unanswered" ||
      result.status === "not-attempted-choice"
    ) {
      continue;
    }
    if (result.status !== "matched" && result.status !== "low-confidence") {
      continue;
    }
    const maxScore = maxScoreForQuestion(result);
    grades.push({
      questionId: result.question.id,
      score: null,
      maxScore,
      verdict:
        result.status === "low-confidence" ? "partially-correct" : "correct",
      feedback: "",
    });
  }
  return grades;
}

function pageNumbersForPair(pair: GradePair): number[] {
  const pages = new Set<number>();
  for (const region of pair.regions ?? []) {
    if (Number.isFinite(region.page)) pages.add(region.page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function imagesForGradeBatch(
  batch: GradePair[],
  answerPages: ExtractPageInput[],
): ExtractPageInput[] {
  const wanted = new Set<number>();
  for (const pair of batch) {
    for (const page of pageNumbersForPair(pair)) wanted.add(page);
  }
  if (wanted.size === 0) return [];
  return answerPages.filter((page) => wanted.has(page.pageNumber));
}

export function chunkPairs<T>(items: T[], size = GRADE_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export function pairsForModel(batch: GradePair[]): GradePair[] {
  return batch.map((pair) => ({
    ...pair,
    maxMarks: pair.maxMarks ?? DEFAULT_MAX_MARKS,
  }));
}

export function buildGradePrompt(batch: GradePair[]): string {
  return `${GRADE_PROMPT_INSTRUCTIONS}

INPUT_PAIRS:
${JSON.stringify(pairsForModel(batch))}`;
}

function parseVerdict(value: unknown): GradeVerdict | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (VERDICTS.has(normalized as GradeVerdict)) {
    return normalized as GradeVerdict;
  }
  if (normalized === "partial" || normalized === "partially correct") {
    return "partially-correct";
  }
  if (normalized === "not gradable" || normalized === "ungradable") {
    return "not-gradable";
  }
  return null;
}

function mentionsCrossedOut(feedback: string): boolean {
  return /crossed[\s-]?out|struck[\s-]?through/i.test(feedback);
}

function mentionsLowConfidence(feedback: string): boolean {
  return /low[-\s]?confidence|may be wrong|may match the wrong|pairing may|not a confirmation that it belongs/i.test(
    feedback,
  );
}

function isLowConfidenceMatch(confidence: number): boolean {
  return confidence === 0.3 || confidence === 0.5;
}

function pairHasVisualAnswer(pair: GradePair): boolean {
  return (pair.regions ?? []).length > 0;
}

export function applyGradeGuarantees(
  result: GradeResult,
  pair: GradePair,
): GradeResult {
  const maxScore = pair.maxMarks ?? DEFAULT_MAX_MARKS;
  let next: GradeResult = {
    ...result,
    questionId: pair.questionId,
    maxScore,
  };

  const emptyText = pair.answerText.trim() === "";
  if (emptyText && !pairHasVisualAnswer(pair)) {
    next = {
      ...next,
      score: null,
      maxScore,
      verdict: "not-gradable",
      feedback:
        next.feedback.trim() ||
        "A diagram was detected but was not evaluated as text.",
    };
    if (!/diagram/i.test(next.feedback)) {
      next.feedback =
        "A diagram was detected but was not evaluated as text. " + next.feedback;
    }
  }

  if (pair.flagged === "crossed-out" && !mentionsCrossedOut(next.feedback)) {
    next = {
      ...next,
      feedback: CROSSED_OUT_FEEDBACK_PREFIX + next.feedback,
    };
  }

  if (isLowConfidenceMatch(pair.matchConfidence) && !mentionsLowConfidence(next.feedback)) {
    next = {
      ...next,
      feedback: LOW_CONFIDENCE_FEEDBACK_PREFIX + next.feedback,
    };
  }

  if (next.verdict === "not-gradable") {
    next = { ...next, score: null };
  } else {
    const cap = next.maxScore ?? maxScore;
    let score = typeof next.score === "number" ? next.score : null;
    if (score === null) {
      if (next.verdict === "correct") score = cap;
      else if (next.verdict === "incorrect") score = 0;
      else score = Math.round((cap / 2) * 10) / 10;
    }
    next = {
      ...next,
      score: Math.min(cap, Math.max(0, score)),
      maxScore: cap,
    };
  }

  if (!next.feedback.trim()) {
    next = {
      ...next,
      feedback:
        next.verdict === "correct"
          ? "The answer matches the question."
          : next.verdict === "incorrect"
            ? "The answer does not match what the question asked."
            : next.verdict === "partially-correct"
              ? "The answer is only partly correct."
              : "This answer could not be graded automatically.",
    };
  }

  return next;
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonPayload(raw: string): string {
  const stripped = stripCodeFences(raw);
  const arrayStart = stripped.indexOf("[");
  const arrayEnd = stripped.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return stripped.slice(arrayStart, arrayEnd + 1);
  }
  return stripped;
}

export function parseGradeResultsJson(
  rawText: string,
  validIds: Set<string>,
): GradeResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(rawText));
  } catch (error) {
    console.error("[grading] JSON.parse failed. Raw response text:\n", rawText);
    console.error(error);
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.grades)
      ? parsed.grades
      : isRecord(parsed) && Array.isArray(parsed.results)
        ? parsed.results
        : null;

  if (!items) {
    console.error(
      "[grading] Expected a JSON array of grade objects. Raw response text:\n",
      rawText,
    );
    return [];
  }

  const seen = new Set<string>();
  const results: GradeResult[] = [];

  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      console.warn(`[grading] Skipping non-object grade at index ${index}`);
      continue;
    }

    const questionId =
      typeof item.questionId === "string" ? item.questionId.trim() : "";
    if (!questionId) {
      console.warn(`[grading] Dropping grade at index ${index}: missing questionId`);
      continue;
    }
    if (!validIds.has(questionId)) {
      console.warn(
        `[grading] Dropping hallucinated questionId from model response: ${questionId}`,
      );
      continue;
    }
    if (seen.has(questionId)) {
      console.warn(
        `[grading] Dropping duplicate questionId in model response: ${questionId}`,
      );
      continue;
    }

    const verdict = parseVerdict(item.verdict);
    if (!verdict) {
      console.warn(
        `[grading] Dropping ${questionId}: invalid verdict`,
        item.verdict,
      );
      continue;
    }

    const score =
      item.score === null || item.score === undefined
        ? null
        : asFiniteNumber(item.score);

    const maxScore = asFiniteNumber(item.maxScore);
    const feedback =
      typeof item.feedback === "string" ? item.feedback.trim() : "";

    seen.add(questionId);
    results.push({
      questionId,
      score: verdict === "not-gradable" ? null : score,
      maxScore,
      verdict,
      feedback,
    });
  }

  return results;
}

function missingGradeFallback(pair: GradePair): GradeResult {
  return applyGradeGuarantees(
    {
      questionId: pair.questionId,
      score: null,
      maxScore: pair.maxMarks ?? DEFAULT_MAX_MARKS,
      verdict: "not-gradable",
      feedback: "Grading model did not return a result for this question.",
    },
    pair,
  );
}

export async function gradeAnswerBatches(
  pairs: GradePair[],
  generateJson: (prompt: string, batch: GradePair[]) => Promise<string>,
): Promise<GradeResult[]> {
  if (pairs.length === 0) {
    return [];
  }

  const merged: GradeResult[] = [];
  const gradedIds = new Set<string>();

  for (const batch of chunkPairs(pairs)) {
    const validIds = new Set(batch.map((pair) => pair.questionId));
    const rawText = await generateJson(buildGradePrompt(batch), batch);
    const parsed = parseGradeResultsJson(rawText, validIds);
    const byId = new Map(parsed.map((item) => [item.questionId, item]));

    for (const pair of batch) {
      if (gradedIds.has(pair.questionId)) {
        console.warn(
          `[grading] Skipping already-graded questionId across batches: ${pair.questionId}`,
        );
        continue;
      }
      const raw = byId.get(pair.questionId) ?? missingGradeFallback(pair);
      const guaranteed = applyGradeGuarantees(raw, pair);
      gradedIds.add(pair.questionId);
      merged.push(guaranteed);
    }
  }

  return merged;
}
