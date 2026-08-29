"use client";

import type { UnmatchedAnswer } from "../lib/matching";
import { unmatchedAnswerLabel } from "../lib/question-ui";

type UnmatchedAnswersProps = {
  items: UnmatchedAnswer[];
  selectedAnswerId: string | null;
  onSelect: (answerId: string) => void;
};

export function UnmatchedAnswers({
  items,
  selectedAnswerId,
  onSelect,
}: UnmatchedAnswersProps) {
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-section-heading text-ink">Unmatched answers</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {items.map(({ answer }) => {
          const selected = selectedAnswerId === answer.id;
          return (
            <li key={answer.id}>
              <button
                type="button"
                onClick={() => onSelect(answer.id)}
                className={`w-full rounded-md bg-surface p-4 text-left shadow-card ${
                  selected
                    ? "border-2 border-primary"
                    : "border-2 border-transparent"
                }`}
              >
                <p className="text-body font-medium text-ink">
                  {unmatchedAnswerLabel(answer.detectedQuestionNumber)}
                </p>
                {answer.text.trim() ? (
                  <p className="mt-1 line-clamp-2 text-body-small text-ink-secondary">
                    {answer.text}
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
