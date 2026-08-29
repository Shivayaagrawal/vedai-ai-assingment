import { GoogleGenerativeAIFetchError } from "@google/generative-ai";

export class GeminiRateLimitError extends Error {
  readonly status = 429;

  constructor(
    message = "Gemini rate limit reached. Wait a moment and try again.",
  ) {
    super(message);
    this.name = "GeminiRateLimitError";
  }
}

export function isGeminiRateLimitError(error: unknown): boolean {
  if (error instanceof GeminiRateLimitError) return true;
  if (error instanceof GoogleGenerativeAIFetchError && error.status === 429) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|RESOURCE_EXHAUSTED|rate[\s-]?limit/i.test(message);
}

/** Initial try plus two waits. Tuned for RPM 429s that return immediately. */
export const RATE_LIMIT_MAX_ATTEMPTS = 3;

/** 20s then 40s — long enough to absorb a per-minute burst, short enough for a 130s page budget. */
export const RATE_LIMIT_BACKOFF_MS = [20_000, 40_000] as const;

export type RateLimitRetryOptions = {
  maxAttempts?: number;
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; waitMs: number; error: unknown }) => void;
};

export function backoffMsForAttempt(
  failedAttempt: number,
  backoffMs: readonly number[] = RATE_LIMIT_BACKOFF_MS,
): number {
  if (backoffMs.length === 0) return 20_000;
  const index = Math.min(Math.max(failedAttempt - 1, 0), backoffMs.length - 1);
  return backoffMs[index];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry the same call after a wait when Gemini returns 429 / RESOURCE_EXHAUSTED.
 * Non-rate-limit errors throw immediately. Daily-quota exhaustion still fails
 * after maxAttempts — this only absorbs short RPM bursts.
 */
export async function withRateLimitRetry<T>(
  run: () => Promise<T>,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RATE_LIMIT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? RATE_LIMIT_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const canRetry =
        isGeminiRateLimitError(error) && attempt < maxAttempts;
      if (!canRetry) throw error;
      const waitMs = backoffMsForAttempt(attempt, backoffMs);
      options.onRetry?.({ attempt, waitMs, error });
      await sleep(waitMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new GeminiRateLimitError();
}
