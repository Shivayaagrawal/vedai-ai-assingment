import { RATE_LIMIT_MESSAGE } from "./extract-client";
import type {
  ExtractPageInput,
  GradeResult,
  MappedResult,
  SkippedGrade,
} from "./types";

export type GradeResponse = {
  grades: GradeResult[];
  skipped: SkippedGrade[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function requestGrades(
  results: MappedResult[],
  answerPages: ExtractPageInput[] = [],
): Promise<GradeResponse> {
  const response = await fetch("/api/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results, answerPages }),
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
      : `Grading failed (${response.status})`;

  if (response.status === 429) {
    throw new Error(RATE_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  const grades =
    isRecord(json) && Array.isArray(json.grades)
      ? (json.grades as GradeResult[])
      : [];
  const skipped =
    isRecord(json) && Array.isArray(json.skipped)
      ? (json.skipped as SkippedGrade[])
      : [];

  return { grades, skipped };
}
