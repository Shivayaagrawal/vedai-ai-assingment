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
 * Extract sends every page as JPEG/PNG base64 in one JSON body.
 * Vercel serverless request bodies are typically capped around 4.5MB.
 * Client + API both enforce MAX_EXTRACT_PAGES (see lib/upload-file.ts) so a
 * multi-page paper cannot silently 413 on deploy while working locally.
 * Rate limits (429) are separate from that payload ceiling.
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

export async function extractQuestionsRequest(
  pages: ExtractPageInput[],
): Promise<QuestionsExtract> {
  const json = await postExtract("/api/extract-questions", pages, "questions");
  if (!isRecord(json) || !Array.isArray(json.questions)) {
    throw new ExtractRequestError(
      "questions",
      false,
      "Question extraction returned an unexpected payload.",
    );
  }
  const questions = json.questions as Question[];
  const warnings = parseWarnings(json.warnings);
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
): Promise<AnswersExtract> {
  const json = await postExtract("/api/extract-answers", pages, "answers");
  if (!isRecord(json) || !Array.isArray(json.answers)) {
    throw new ExtractRequestError(
      "answers",
      false,
      "Answer extraction returned an unexpected payload.",
    );
  }
  const answers = json.answers as Answer[];
  const warnings = parseWarnings(json.warnings);
  if (
    answers.length === 0 &&
    warnings.length > 0 &&
    warnings.every(warningIsRateLimit)
  ) {
    throw new ExtractRequestError("answers", true, RATE_LIMIT_MESSAGE);
  }
  return { answers, warnings };
}
