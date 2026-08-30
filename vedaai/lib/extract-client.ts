import {
  assignAnswerIds,
} from "./answer-ids";
import {
  stitchAnswerContinuations,
  stitchQuestionContinuations,
} from "./continuation-stitching";
import type { Answer, ExtractPageInput, ExtractWarning, Question } from "./types";

export const RATE_LIMIT_MESSAGE =
  "Rate limit reached — please wait a moment and retry";

export class ExtractRequestError extends Error {
  readonly failed: "questions" | "answers";
  readonly rateLimited: boolean;

  constructor(
    failed: "questions" | "answers",
    rateLimited: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ExtractRequestError";
    this.failed = failed;
    this.rateLimited = rateLimited;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeRateLimit(status: number, message: string): boolean {
  if (status === 429) return true;
  return /\b429\b|RESOURCE_EXHAUSTED|rate[\s-]?limit/i.test(message);
}

function warningIsRateLimit(warning: ExtractWarning): boolean {
  return /429|rate limit/i.test(warning.message);
}

export type QuestionsExtract = {
  questions: Question[];
  warnings: ExtractWarning[];
};

export type AnswersExtract = {
  answers: Answer[];
  warnings: ExtractWarning[];
};

function parseWarnings(value: unknown): ExtractWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: ExtractWarning[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.page !== "number" || typeof item.message !== "string") {
      continue;
    }
    warnings.push({ page: item.page, message: item.message });
  }
  return warnings;
}

/**
 * Extract sends each page as JPEG/PNG base64 so the UI can report
 * "page N of M" and each Vercel body stays under the ~4.5MB cap.
 */
async function postExtract(
  path: "/api/extract-questions" | "/api/extract-answers",
  pages: ExtractPageInput[],
  failed: "questions" | "answers",
): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages }),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  const errorMessage =
    isRecord(json) && typeof json.error === "string"
      ? json.error
      : `Request failed (${response.status})`;

  if (!response.ok) {
    throw new ExtractRequestError(
      failed,
      looksLikeRateLimit(response.status, errorMessage),
      looksLikeRateLimit(response.status, errorMessage)
        ? RATE_LIMIT_MESSAGE
        : errorMessage,
    );
  }

  return json;
}

export type PageProgressFn = (current: number, total: number) => void;

export async function extractQuestionsRequest(
  pages: ExtractPageInput[],
  onPage?: PageProgressFn,
): Promise<QuestionsExtract> {
  const collected: Question[] = [];
  const warnings: ExtractWarning[] = [];

  for (const [index, page] of pages.entries()) {
    onPage?.(index + 1, pages.length);
    try {
      const json = await postExtract(
        "/api/extract-questions",
        [page],
        "questions",
      );
      if (!isRecord(json) || !Array.isArray(json.questions)) {
        throw new ExtractRequestError(
          "questions",
          false,
          "Question extraction returned an unexpected payload.",
        );
      }
      collected.push(...(json.questions as Question[]));
      warnings.push(...parseWarnings(json.warnings));
    } catch (error) {
      if (error instanceof ExtractRequestError && error.rateLimited) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Question extraction failed.";
      warnings.push({
        page: page.pageNumber,
        message: `Page ${page.pageNumber} failed: ${message}`,
      });
    }
  }

  const questions = stitchQuestionContinuations(collected);
  if (
    questions.length === 0 &&
    warnings.length > 0 &&
    warnings.every(warningIsRateLimit)
  ) {
    throw new ExtractRequestError("questions", true, RATE_LIMIT_MESSAGE);
  }
  return { questions, warnings };
}

export async function extractAnswersRequest(
  pages: ExtractPageInput[],
  onPage?: PageProgressFn,
): Promise<AnswersExtract> {
  const collected: Answer[] = [];
  const warnings: ExtractWarning[] = [];

  for (const [index, page] of pages.entries()) {
    onPage?.(index + 1, pages.length);
    try {
      const json = await postExtract("/api/extract-answers", [page], "answers");
      if (!isRecord(json) || !Array.isArray(json.answers)) {
        throw new ExtractRequestError(
          "answers",
          false,
          "Answer extraction returned an unexpected payload.",
        );
      }
      collected.push(...(json.answers as Answer[]));
      warnings.push(...parseWarnings(json.warnings));
    } catch (error) {
      if (error instanceof ExtractRequestError && error.rateLimited) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Answer extraction failed.";
      warnings.push({
        page: page.pageNumber,
        message: `Page ${page.pageNumber} failed: ${message}`,
      });
    }
  }

  const answers = assignAnswerIds(stitchAnswerContinuations(collected));
  if (
    answers.length === 0 &&
    warnings.length > 0 &&
    warnings.every(warningIsRateLimit)
  ) {
    throw new ExtractRequestError("answers", true, RATE_LIMIT_MESSAGE);
  }
  return { answers, warnings };
}
