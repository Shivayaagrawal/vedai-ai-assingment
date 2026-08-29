"use client";

import { emptyStateMessages, type ExtractEmptyKind } from "../lib/extract-empty";

type ResultsEmptyStateProps = {
  kind: ExtractEmptyKind;
  onTryDifferentFile: () => void;
};

/**
 * Inferred UI (not in /design-reference). Same tokens as Phase 8 status
 * labels ("Not answered" / "Not attempted (choice)"): ink heading, muted
 * body, pill ink button — no new colors.
 */
export function ResultsEmptyState({
  kind,
  onTryDifferentFile,
}: ResultsEmptyStateProps) {
  const messages = emptyStateMessages(kind);

  return (
    <section className="flex h-full min-h-[480px] flex-col items-center justify-center px-8">
      {messages.map((message, index) => (
        <p
          key={message}
          className={`max-w-lg text-center ${
            index === 0
              ? "text-section-heading text-ink"
              : "mt-3 text-body-small text-muted"
          }`}
        >
          {message}
        </p>
      ))}
      <button
        type="button"
        onClick={onTryDifferentFile}
        className="mt-8 flex w-[240px] items-center justify-center rounded-pill bg-ink py-3 text-body font-medium text-surface"
      >
        Try a different file
      </button>
    </section>
  );
}
