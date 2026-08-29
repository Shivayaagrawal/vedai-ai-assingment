import type { Answer, MappedResult, Question } from "./types";

export type UnmatchedAnswer = {
  answer: Answer;
  note?: string;
};

export type MappingOutput = {
  results: MappedResult[];
  unmatchedAnswers: UnmatchedAnswer[];
};

export function normalizeNumber(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^q\s*/i, "")
    .replace(/[\s.]+/g, "")
    .replace(/[()]/g, "");
}

export function questionMatchKey(question: Question): string {
  const display = question.displayNumber ?? "";
  const sub = question.subPart ?? "";
  if (!sub) return normalizeNumber(display);

  const displayNorm = normalizeNumber(display);
  const subNorm = normalizeNumber(sub);
  if (subNorm && displayNorm.includes(subNorm)) {
    return displayNorm;
  }
  return normalizeNumber(`${display}${sub}`);
}

function answerPage(answer: Answer): number {
  return answer.regions[0]?.page ?? Number.POSITIVE_INFINITY;
}

function hasLabel(answer: Answer): boolean {
  const raw = answer.detectedQuestionNumber;
  return typeof raw === "string" && raw.trim() !== "";
}

function answerKey(answer: Answer): string | null {
  if (!hasLabel(answer)) return null;
  return normalizeNumber(answer.detectedQuestionNumber as string);
}

function isCrossedOut(answer: Answer): boolean {
  return answer.isCrossedOut === true;
}

function compareByPageThenPosition(left: Answer, right: Answer): number {
  const pageDiff = answerPage(left) - answerPage(right);
  if (pageDiff !== 0) return pageDiff;
  const ly = left.regions[0]?.y ?? 0;
  const ry = right.regions[0]?.y ?? 0;
  if (ly !== ry) return ly - ry;
  return (left.regions[0]?.x ?? 0) - (right.regions[0]?.x ?? 0);
}

function closestQuestion(
  answer: Answer,
  candidates: Question[],
): Question {
  const page = answerPage(answer);
  return [...candidates].sort((a, b) => {
    const da = Math.abs(a.page - page);
    const db = Math.abs(b.page - page);
    if (da !== db) return da - db;
    return a.page - b.page;
  })[0];
}

const OVERLAP_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "one",
  "its",
  "not",
  "but",
  "all",
  "any",
  "into",
]);

export function contentTokens(text: string, minTokenLength = 2): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < minTokenLength) continue;
    if (OVERLAP_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

/**
 * Jaccard overlap of content tokens.
 *
 * Do not collapse Pin #1 and unlabeled fallback onto one minTokenLength.
 * Labeled duplicate-key collisions (A2/B2) keep the default of 2 so short
 * content words still score ("si", "fe"). Unlabeled fallback uses 3 because
 * formula fragments like "o2" are unique-but-wrong signal: the real
 * photosynthesis-equation orphan scored higher against Q10 (Fe2O3) than B2
 * at length 2, which would steal a chemistry balance question. Length 3
 * drops "o2"/"fe" and leaves "photosynthesis". A future "simplify to one
 * threshold" refactor would reintroduce that steal.
 */
export function contentOverlapScore(
  answerText: string,
  questionText: string,
  minTokenLength = 2,
): number {
  const answerTokens = contentTokens(answerText, minTokenLength);
  const questionTokens = contentTokens(questionText, minTokenLength);
  if (answerTokens.size === 0 || questionTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of answerTokens) {
    if (questionTokens.has(token)) intersection += 1;
  }
  const union = answerTokens.size + questionTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function uniqueNearestPageQuestion(
  answer: Answer,
  candidates: Question[],
): Question | null {
  if (candidates.length === 1) return candidates[0];
  const page = answerPage(answer);
  const ranked = [...candidates].sort((a, b) => {
    const da = Math.abs(a.page - page);
    const db = Math.abs(b.page - page);
    if (da !== db) return da - db;
    return a.page - b.page;
  });
  const closest = ranked[0];
  const next = ranked[1];
  if (!next) return closest;
  if (Math.abs(closest.page - page) < Math.abs(next.page - page)) {
    return closest;
  }
  return null;
}

function answerIsStrictlyAfterEveryCandidate(
  answer: Answer,
  candidates: Question[],
): boolean {
  const page = answerPage(answer);
  if (!Number.isFinite(page)) return false;
  return candidates.every((question) => question.page < page);
}

function uniqueOverlapWinner(
  answer: Answer,
  candidates: Question[],
  minTokenLength = 2,
): Question | null {
  const scored = candidates.map((question) => ({
    question,
    score: contentOverlapScore(answer.text, question.text, minTokenLength),
  }));
  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score <= 0) return null;
  if (runnerUp && best.score <= runnerUp.score) return null;
  return best.question;
}

/**
 * Intentionally not shared with uniqueOverlapWinner's default (2). See
 * contentOverlapScore — "o2" uniquely ranked Q10 over B2 on the real orphan.
 */
const POSITIONAL_OVERLAP_MIN_TOKEN = 3;

function pickPositionalFallbackQuestion(
  answer: Answer,
  stillOpen: Question[],
): Question {
  return (
    uniqueOverlapWinner(answer, stillOpen, POSITIONAL_OVERLAP_MIN_TOKEN) ??
    stillOpen[0]
  );
}

/**
 * Duplicate printed numbers (A2 vs B2): answers have no section field.
 * - Unique nearest page when the answer is NOT strictly after every candidate
 *   (A1 on p1 vs B1 on p2).
 * - If the answer trails every candidate (newton Q2 on p3), Jaccard can override
 *   nearest-page — that is the A2/B2 bug. Sparse text (no unique overlap) falls
 *   back to unique-nearest so last-page correctly-labeled answers stay as before.
 * - Paper order only when nearest is also tied.
 */
function pickDuplicateKeyQuestion(
  answer: Answer,
  candidates: Question[],
  paperOrder: Question[],
): Question {
  const nearest = uniqueNearestPageQuestion(answer, candidates);
  const strictlyAfter = answerIsStrictlyAfterEveryCandidate(answer, candidates);

  if (nearest && !strictlyAfter) return nearest;

  const overlapWinner = uniqueOverlapWinner(answer, candidates);
  if (overlapWinner) return overlapWinner;

  if (nearest) return nearest;

  const paperIndex = (question: Question) => {
    const index = paperOrder.findIndex((item) => item.id === question.id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return [...candidates].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page;
    return paperIndex(left) - paperIndex(right);
  })[0];
}

function alternativePartner(
  question: Question,
  questions: Question[],
): Question | undefined {
  if (!question.isAlternativeOf) return undefined;
  const target = normalizeNumber(question.isAlternativeOf);
  return questions.find((other) => {
    if (other.id === question.id) return false;
    return (
      normalizeNumber(other.displayNumber) === target ||
      questionMatchKey(other) === target
    );
  });
}

function emptyResult(question: Question, status: MappedResult["status"]): MappedResult {
  return {
    question,
    answer: null,
    status,
    matchConfidence: 0,
  };
}

export function mapAnswersToQuestions(
  questions: Question[],
  answers: Answer[],
): MappingOutput {
  const byId = new Map<string, MappedResult>();
  const claimedAnswers = new Set<string>();
  const unmatchedAnswers: UnmatchedAnswer[] = [];

  const questionsByKey = new Map<string, Question[]>();
  for (const question of questions) {
    const key = questionMatchKey(question);
    const list = questionsByKey.get(key) ?? [];
    list.push(question);
    questionsByKey.set(key, list);
  }

  const labeled = answers.filter(hasLabel);
  const unlabeled = answers.filter((answer) => !hasLabel(answer));
  // Known limitation: a crossed-out block labeled "Q7" plus a nearby *unlabeled*
  // clean rewrite. Same-label logic prefers the labeled (crossed-out) block and
  // never binds the unlabeled rewrite to Q7. That needs semantic judgment, not
  // another key rule — do not treat it as a regression of the same-label tests.

  // Claim clean labeled answers before crossed-out ones so a rewrite wins.
  const labeledOrdered = [...labeled].sort((a, b) => {
    if (isCrossedOut(a) !== isCrossedOut(b)) return isCrossedOut(a) ? 1 : -1;
    return compareByPageThenPosition(a, b);
  });

  for (const answer of labeledOrdered) {
    const key = answerKey(answer);
    if (!key) continue;
    const candidates = questionsByKey.get(key) ?? [];
    if (candidates.length === 0) {
      unmatchedAnswers.push({ answer });
      claimedAnswers.add(answer.id);
      continue;
    }

    const available = candidates.filter((question) => {
      const existing = byId.get(question.id);
      return !existing || existing.answer === null;
    });

    // If every candidate already has a clean match, this extra answer is leftover.
    const withSlots = available.length > 0 ? available : candidates;
    const question =
      candidates.length > 1
        ? pickDuplicateKeyQuestion(answer, withSlots, questions)
        : closestQuestion(answer, withSlots);
    const existing = byId.get(question.id);
    const duplicateKey = candidates.length > 1;
    const confidence = duplicateKey ? 0.5 : 0.9;
    const status = duplicateKey ? "low-confidence" : "matched";

    if (!existing || existing.answer === null) {
      byId.set(question.id, {
        question,
        answer,
        status,
        matchConfidence: confidence,
        ...(isCrossedOut(answer) ? { flagged: "crossed-out" as const } : {}),
      });
      claimedAnswers.add(answer.id);
      continue;
    }

    const existingAnswer = existing.answer;
    if (isCrossedOut(existingAnswer) && !isCrossedOut(answer)) {
      unmatchedAnswers.push({
        answer: existingAnswer,
        note: "Crossed-out; replaced by a later answer with the same question number.",
      });
      byId.set(question.id, {
        question,
        answer,
        status,
        matchConfidence: confidence,
      });
      claimedAnswers.add(answer.id);
      continue;
    }

    if (!isCrossedOut(existingAnswer) && isCrossedOut(answer)) {
      unmatchedAnswers.push({
        answer,
        note: "Crossed-out; a non-crossed-out answer for the same number was preferred.",
      });
      claimedAnswers.add(answer.id);
      continue;
    }

    unmatchedAnswers.push({
      answer,
      note: "Extra answer for a question that already has a match.",
    });
    claimedAnswers.add(answer.id);
  }

  for (const question of questions) {
    if (byId.has(question.id)) continue;
    const partner = alternativePartner(question, questions);
    if (!partner) continue;
    const partnerResult = byId.get(partner.id);
    const partnerMatched =
      partnerResult?.answer !== null &&
      partnerResult?.answer !== undefined &&
      (partnerResult.status === "matched" ||
        partnerResult.status === "low-confidence");
    if (partnerMatched) continue;

    const partnerAlsoUnassigned = !byId.has(partner.id);
    if (partnerAlsoUnassigned) {
      byId.set(question.id, emptyResult(question, "not-attempted-choice"));
      byId.set(partner.id, emptyResult(partner, "not-attempted-choice"));
    }
  }

  for (const question of questions) {
    if (!byId.has(question.id)) {
      byId.set(question.id, emptyResult(question, "unanswered"));
    }
  }

  const unansweredForFallback = questions.filter((question) => {
    const result = byId.get(question.id);
    if (!result || result.answer) return false;
    if (result.status === "not-attempted-choice") return false;
    const partner = alternativePartner(question, questions);
    if (partner) {
      const partnerResult = byId.get(partner.id);
      if (
        partnerResult?.answer &&
        (partnerResult.status === "matched" ||
          partnerResult.status === "low-confidence")
      ) {
        // Student chose the other option — do not fill this side positionally.
        return false;
      }
    }
    return result.status === "unanswered";
  });

  const unlabeledUnclaimed = unlabeled.filter(
    (answer) => !claimedAnswers.has(answer.id),
  );

  const questionsByPage = [...unansweredForFallback].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return questions.indexOf(a) - questions.indexOf(b);
  });
  const answersByPage = [...unlabeledUnclaimed].sort(compareByPageThenPosition);

  const claimedFallbackQuestions = new Set<string>();
  for (const answer of answersByPage) {
    const stillOpen = questionsByPage.filter(
      (question) => !claimedFallbackQuestions.has(question.id),
    );
    if (stillOpen.length === 0) break;
    const question = pickPositionalFallbackQuestion(answer, stillOpen);
    byId.set(question.id, {
      question,
      answer,
      status: "low-confidence",
      matchConfidence: 0.3,
      ...(isCrossedOut(answer) ? { flagged: "crossed-out" as const } : {}),
    });
    claimedFallbackQuestions.add(question.id);
    claimedAnswers.add(answer.id);
  }

  for (const answer of answers) {
    if (claimedAnswers.has(answer.id)) continue;
    unmatchedAnswers.push({ answer });
  }

  const results = questions.map((question) => byId.get(question.id)!);
  return { results, unmatchedAnswers };
}
