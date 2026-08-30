import type { PixelBox } from "../lib/highlight-geometry";

type HighlightOverlayProps = {
  boxes: PixelBox[];
};

const BOX_TONE_CLASS = {
  success: "border-highlight bg-highlight-bg",
  warning: "border-highlight-partial bg-highlight-partial-bg",
  error: "border-highlight-incorrect bg-highlight-incorrect-bg",
} as const;

const TAG_TONE_CLASS = {
  success: "bg-highlight text-surface",
  warning: "bg-highlight-partial text-surface",
  error: "bg-highlight-incorrect text-surface",
} as const;

export function HighlightOverlay({ boxes }: HighlightOverlayProps) {
  if (boxes.length === 0) return null;

  return (
    <>
      {boxes.map((box, index) => {
        const tone = box.tone ?? "success";
        return (
          <div
            key={`${box.tag}-${index}-${box.left}-${box.top}`}
            className={`pointer-events-none absolute border-2 ${BOX_TONE_CLASS[tone]} ${
              box.emphasized ? "z-20 ring-2 ring-highlight-secondary" : "z-10"
            }`}
            data-highlight-tag={box.tag}
            data-highlight-tone={tone}
            data-highlight-emphasized={box.emphasized ? "true" : undefined}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
          >
            <span
              className={`absolute left-0 top-0 z-10 -translate-y-1/2 rounded-pill px-2 py-0.5 text-caption font-semibold ${TAG_TONE_CLASS[tone]}`}
            >
              {box.tag}
            </span>
          </div>
        );
      })}
    </>
  );
}
