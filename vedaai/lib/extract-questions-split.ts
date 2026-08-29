import { createCanvas, loadImage } from "@napi-rs/canvas";
import { extractQuestionsFromPage } from "./gemini";
import { questionMatchKey } from "./matching";
import type { ExtractPageInput, PageTextItem, Question } from "./types";

/** Inclusive overlap so an item that straddles mid-page is whole in at least one half. */
export const TOP_HALF = { name: "top", y0: 0, y1: 0.6 } as const;
export const BOTTOM_HALF = { name: "bottom", y0: 0.45, y1: 1 } as const;
export const PAGE_HALVES = [TOP_HALF, BOTTOM_HALF] as const;

const NAPI_JPEG_QUALITY = 85;

export type PageHalf = {
  name: "top" | "bottom";
  y0: number;
  y1: number;
  imageBase64: string;
};

export type ExtractQuestionFn = (
  imageBase64: string,
  pageNumber: number,
) => Promise<Question[]>;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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

export function looksLikeQuestionLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /^(section\s+[a-z]|time allowed|maximum marks|answer (all|any)|do not write)/i.test(
      t,
    )
  ) {
    return false;
  }
  if (/^(?:q\s*)?\d+\s*[.)]/i.test(t)) return true;
  if (/^\(\s*[a-z]{1,3}(?:\s*[ivx]+)?\s*\)/i.test(t)) return true;
  if (/^\(\s*[ivx]+\s*\)/i.test(t)) return true;
  return false;
}

export function countExpectedInBand(
  items: PageTextItem[],
  y0: number,
  y1: number,
): number {
  let count = 0;
  for (const item of items) {
    const y = clamp01(item.y);
    if (y < y0 || y >= y1) continue;
    if (looksLikeQuestionLabel(item.text)) count += 1;
  }
  return count;
}

export function isHalfComplete(
  extractedCount: number,
  expectedCount: number,
): boolean {
  if (expectedCount <= 0) return true;
  return extractedCount >= Math.max(1, expectedCount - 1);
}

function isRicher(candidate: Question, current: Question): boolean {
  const candMarks = candidate.maxMarks != null ? 1 : 0;
  const curMarks = current.maxMarks != null ? 1 : 0;
  if (candMarks !== curMarks) return candMarks > curMarks;

  const candLen = candidate.text.trim().length;
  const curLen = current.text.trim().length;
  if (candLen !== curLen) return candLen > curLen;

  const candHasNumber = !/^\(/.test(candidate.displayNumber.trim());
  const curHasNumber = !/^\(/.test(current.displayNumber.trim());
  if (candHasNumber !== curHasNumber) return candHasNumber;

  return (candidate.section?.length ?? 0) > (current.section?.length ?? 0);
}

function dedupeKey(question: Question): string {
  const key = questionMatchKey(question);
  if (key) return key;
  return `text:${question.text.trim().slice(0, 80).toLowerCase()}`;
}

export function mergeQuestionHalves(
  top: Question[],
  bottom: Question[],
): Question[] {
  const order: Question[] = [];
  const indexByKey = new Map<string, number>();

  const consider = (item: Question) => {
    const key = dedupeKey(item);
    const existingIdx = indexByKey.get(key);
    if (existingIdx === undefined) {
      indexByKey.set(key, order.length);
      order.push(item);
      return;
    }
    if (isRicher(item, order[existingIdx])) {
      order[existingIdx] = item;
    }
  };

  for (const item of top) consider(item);
  for (const item of bottom) consider(item);
  return order;
}

export async function cropPageHalf(
  imageBase64: string,
  y0: number,
  y1: number,
): Promise<string> {
  const { data } = decodeImagePayload(imageBase64);
  const image = await loadImage(Buffer.from(data, "base64"));
  const top = Math.max(0, Math.floor(image.height * y0));
  const bottom = Math.min(image.height, Math.ceil(image.height * y1));
  const height = Math.max(1, bottom - top);
  const canvas = createCanvas(image.width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    image,
    0,
    top,
    image.width,
    height,
    0,
    0,
    image.width,
    height,
  );
  const jpeg = canvas.toBuffer("image/jpeg", NAPI_JPEG_QUALITY);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export async function cropOverlappingHalves(
  imageBase64: string,
): Promise<PageHalf[]> {
  const halves: PageHalf[] = [];
  for (const band of PAGE_HALVES) {
    halves.push({
      name: band.name,
      y0: band.y0,
      y1: band.y1,
      imageBase64: await cropPageHalf(imageBase64, band.y0, band.y1),
    });
  }
  return halves;
}

async function extractHalfWithRetry(
  page: ExtractPageInput,
  half: PageHalf,
  extract: ExtractQuestionFn,
): Promise<Question[]> {
  const first = await extract(half.imageBase64, page.pageNumber);
  const expected = countExpectedInBand(page.textItems ?? [], half.y0, half.y1);
  if (isHalfComplete(first.length, expected)) return first;

  console.warn(
    `[extract-split] page ${page.pageNumber} ${half.name} half expected ~${expected} labeled items, got ${first.length}; retrying once`,
  );
  const retry = await extract(half.imageBase64, page.pageNumber);
  if (retry.length > first.length) return retry;
  if (retry.length < first.length) return first;
  return mergeQuestionHalves(first, retry);
}

export async function extractQuestionsFromFullPage(
  page: ExtractPageInput,
  extract: ExtractQuestionFn = extractQuestionsFromPage,
): Promise<Question[]> {
  try {
    const halves = await cropOverlappingHalves(page.imageBase64);
    const top = await extractHalfWithRetry(page, halves[0], extract);
    const bottom = await extractHalfWithRetry(page, halves[1], extract);
    return mergeQuestionHalves(top, bottom);
  } catch (error) {
    console.warn(
      "[extract-split] overlapping crop failed; extracting the full page once",
      error instanceof Error ? error.message : error,
    );
    return extract(page.imageBase64, page.pageNumber);
  }
}
