import { NextResponse } from "next/server";
import { GeminiRateLimitError, gradeAnswers } from "../../../lib/gemini";
import {
  collectGradePairs,
  parseAnswerPagesFromBody,
  parseGradeRequestBody,
} from "../../../lib/grading";

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

    const parsed = parseGradeRequestBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { pairs, skipped } = collectGradePairs(parsed.results);
    const answerPages = parseAnswerPagesFromBody(body);
    const grades = await gradeAnswers(pairs, undefined, answerPages);
    return NextResponse.json({ grades, skipped });
  } catch (error) {
    if (error instanceof GeminiRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    const message =
      error instanceof Error ? error.message : "Grading failed.";
    const timeout = /timeout/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: timeout ? 504 : 500 },
    );
  }
}
