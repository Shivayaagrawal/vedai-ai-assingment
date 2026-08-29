"use client";

import { collectGradePairs } from "../lib/grading";
import { verdictCountLabel } from "../lib/question-ui";
import type { GradeResult, GradeVerdict, MappedResult } from "../lib/types";

type GradingSummaryProps = {
  results: MappedResult[];
  grades: GradeResult[];
  inFlight: boolean;
  error: string | null;
  onGradeAll: () => void;
};

const VERDICT_ORDER: GradeVerdict[] = [
  "correct",
  "partially-correct",
  "incorrect",
  "not-gradable",
];

export function GradingSummary({
  results,
  grades,
  inFlight,
  error,
  onGradeAll,
}: GradingSummaryProps) {
  const { pairs } = collectGradePairs(results);
  const canGrade = pairs.length > 0 && !inFlight;

  const totalScore = grades.reduce(
    (sum, grade) => sum + (typeof grade.score === "number" ? grade.score : 0),
    0,
  );
  const totalMax = grades.reduce(
    (sum, grade) =>
      sum + (typeof grade.maxScore === "number" ? grade.maxScore : 0),
    0,
  );

  const counts = VERDICT_ORDER.map((verdict) => ({
    verdict,
    count: grades.filter((grade) => grade.verdict === verdict).length,
  })).filter((item) => item.count > 0);

  return (
    <section className="mb-6 rounded-md bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-body-small text-muted">Total score</p>
          {grades.length > 0 ? (
            <p className="mt-1 text-section-heading text-ink">
              {totalScore} / {totalMax}
            </p>
          ) : (
            <p className="mt-1 text-body text-ink">Not graded yet</p>
          )}
          {counts.length > 0 ? (
            <p className="mt-1 text-caption text-muted">
              {counts
                .map(
                  (item) =>
                    `${verdictCountLabel(item.verdict)} ${item.count}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!canGrade}
          onClick={onGradeAll}
          className={`rounded-pill px-5 py-2 text-body-small font-medium ${
            canGrade
              ? "bg-ink text-surface"
              : "bg-surface-active text-muted"
          }`}
        >
          {inFlight ? "Grading…" : "Grade all answers"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-body-small text-error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
