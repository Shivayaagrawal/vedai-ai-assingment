"use client";

import { Sparkles } from "lucide-react";

import { pipelineHeading, type PipelineStage } from "../lib/pipeline";

type ProcessingScreenProps = {
  stage: PipelineStage;
  message: string;
  error: { rateLimited: boolean; message: string } | null;
  onRetry: () => void;
};

export function ProcessingScreen({
  stage,
  message,
  error,
  onRetry,
}: ProcessingScreenProps) {
  return (
    <section className="flex h-full min-h-[480px] flex-col items-center justify-center px-8">
      {error ? (
        <>
          <p className="max-w-md text-center text-section-heading text-ink">
            {error.rateLimited ? error.message : "Something went wrong"}
          </p>
          {!error.rateLimited && error.message ? (
            <p className="mt-3 max-w-md text-center text-body-small text-muted">
              {error.message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            className="mt-8 flex w-[200px] items-center justify-center rounded-pill bg-ink py-3 text-body font-medium text-surface"
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <div className="relative h-24 w-28" aria-hidden>
            <Sparkles
              size={56}
              strokeWidth={1.5}
              className="sparkle-breathe absolute left-6 top-2 text-primary"
            />
            <Sparkles
              size={28}
              strokeWidth={1.5}
              className="sparkle-breathe sparkle-breathe-delay-1 absolute right-2 top-0 text-primary-hover"
            />
            <Sparkles
              size={20}
              strokeWidth={1.5}
              className="sparkle-breathe sparkle-breathe-delay-2 absolute bottom-2 left-2 text-primary"
            />
          </div>
          <h1 className="mt-6 text-center text-page-title text-ink" aria-live="polite">
            {pipelineHeading(stage)}
          </h1>
          <p
            className="mt-3 max-w-lg text-center text-body-small text-muted"
            aria-live="polite"
          >
            {message}
          </p>
        </>
      )}
    </section>
  );
}
