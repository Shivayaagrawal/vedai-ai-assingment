import {
  GeminiRateLimitError,
  extractAnswersFromPage,
  isGeminiRateLimitError,
} from "./gemini";
import { extractQuestionsFromFullPage } from "./extract-questions-split";
import { MAX_EXTRACT_PAGES, pageCountLimitMessage } from "./upload-file";
import { assignAnswerIds } from "./answer-ids";
import {
  stitchAnswerContinuations,
  stitchQuestionContinuations,
} from "./continuation-stitching";
import type {
  Answer,
  ExtractPageInput,
  ExtractWarning,
  PageTextItem,
  Question,
} from "./types";

export const EXTRACT_CONCURRENCY = 3;
export const PAGE_TIMEOUT_MS = 130_000;
/** Two sequential half-page Gemini calls, plus one optional completeness retry. */
export const QUESTIONS_PAGE_TIMEOUT_MS = 260_000;
/** Route budget: enough for several concurrency waves at Gemini's ~120s cap, plus buffer. */
export const ROUTE_TIMEOUT_MS = 290_000;
export const MAX_DURATION_SECONDS = 300;

export class RetryableTimeoutError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "RetryableTimeoutError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeBase64Payload(value: string): boolean {
  const trimmed = value.trim();
  const dataUrl = trimmed.match(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/,
  );
  const payload = (dataUrl ? dataUrl[1] : trimmed).replace(/\s/g, "");
  if (payload.length < 8) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(payload);
}

function parseOptionalTextItems(value: unknown): PageTextItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items: PageTextItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.text !== "string" || typeof entry.y !== "number") continue;
    if (!Number.isFinite(entry.y)) continue;
    items.push({ text: entry.text, y: entry.y });
  }
  return items.length > 0 ? items : undefined;
}

export function parseExtractPagesBody(
  body: unknown,
): { ok: true; pages: ExtractPageInput[] } | { ok: false; error: string } {
  const raw = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.pages)
      ? body.pages
      : null;

  if (!raw) {
    return {
      ok: false,
      error:
        "Request body must be a non-empty JSON array of { pageNumber, imageBase64 } (or { pages: [...] }).",
    };
  }

  if (raw.length === 0) {
    return {
      ok: false,
      error: "Request body must include at least one page.",
    };
  }

  if (raw.length > MAX_EXTRACT_PAGES) {
    return {
      ok: false,
      error: pageCountLimitMessage(),
    };
  }

  const pages: ExtractPageInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      return {
        ok: false,
        error: `Page at index ${index} must be an object with pageNumber and imageBase64.`,
      };
    }

    const pageNumber = item.pageNumber;
    if (typeof pageNumber !== "number" || !Number.isFinite(pageNumber)) {
      return {
        ok: false,
        error: `Page at index ${index} is missing a numeric pageNumber.`,
      };
    }

    const imageBase64 = item.imageBase64;
    if (typeof imageBase64 !== "string" || imageBase64.trim() === "") {
      return {
        ok: false,
        error: `Page ${pageNumber} is missing a non-empty imageBase64 string.`,
      };
    }

    const page: ExtractPageInput = { pageNumber, imageBase64 };
    const textItems = parseOptionalTextItems(item.textItems);
    if (textItems) page.textItems = textItems;
    pages.push(page);
  }

  return { ok: true, pages };
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RetryableTimeoutError(message));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const limit = Math.max(1, concurrency);

  for (let start = 0; start < items.length; start += limit) {
    const slice = items.slice(start, start + limit);
    const settled = await Promise.allSettled(
      slice.map((item, offset) => worker(item, start + offset)),
    );
    for (const [offset, result] of settled.entries()) {
      results[start + offset] = result;
    }
  }

  return results;
}

export function formatPageError(page: number, error: unknown): string {
  if (error instanceof RetryableTimeoutError) {
    return `Page ${page} timed out. This is retryable — resend this page.`;
  }
  if (error instanceof GeminiRateLimitError || isGeminiRateLimitError(error)) {
    return `Page ${page} hit Gemini's rate limit (429). Wait a moment and retry this page.`;
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return `Page ${page} timed out. This is retryable — resend this page.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Page ${page} failed: ${message}`;
}

async function extractPage<T>(
  page: ExtractPageInput,
  run: (page: ExtractPageInput) => Promise<T>,
  timeoutMs: number = PAGE_TIMEOUT_MS,
): Promise<T> {
  if (!looksLikeBase64Payload(page.imageBase64)) {
    throw new Error("imageBase64 is not valid base64 (or a data URL).");
  }

  return withTimeout(
    run(page),
    timeoutMs,
    `Page ${page.pageNumber} timed out`,
  );
}

function flattenSettled<T>(
  pages: ExtractPageInput[],
  settled: PromiseSettledResult<T[]>[],
): { items: T[]; warnings: ExtractWarning[] } {
  const items: T[] = [];
  const warnings: ExtractWarning[] = [];

  for (const [index, result] of settled.entries()) {
    const page = pages[index].pageNumber;
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      warnings.push({
        page,
        message: formatPageError(page, result.reason),
      });
    }
  }

  return { items, warnings };
}

function byPageThenOrder<T extends { page: number }>(left: T, right: T): number {
  return left.page - right.page;
}

export { assignAnswerIds };

export async function extractQuestionsBatch(
  pages: ExtractPageInput[],
): Promise<{ questions: Question[]; warnings: ExtractWarning[] }> {
  const settled = await withTimeout(
    mapSettledWithConcurrency(pages, EXTRACT_CONCURRENCY, (page) =>
      extractPage(
        page,
        (input) => extractQuestionsFromFullPage(input),
        QUESTIONS_PAGE_TIMEOUT_MS,
      ),
    ),
    ROUTE_TIMEOUT_MS,
    "The extract-questions request timed out. This is retryable — send fewer pages or retry.",
  );

  const { items, warnings } = flattenSettled(pages, settled);
  // Stable sort by page only — never by displayNumber, so number-gaps stay as printed.
  // Stitch after split-page concat/dedup so a half-page duplicate cannot stitch to itself.
  const questions = stitchQuestionContinuations(
    [...items].sort(byPageThenOrder),
  );
  return { questions, warnings };
}

export async function extractAnswersBatch(
  pages: ExtractPageInput[],
): Promise<{ answers: Answer[]; warnings: ExtractWarning[] }> {
  const settled = await withTimeout(
    mapSettledWithConcurrency(pages, EXTRACT_CONCURRENCY, (page) =>
      extractPage(page, (input) =>
        extractAnswersFromPage(input.imageBase64, input.pageNumber),
      ),
    ),
    ROUTE_TIMEOUT_MS,
    "The extract-answers request timed out. This is retryable — send fewer pages or retry.",
  );

  const { items, warnings } = flattenSettled(pages, settled);
  const ordered = [...items].sort((left, right) => {
    const pageLeft = left.regions[0]?.page ?? 0;
    const pageRight = right.regions[0]?.page ?? 0;
    return pageLeft - pageRight;
  });
  return {
    answers: assignAnswerIds(stitchAnswerContinuations(ordered)),
    warnings,
  };
}
