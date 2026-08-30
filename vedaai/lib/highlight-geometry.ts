import type { Answer, AnswerRegion, Question } from "./types";

export type HighlightTone = "success" | "warning" | "error";

export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  tag: string;
  tone?: HighlightTone;
  emphasized?: boolean;
};

export type SheetHighlight = {
  answer: Answer;
  tag: string;
  tone?: HighlightTone;
  emphasized?: boolean;
};

export function scaleNormalizedBox(
  region: Pick<AnswerRegion, "x" | "y" | "width" | "height">,
  naturalWidth: number,
  naturalHeight: number,
  displayedWidth: number,
  displayedHeight: number,
): Omit<PixelBox, "tag"> {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    displayedWidth <= 0 ||
    displayedHeight <= 0
  ) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scaleX = displayedWidth / naturalWidth;
  const scaleY = displayedHeight / naturalHeight;

  return {
    left: region.x * naturalWidth * scaleX,
    top: region.y * naturalHeight * scaleY,
    width: region.width * naturalWidth * scaleX,
    height: region.height * naturalHeight * scaleY,
  };
}

export function regionsOnPage(
  regions: AnswerRegion[],
  pageNumber: number,
): AnswerRegion[] {
  return regions.filter((region) => region.page === pageNumber);
}

export function otherRegionPages(
  regions: AnswerRegion[],
  currentPage: number,
): number[] {
  const pages = new Set<number>();
  for (const region of regions) {
    if (region.page !== currentPage) pages.add(region.page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function firstRegionPage(regions: AnswerRegion[]): number | null {
  if (regions.length === 0) return null;
  return [...regions].sort((a, b) => a.page - b.page || a.y - b.y)[0].page;
}

export function highlightTagForQuestion(question: Question): string {
  const number = question.displayNumber.replace(/^q\s*/i, "").trim() || "?";
  const sub = (question.subPart ?? "").replace(/\.$/, "").trim();
  return `Q${number}${sub}`;
}

export function highlightTagForUnmatched(answer: Answer): string {
  const raw = answer.detectedQuestionNumber;
  if (typeof raw === "string" && raw.trim() !== "") {
    const number = raw.replace(/^q\s*/i, "").trim();
    return `Q${number}`;
  }
  return "Q?";
}

export function pixelBoxesForPage(
  regions: AnswerRegion[],
  pageNumber: number,
  tag: string,
  naturalWidth: number,
  naturalHeight: number,
  displayedWidth: number,
  displayedHeight: number,
  tone?: HighlightTone,
  emphasized?: boolean,
): PixelBox[] {
  return regionsOnPage(regions, pageNumber).map((region) => ({
    ...scaleNormalizedBox(
      region,
      naturalWidth,
      naturalHeight,
      displayedWidth,
      displayedHeight,
    ),
    tag,
    ...(tone ? { tone } : {}),
    ...(emphasized ? { emphasized: true } : {}),
  }));
}

export function pixelBoxesForSheetPage(
  highlights: SheetHighlight[],
  pageNumber: number,
  naturalWidth: number,
  naturalHeight: number,
  displayedWidth: number,
  displayedHeight: number,
): PixelBox[] {
  return highlights.flatMap((item) =>
    pixelBoxesForPage(
      item.answer.regions,
      pageNumber,
      item.tag,
      naturalWidth,
      naturalHeight,
      displayedWidth,
      displayedHeight,
      item.tone,
      item.emphasized,
    ),
  );
}
