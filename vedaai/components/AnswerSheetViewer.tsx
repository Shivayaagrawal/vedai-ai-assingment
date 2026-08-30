"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  otherRegionPages,
  pixelBoxesForSheetPage,
  type PixelBox,
  type SheetHighlight,
} from "../lib/highlight-geometry";
import type { Answer } from "../lib/types";
import { HighlightOverlay } from "./HighlightOverlay";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export type ViewerSelection =
  | { kind: "answer"; answer: Answer; tag: string; tone?: HighlightTone }
  | { kind: "unanswered" }
  | null;

type AnswerSheetViewerProps = {
  pageImages: string[];
  pageNumbers: number[];
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  selection: ViewerSelection;
  sheetHighlights: SheetHighlight[];
};

type DisplayMetrics = {
  displayedWidth: number;
  displayedHeight: number;
  naturalWidth: number;
  naturalHeight: number;
};

function continuesLabel(pages: number[]): string | null {
  if (pages.length === 0) return null;
  if (pages.length === 1) return `continues on page ${pages[0]}`;
  return `continues on pages ${pages.join(", ")}`;
}

export function AnswerSheetViewer({
  pageImages,
  pageNumbers,
  pageIndex,
  onPageIndexChange,
  selection,
  sheetHighlights,
}: AnswerSheetViewerProps) {
  const [zoom, setZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement>(null);
  const [metrics, setMetrics] = useState<DisplayMetrics>({
    displayedWidth: 0,
    displayedHeight: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  });

  const pageCount = pageImages.length;
  const pageNumber = pageNumbers[pageIndex] ?? pageIndex + 1;
  const src = pageImages[pageIndex] ?? "";

  const recompute = useCallback(() => {
    const img = imageRef.current;
    if (!img || img.clientWidth === 0 || img.clientHeight === 0) return;
    setMetrics({
      displayedWidth: img.clientWidth,
      displayedHeight: img.clientHeight,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }, []);

  useLayoutEffect(() => {
    recompute();
    const img = imageRef.current;
    if (!img) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(img);
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [recompute, zoom, pageIndex, src]);

  const unanswered = selection?.kind === "unanswered";
  const answer = selection?.kind === "answer" ? selection.answer : null;

  const boxes: PixelBox[] = pixelBoxesForSheetPage(
    sheetHighlights,
    pageNumber,
    metrics.naturalWidth,
    metrics.naturalHeight,
    metrics.displayedWidth,
    metrics.displayedHeight,
  );

  const continuation = answer
    ? continuesLabel(otherRegionPages(answer.regions, pageNumber))
    : null;

  const percent = Math.round(zoom * 100);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface shadow-panel">
      <header className="flex shrink-0 items-center justify-between bg-overlay px-4 py-3 text-surface">
        <div className="flex items-center gap-6">
          <h2 className="text-section-heading text-surface">Answer Sheet</h2>
          <div className="flex items-center gap-3 text-body-small">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
              className="px-1"
            >
              −
            </button>
            <span>{percent}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
              className="px-1"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-body-small">
          <button
            type="button"
            aria-label="Previous page"
            disabled={pageIndex <= 0}
            onClick={() => onPageIndexChange(Math.max(0, pageIndex - 1))}
          >
            ‹
          </button>
          <span>
            Page {pageIndex + 1} of {Math.max(pageCount, 1)}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={pageIndex >= pageCount - 1}
            onClick={() =>
              onPageIndexChange(Math.min(pageCount - 1, pageIndex + 1))
            }
          >
            ›
          </button>
        </div>
      </header>

      {unanswered ? (
        <p
          className="shrink-0 bg-surface-muted px-4 py-2 text-center text-caption text-muted"
          role="status"
        >
          No answer found for this question
        </p>
      ) : null}

      {continuation && !unanswered ? (
        <p
          className="shrink-0 bg-surface-muted px-4 py-2 text-center text-caption text-muted"
          role="status"
        >
          {continuation}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-background">
        {src ? (
          <div className="relative" style={{ width: `${zoom * 100}%` }}>
            <img
              ref={imageRef}
              src={src}
              alt={`Answer sheet page ${pageIndex + 1}`}
              className="block h-auto w-full"
              onLoad={recompute}
            />
            <HighlightOverlay boxes={boxes} />
          </div>
        ) : (
          <p className="p-8 text-center text-body text-muted">
            No answer sheet image
          </p>
        )}
      </div>
    </section>
  );
}
