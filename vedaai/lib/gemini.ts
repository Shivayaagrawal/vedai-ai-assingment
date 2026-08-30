import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
} from "@google/generative-ai";
import {
  gradeAnswerBatches,
  imagesForGradeBatch,
} from "./grading";
import { requireGeminiApiKeys } from "./gemini-keys";
import {
  GeminiRateLimitError,
  isGeminiRateLimitError,
  withRateLimitRetry,
} from "./gemini-retry";
import { questionIdFromParts } from "./question-id";
import type {
  Answer,
  AnswerRegion,
  ExtractPageInput,
  GradePair,
  GradeResult,
  Question,
} from "./types";

export { GeminiRateLimitError, isGeminiRateLimitError } from "./gemini-retry";

// gemini-2.0-flash and gemini-1.5-flash were shut down (404 as of Aug 2026).
// gemini-flash-latest currently resolves to Gemini 3.5 Flash and is on the free tier.
const PRIMARY_MODEL = "gemini-3.6-flash";
const FALLBACK_MODEL = "gemini-3.5-flash";
const FLASH_LATEST = "gemini-flash-latest";
const EXTRACT_MODELS = [PRIMARY_MODEL, FALLBACK_MODEL, FLASH_LATEST];
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_IMAGE_EDGE_PX = 2048;

// Pin #2 (unproven without a live extract): split a labeled block followed by
// an unrelated unlabeled topic. After quota recovers, run test-real-papers.ts
// then scripts/check-pin2-split.ts — splitting the old Q1 inertia+equation
// merge can create an unlabeled box that positional fallback then claims.
const EXTRACT_PROMPT = `You are analyzing a page from a student's handwritten exam answer sheet.
Identify every distinct answer block on this page. For each, return:
- detectedQuestionNumber: the number/label the student wrote (e.g. '4', '11(a)'),
  or null if none visible
- text: best-effort transcription (empty string if the answer is a diagram
  with no text, but still return the region)
- boundingBox: {x, y, width, height} as fractions (0-1) of the image's width/height
- confidence: 0-1
- isCrossedOut: true if struck through

Split rules (do not merge adjacent answers into one box):
- A new question number starts a new block, even if it sits close to the previous one.
- A crossed-out attempt and a rewrite next to it are two blocks.
- If a labeled answer is followed by a different topic with no number of its own
  (e.g. a physics definition, then an unrelated chemical equation), emit TWO
  blocks: keep the labeled text with its number, and give the second block
  detectedQuestionNumber null. Do not swallow the second topic into the first box.
- Continuation of the SAME numbered answer (more working on the next lines, or
  "(contd.)") may stay one block.

Return ONLY a JSON array, no markdown fences, no extra text.
If the page is blank or has no answers, return [].`;

const QUESTIONS_PROMPT = `Extract every question and labeled sub-part as a SEPARATE entry, in exact
printed order. '11. Explain X. (a)... (b)...' becomes two entries: 11(a) and
11(b), each with displayNumber '11' and subPart 'a'/'b'. Include section name
if sections exist. If a question offers a choice ('Answer either Q5 or Q6'),
set isAlternativeOf on both entries to the other's number. Extract maxMarks
if printed (e.g. '[5 marks]').

Additional rules:
- Nested labeled parts such as 11(a)(i) and 11(a)(ii) MUST be separate entries.
  Put the full path in subPart (e.g. "a(i)", "a(ii)"). Do not merge them into one entry.
- Copy printed question numbers exactly. Do not renumber, do not fill gaps
  (if the paper goes 1. then 3., the second entry is still "3").
- A page may start mid-question with only "(b)" or "(ii)" and no parent number.
  Still emit that entry. If the parent number is not printed on this page,
  set displayNumber to null — do not guess it, and do not treat that sub-part
  as a new numbered question.
- If marks are not printed, maxMarks must be null. Do not invent marks.
- Do NOT extract paper titles, section headers, or instruction lines as questions.
  Negative examples to omit: "Section B: Answer any 3 of the following",
  "Answer ALL questions", "Time allowed: 2 hours", "Maximum Marks: 80".

Each object shape:
{
  "displayNumber": "11",
  "subPart": "a" or "a(i)" or null,
  "section": "Section A" or null,
  "text": "question wording only",
  "maxMarks": 5 or null,
  "isAlternativeOf": "6" or null
}

Return ONLY a JSON array, no markdown, no extra text.
If the page has no questions, return [].`;

const generationConfig: GenerationConfig = {
  temperature: 0.1,
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        detectedQuestionNumber: {
          type: SchemaType.STRING,
          nullable: true,
        },
        text: { type: SchemaType.STRING },
        boundingBox: {
          type: SchemaType.OBJECT,
          properties: {
            x: { type: SchemaType.NUMBER },
            y: { type: SchemaType.NUMBER },
            width: { type: SchemaType.NUMBER },
            height: { type: SchemaType.NUMBER },
          },
          required: ["x", "y", "width", "height"],
        },
        confidence: { type: SchemaType.NUMBER },
        isCrossedOut: { type: SchemaType.BOOLEAN },
      },
      required: ["text", "boundingBox", "confidence"],
    },
  },
};

const gradingGenerationConfig: GenerationConfig = {
  temperature: 0.2,
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        questionId: { type: SchemaType.STRING },
        score: { type: SchemaType.NUMBER, nullable: true },
        maxScore: { type: SchemaType.NUMBER, nullable: true },
        verdict: { type: SchemaType.STRING },
        feedback: { type: SchemaType.STRING },
      },
      required: ["questionId", "verdict", "feedback"],
    },
  },
};

const questionsGenerationConfig: GenerationConfig = {
  temperature: 0.1,
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        displayNumber: { type: SchemaType.STRING, nullable: true },
        subPart: { type: SchemaType.STRING, nullable: true },
        section: { type: SchemaType.STRING, nullable: true },
        text: { type: SchemaType.STRING },
        maxMarks: { type: SchemaType.NUMBER, nullable: true },
        isAlternativeOf: { type: SchemaType.STRING, nullable: true },
      },
      required: ["text"],
    },
  },
};

function getClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

async function withModelAndKeyFallback(
  run: (apiKey: string, modelName: string) => Promise<string>,
  timeoutMessage: string,
  failedMessage: string,
): Promise<string> {
  const keys = requireGeminiApiKeys();
  const models = EXTRACT_MODELS;
  const retryOptions = keys.length > 1 ? { maxAttempts: 1 } : {};
  const exhaustedKeys = new Set<number>();
  let lastError: unknown;

  for (const [modelIndex, modelName] of models.entries()) {
    for (const [keyIndex, apiKey] of keys.entries()) {
      if (exhaustedKeys.has(keyIndex)) continue;
      try {
        return await withRateLimitRetry(() => run(apiKey, modelName), {
          ...retryOptions,
          onRetry: ({ waitMs, attempt }) => {
            console.warn(
              `[gemini] key ${keyIndex + 1} ${modelName} rate limited, waiting ${waitMs / 1000}s then retry ${attempt + 1}`,
            );
          },
        });
      } catch (error) {
        lastError = error;
        const moreKeys = keys.some(
          (_, index) => index > keyIndex && !exhaustedKeys.has(index),
        );
        const moreModels = modelIndex < models.length - 1;

        if (isGeminiRateLimitError(error)) {
          exhaustedKeys.add(keyIndex);
          if (moreKeys) {
            console.warn(
              `[gemini] key ${keyIndex + 1} rate limited, trying key ${keyIndex + 2}`,
            );
            continue;
          }
          if (moreModels) {
            console.warn(
              `[gemini] all remaining keys rate limited on ${modelName}, falling back to ${models[modelIndex + 1]}`,
            );
            continue;
          }
          throw new GeminiRateLimitError();
        }

        if (!moreKeys && !moreModels) break;
        console.warn(
          `[gemini] key ${keyIndex + 1} ${modelName} failed${moreKeys ? ", trying next key" : `, falling back to ${models[modelIndex + 1]}`}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (lastError instanceof Error && /timeout/i.test(lastError.message)) {
    throw new Error(timeoutMessage);
  }

  if (isGeminiRateLimitError(lastError)) {
    throw new GeminiRateLimitError();
  }

  throw lastError instanceof Error ? lastError : new Error(failedMessage);
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

  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return stripped.slice(objectStart, objectEnd + 1);
  }

  return stripped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function maybeScaleFrom1000(values: number[]): number[] {
  const max = Math.max(...values);
  if (max > 1 && max <= 1000) {
    return values.map((v) => v / 1000);
  }
  return values;
}

type BoundingBox = { x: number; y: number; width: number; height: number };

function rectFromXYWH(
  x: number,
  y: number,
  width: number,
  height: number,
): BoundingBox {
  const [sx, sy, sw, sh] = maybeScaleFrom1000([x, y, width, height]);
  return {
    x: clamp01(sx),
    y: clamp01(sy),
    width: clamp01(sw),
    height: clamp01(sh),
  };
}

function parseBoundingBox(item: Record<string, unknown>): BoundingBox | null {
  const boxCandidate =
    item.boundingBox ?? item.bounding_box ?? item.bbox ?? item.box;

  if (isRecord(boxCandidate)) {
    if (
      isFiniteNumber(boxCandidate.x) &&
      isFiniteNumber(boxCandidate.y) &&
      isFiniteNumber(boxCandidate.width) &&
      isFiniteNumber(boxCandidate.height)
    ) {
      return rectFromXYWH(
        boxCandidate.x,
        boxCandidate.y,
        boxCandidate.width,
        boxCandidate.height,
      );
    }
  }

  const box2d = item.box_2d ?? item.box2d;
  if (
    Array.isArray(box2d) &&
    box2d.length === 4 &&
    box2d.every(isFiniteNumber)
  ) {
    const [ymin, xmin, ymax, xmax] = maybeScaleFrom1000(box2d);
    return {
      x: clamp01(xmin),
      y: clamp01(ymin),
      width: clamp01(xmax - xmin),
      height: clamp01(ymax - ymin),
    };
  }

  return null;
}

function parseConfidence(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  if (value > 1 && value <= 100) return clamp01(value / 100);
  return clamp01(value);
}

function mapExtractedItem(
  item: unknown,
  index: number,
  pageNumber: number,
): Answer | null {
  if (!isRecord(item)) {
    console.warn(`[gemini] Skipping non-object item at index ${index}`);
    return null;
  }

  const box = parseBoundingBox(item);
  if (!box) {
    console.warn(
      `[gemini] Skipping item at index ${index}: missing/invalid bounding box`,
      item,
    );
    return null;
  }

  const region: AnswerRegion = {
    page: pageNumber,
    ...box,
  };

  const textValue = item.text;
  const text = typeof textValue === "string" ? textValue : "";

  return {
    id: `p${pageNumber}-a${index + 1}`,
    detectedQuestionNumber: asOptionalString(item.detectedQuestionNumber),
    text,
    regions: [region],
    confidence: parseConfidence(item.confidence),
    isCrossedOut: item.isCrossedOut === true,
  };
}

function parseJsonArray(rawText: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(rawText));
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed)) {
      for (const key of ["questions", "answers", "items"]) {
        const nested = parsed[key];
        if (Array.isArray(nested)) return nested;
      }
    }
    console.error(
      "[gemini] Expected a JSON array. Raw response text:\n",
      rawText,
    );
    return [];
  } catch (error) {
    console.error("[gemini] JSON.parse failed. Raw response text:\n", rawText);
    console.error(error);
    return [];
  }
}

export function parseAnswersJson(
  rawText: string,
  pageNumber: number,
): Answer[] {
  return parseJsonArray(rawText)
    .map((item, index) => mapExtractedItem(item, index, pageNumber))
    .filter((answer): answer is Answer => answer !== null);
}

export { questionIdFromParts } from "./question-id";

function asOptionalMarks(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) return undefined;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function mapQuestionItem(
  item: unknown,
  index: number,
  pageNumber: number,
  usedIds: Set<string>,
): Question | null {
  if (!isRecord(item)) {
    console.warn(`[gemini] Skipping non-object question at index ${index}`);
    return null;
  }

  const textValue = item.text;
  const text = typeof textValue === "string" ? textValue.trim() : "";
  if (!text) {
    console.warn(
      `[gemini] Skipping question at index ${index}: empty text`,
      item,
    );
    return null;
  }

  const section = asOptionalString(item.section) ?? undefined;
  const subPart = asOptionalString(item.subPart) ?? undefined;
  // Continuation sub-parts on a later page often have no parent number printed.
  // Keep the entry so Phase 4 can stitch it; do not invent a number.
  const displayNumber = asOptionalString(item.displayNumber) ?? "";
  if (!displayNumber && !subPart) {
    console.warn(
      `[gemini] Skipping question at index ${index}: missing displayNumber`,
      item,
    );
    return null;
  }

  let id = questionIdFromParts(
    section,
    displayNumber || "continued",
    subPart,
  );
  if (usedIds.has(id)) {
    id = `${id}-p${pageNumber}-${index + 1}`;
  }
  usedIds.add(id);

  const question: Question = {
    id,
    // Assumption: unnumbered continuation parts keep a placeholder displayNumber
    // of "(b)" so they stay orderable; Phase 4 should attach them to the prior question.
    displayNumber: displayNumber || (subPart ? `(${subPart})` : ""),
    text,
    page: pageNumber,
  };

  if (subPart) question.subPart = subPart;
  if (section) question.section = section;

  const maxMarks = asOptionalMarks(item.maxMarks);
  if (maxMarks !== undefined) question.maxMarks = maxMarks;

  const isAlternativeOf = asOptionalString(item.isAlternativeOf);
  if (isAlternativeOf) question.isAlternativeOf = isAlternativeOf;

  return question;
}

export function parseQuestionsJson(
  rawText: string,
  pageNumber: number,
): Question[] {
  const usedIds = new Set<string>();
  return parseJsonArray(rawText)
    .map((item, index) => mapQuestionItem(item, index, pageNumber, usedIds))
    .filter((question): question is Question => question !== null);
}

function decodeImagePayload(imageBase64: string): {
  data: string;
  mimeType: string;
} {
  const dataUrl = imageBase64.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/,
  );
  if (dataUrl) {
    return { mimeType: dataUrl[1], data: dataUrl[2] };
  }
  return { mimeType: "image/png", data: imageBase64 };
}

export async function downscaleImageForGemini(
  imageBase64: string,
): Promise<string> {
  const { data } = decodeImagePayload(imageBase64);

  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(Buffer.from(data, "base64"));
    const maxEdge = Math.max(image.width, image.height);
    if (maxEdge <= MAX_IMAGE_EDGE_PX) {
      return imageBase64;
    }

    const scale = MAX_IMAGE_EDGE_PX / maxEdge;
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);
    const jpeg = canvas.toBuffer("image/jpeg", 0.85);
    console.warn(
      `[gemini] Downscaled ${image.width}x${image.height} → ${width}x${height} before send`,
    );
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (error) {
    console.warn(
      "[gemini] Could not downscale image; sending original",
      error instanceof Error ? error.message : error,
    );
    return imageBase64;
  }
}

async function generateWithModel(
  modelName: string,
  imageBase64: string,
  prompt: string,
  config: GenerationConfig,
  apiKey: string,
): Promise<string> {
  const prepared = await downscaleImageForGemini(imageBase64);
  const { data, mimeType } = decodeImagePayload(prepared);
  const model = getClient(apiKey).getGenerativeModel(
    { model: modelName, generationConfig: config },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data, mimeType } },
  ]);

  return result.response.text();
}

export async function generateJsonWithFallback(
  imageBase64: string,
  prompt: string,
  config: GenerationConfig,
): Promise<string> {
  return withModelAndKeyFallback(
    (apiKey, modelName) =>
      generateWithModel(modelName, imageBase64, prompt, config, apiKey),
    "Gemini request timed out. Try again with a smaller image.",
    "Gemini request failed",
  );
}

export async function extractAnswersFromPage(
  imageBase64: string,
  pageNumber: number,
): Promise<Answer[]> {
  const rawText = await generateJsonWithFallback(
    imageBase64,
    EXTRACT_PROMPT,
    generationConfig,
  );
  return parseAnswersJson(rawText, pageNumber);
}

export async function extractQuestionsFromPageRaw(
  imageBase64: string,
): Promise<string> {
  return generateJsonWithFallback(
    imageBase64,
    QUESTIONS_PROMPT,
    questionsGenerationConfig,
  );
}

export async function extractQuestionsFromPage(
  imageBase64: string,
  pageNumber: number,
): Promise<Question[]> {
  const rawText = await extractQuestionsFromPageRaw(imageBase64);
  return parseQuestionsJson(rawText, pageNumber);
}

async function generateTextWithModel(
  modelName: string,
  prompt: string,
  config: GenerationConfig,
  apiKey: string,
): Promise<string> {
  const model = getClient(apiKey).getGenerativeModel(
    { model: modelName, generationConfig: config },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  const result = await model.generateContent(prompt);
  return result.response.text();
}

const MAX_GRADE_IMAGE_CHARS = 3_000_000;

async function generateTextJsonWithFallback(prompt: string): Promise<string> {
  return withModelAndKeyFallback(
    (apiKey, modelName) =>
      generateTextWithModel(modelName, prompt, gradingGenerationConfig, apiKey),
    "Gemini request timed out. Try again with a smaller batch.",
    "Gemini grading request failed",
  );
}

async function generateGradeJsonWithImages(
  prompt: string,
  images: ExtractPageInput[],
): Promise<string> {
  const totalChars = images.reduce(
    (sum, page) => sum + page.imageBase64.length,
    0,
  );
  if (images.length === 0 || totalChars > MAX_GRADE_IMAGE_CHARS) {
    if (totalChars > MAX_GRADE_IMAGE_CHARS) {
      console.warn(
        `[grading] Skipping ${images.length} page image(s) (${totalChars} chars) to stay under the request size cap; grading from text only.`,
      );
    }
    return generateTextJsonWithFallback(prompt);
  }

  return withModelAndKeyFallback(
    async (apiKey, modelName) => {
      const parts: Array<
        { text: string } | { inlineData: { data: string; mimeType: string } }
      > = [{ text: prompt }];
      for (const page of images) {
        const prepared = await downscaleImageForGemini(page.imageBase64);
        const { data, mimeType } = decodeImagePayload(prepared);
        parts.push({
          text: `Answer sheet page ${page.pageNumber}:`,
        });
        parts.push({ inlineData: { data, mimeType } });
      }
      const model = getClient(apiKey).getGenerativeModel(
        { model: modelName, generationConfig: gradingGenerationConfig },
        { timeout: REQUEST_TIMEOUT_MS },
      );
      const result = await model.generateContent(parts);
      return result.response.text();
    },
    "Gemini request timed out. Try again with a smaller batch.",
    "Gemini grading request failed",
  );
}

export async function gradeAnswers(
  pairs: GradePair[],
  generateJson?: (prompt: string, batch: GradePair[]) => Promise<string>,
  answerPages: ExtractPageInput[] = [],
): Promise<GradeResult[]> {
  const impl =
    generateJson ??
    (async (prompt: string, batch: GradePair[]) => {
      const images = imagesForGradeBatch(batch, answerPages);
      return generateGradeJsonWithImages(prompt, images);
    });
  return gradeAnswerBatches(pairs, impl);
}
