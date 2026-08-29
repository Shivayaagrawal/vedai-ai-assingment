import { NextResponse } from "next/server";
import {
  RetryableTimeoutError,
  extractAnswersBatch,
  parseExtractPagesBody,
} from "../../../lib/extract-batch";
import { GeminiRateLimitError, isGeminiRateLimitError } from "../../../lib/gemini";
import { RATE_LIMIT_MESSAGE } from "../../../lib/extract-client";

// Must be a numeric literal — Next.js cannot resolve imported constants here.
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsed = parseExtractPagesBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { answers, warnings } = await extractAnswersBatch(parsed.pages);
    return NextResponse.json({ answers, warnings });
  } catch (error) {
    if (error instanceof RetryableTimeoutError) {
      return NextResponse.json(
        { error: error.message, retryable: true },
        { status: 504 },
      );
    }

    if (error instanceof GeminiRateLimitError || isGeminiRateLimitError(error)) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const message =
      error instanceof Error ? error.message : "Answer extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
