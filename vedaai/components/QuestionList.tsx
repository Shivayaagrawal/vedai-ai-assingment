"use client";

import type { GradeResult, MappedResult } from "../lib/types";
import { QuestionCard } from "./QuestionCard";

type QuestionListProps = {
  results: MappedResult[];
  gradesById: Record<string, GradeResult>;
  expandedIds: Set<string>;
  selectedQuestionId: string | null;
  allExpanded: boolean;
  grading: boolean;
  onExpandAll: () => void;
  onSelect: (questionId: string) => void;
  onToggleExpand: (questionId: string) => void;
};

export function QuestionList({
  results,
  gradesById,
  expandedIds,
  selectedQuestionId,
  allExpanded,
  grading,
  onExpandAll,
  onSelect,
  onToggleExpand,
}: QuestionListProps) {
  return (
    <section>
      <div className="mb-5 flex items-start justify-between gap-3">
        <h1 className="min-w-0 text-section-heading text-ink">
          Extracted Questions (from question paper)
        </h1>
        <button
          type="button"
          onClick={onExpandAll}
          aria-pressed={allExpanded}
          className="shrink-0 rounded-pill bg-surface px-4 py-2 text-body-small font-medium text-ink shadow-card"
        >
          Expand All
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {results.map((result) => {
          const id = result.question.id;
          const expanded = allExpanded || expandedIds.has(id);
          return (
            <li key={id}>
              <QuestionCard
                result={result}
                grade={gradesById[id]}
                expanded={expanded}
                selected={selectedQuestionId === id}
                grading={grading}
                onSelect={() => onSelect(id)}
                onToggleExpand={() => onToggleExpand(id)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
