/**
 * Combined write-on-map pipeline (one image: printed numbered markers +
 * handwritten labels). Not two documents. Matching is exact marker number —
 * no paper-order positional fallback.
 *
 * Isolated from lib/matching.ts text-question mapping.
 */

import { SchemaType, type GenerationConfig } from "@google/generative-ai";
import {
  generateJsonWithFallback,
  isGeminiRateLimitError,
} from "./gemini";

export type ExtractedMapItem = {
  markerNumber: number | null;
  x: number;
  y: number;
  page: number;
  studentLabel: string | null;
};

export type MapMarker = {
  id: string;
  markerNumber: string;
  x: number;
  y: number;
  page: number;
};

export type MapLabel = {
  markerNumber: string;
  labelText: string;
  page: number;
};

export type MapMatchedPair = {
  marker: MapMarker;
  label: MapLabel;
};

export type MapMatchResult = {
  matched: MapMatchedPair[];
  unansweredMarkers: MapMarker[];
  orphanLabels: MapLabel[];
};

export type MapGradeVerdict = "correct" | "incorrect" | "not-attempted";

export type MapGrade = {
  markerNumber: string;
  studentLabel: string;
  verdict: MapGradeVerdict;
  correctAnswer?: string;
  feedback?: string;
};

const EXTRACT_PROMPT = `You are looking at ONE exam map image. Printed numbered
markers and any handwritten place-name labels are on this same page (write-on-map),
not a separate legend sheet.

Find every printed numbered marker (typically 1–6). For each, return:
- markerNumber: the printed integer, or null if the number is unreadable
- x, y: the marker centre as fractions (0–1) of image width/height
- studentLabel: handwritten place name on or next to that marker, or null if
  the marker has no handwriting

Do not invent markers. Do not merge two numbers into one object.
Return ONLY a JSON array, no markdown.`;

const extractConfig: GenerationConfig = {
  temperature: 0.1,
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        markerNumber: { type: SchemaType.NUMBER, nullable: true },
        x: { type: SchemaType.NUMBER },
        y: { type: SchemaType.NUMBER },
        studentLabel: { type: SchemaType.STRING, nullable: true },
      },
      required: ["x", "y"],
    },
  },
};

const GRADE_PROMPT_PREFIX = `You are grading handwritten labels on a school map
(write-on-map: numbers and labels are on the same image).

Use the IMAGE as the source of geographic truth — coastlines, relative
positions, any printed names. For each pair below, decide if the student's
label is the correct place for that printed marker number.

Return a JSON array of:
{ "markerNumber": "1", "studentLabel": "...", "verdict": "correct"|"incorrect"|"not-attempted", "correctAnswer": "..." or null, "feedback": "..." }

verdict "not-attempted" only if the student label is empty.
Use the given markerNumber strings exactly.
Pairs:
`;

const gradeConfig: GenerationConfig = {
  temperature: 0.2,
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        markerNumber: { type: SchemaType.STRING },
        studentLabel: { type: SchemaType.STRING },
        verdict: { type: SchemaType.STRING },
        correctAnswer: { type: SchemaType.STRING, nullable: true },
        feedback: { type: SchemaType.STRING },
      },
      required: ["markerNumber", "studentLabel", "verdict"],
    },
  },
};

const VERDICTS = new Set<MapGradeVerdict>([
  "correct",
  "incorrect",
  "not-attempted",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
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

function parseJsonArray(rawText: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(rawText));
    if (Array.isArray(parsed)) return parsed;
    console.error("[map-questions] Expected a JSON array. Raw:\n", rawText);
    return [];
  } catch (error) {
    console.error("[map-questions] JSON.parse failed. Raw:\n", rawText);
    console.error(error);
    return [];
  }
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asMarkerNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const match = value.trim().match(/(\d+)/);
    if (!match) return null;
    return Number.parseInt(match[1], 10);
  }
  return null;
}

export function normalizeMarkerNumber(
  raw: string | number | null | undefined,
): string {
  if (raw == null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const match = trimmed.match(/(\d+)/);
  return match ? String(Number.parseInt(match[1], 10)) : "";
}

export function parseMapExtractJson(
  rawText: string,
  pageNumber: number,
): ExtractedMapItem[] {
  return parseJsonArray(rawText)
    .map((item, index) => {
      if (!isRecord(item)) {
        console.warn(`[map-questions] Skipping non-object extract at ${index}`);
        return null;
      }
      if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) {
        console.warn(`[map-questions] Skipping extract at ${index}: missing x/y`);
        return null;
      }
      const label = asOptionalString(item.studentLabel);
      return {
        markerNumber: asMarkerNumber(item.markerNumber),
        x: clamp01(item.x),
        y: clamp01(item.y),
        page: pageNumber,
        studentLabel: label,
      } satisfies ExtractedMapItem;
    })
    .filter((item): item is ExtractedMapItem => item !== null);
}

export function parseMapGradesJson(rawText: string): MapGrade[] {
  return parseJsonArray(rawText)
    .map((item, index) => {
      if (!isRecord(item)) {
        console.warn(`[map-questions] Skipping non-object grade at ${index}`);
        return null;
      }
      const markerNumber = normalizeMarkerNumber(
        asOptionalString(item.markerNumber) ?? item.markerNumber,
      );
      const studentLabel = asOptionalString(item.studentLabel) ?? "";
      const verdictRaw = asOptionalString(item.verdict);
      if (!verdictRaw || !VERDICTS.has(verdictRaw as MapGradeVerdict)) {
        console.warn(
          `[map-questions] Skipping grade at ${index}: bad verdict`,
          item,
        );
        return null;
      }
      const grade: MapGrade = {
        markerNumber,
        studentLabel,
        verdict: verdictRaw as MapGradeVerdict,
      };
      const correct = asOptionalString(item.correctAnswer);
      if (correct) grade.correctAnswer = correct;
      const feedback = asOptionalString(item.feedback);
      if (feedback) grade.feedback = feedback;
      return grade;
    })
    .filter((item): item is MapGrade => item !== null);
}

export function extractedToMarkersAndLabels(extracted: ExtractedMapItem[]): {
  markers: MapMarker[];
  labels: MapLabel[];
} {
  const markers: MapMarker[] = extracted.map((item, index) => ({
    id: `marker-${item.markerNumber ?? "unknown"}-${index}`,
    markerNumber: normalizeMarkerNumber(item.markerNumber),
    x: item.x,
    y: item.y,
    page: item.page,
  }));
  const labels: MapLabel[] = extracted
    .filter((item) => item.studentLabel != null)
    .map((item) => ({
      markerNumber: normalizeMarkerNumber(item.markerNumber),
      labelText: item.studentLabel as string,
      page: item.page,
    }));
  return { markers, labels };
}

export function matchMapAnswers(
  markers: MapMarker[],
  labels: MapLabel[],
): MapMatchResult {
  const unused = [...markers];
  const matched: MapMatchedPair[] = [];
  const orphanLabels: MapLabel[] = [];

  for (const label of labels) {
    if (!label.markerNumber) {
      orphanLabels.push(label);
      continue;
    }
    const index = unused.findIndex(
      (marker) => marker.markerNumber === label.markerNumber,
    );
    if (index === -1) {
      orphanLabels.push(label);
      continue;
    }
    const [marker] = unused.splice(index, 1);
    matched.push({ marker, label });
  }

  return {
    matched,
    unansweredMarkers: unused,
    orphanLabels,
  };
}

export async function extractMapMarkersAndLabels(
  imageBase64: string,
  pageNumber: number,
): Promise<ExtractedMapItem[]> {
  try {
    const rawText = await generateJsonWithFallback(
      imageBase64,
      EXTRACT_PROMPT,
      extractConfig,
    );
    return parseMapExtractJson(rawText, pageNumber);
  } catch (error) {
    if (isGeminiRateLimitError(error)) throw error;
    console.error("[map-questions] extract failed", error);
    throw error;
  }
}

export async function gradeMapAnswers(
  imageBase64: string,
  matched: MapMatchedPair[],
): Promise<MapGrade[]> {
  if (matched.length === 0) return [];
  const pairLines = matched.map(
    (pair) =>
      `- marker ${pair.marker.markerNumber}: student wrote "${pair.label.labelText}"`,
  );
  const prompt = `${GRADE_PROMPT_PREFIX}${pairLines.join("\n")}`;
  try {
    const rawText = await generateJsonWithFallback(
      imageBase64,
      prompt,
      gradeConfig,
    );
    return parseMapGradesJson(rawText);
  } catch (error) {
    if (isGeminiRateLimitError(error)) throw error;
    console.error("[map-questions] grade failed", error);
    throw error;
  }
}
