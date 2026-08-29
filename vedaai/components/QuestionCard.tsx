"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { GradeResult, MappedResult } from "../lib/types";
import {
  formatScoreLabel,
  questionBodyText,
  questionNumberForBadge,
  scoreTone,
  subPartLabel,
} from "../lib/question-ui";

type QuestionCardProps = {
  result: MappedResult;
  grade: GradeResult | undefined;
  expanded: boolean;
  selected: boolean;
  grading: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
};

const SCORE_TONE_CLASS: Record<"success" | "warning" | "error", string> = {
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  error: "bg-error-bg text-error-text",
};

function StatusLabel({ result }: { result: MappedResult }) {
  if (result.status === "unanswered") {
    return <span className="text-caption text-muted">Not answered</span>;
  }
  if (result.status === "not-attempted-choice") {
    return (
      <span className="text-caption text-muted">Not attempted (choice)</span>
    );
  }
  if (result.status === "low-confidence") {
    return (
      <span className="text-caption text-warning-text">Low-confidence match</span>
    );
  }
  return null;
}

export function QuestionCard({
  result,
  grade,
  expanded,
  selected,
  grading,
  onSelect,
  onToggleExpand,
}: QuestionCardProps) {
  const { question } = result;
  const body = questionBodyText(question.text);
  const sub = subPartLabel(question.subPart);
  const scoreLabel = grade ? formatScoreLabel(grade) : null;
  const feedbackText = grade?.feedback?.trim() ?? "";
  const textRef = useRef<HTMLParagraphElement>(null);
  const [needsToggle, setNeedsToggle] = useState(false);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight > el.clientHeight + 1);
  }, [expanded, body, sub]);

  return (
    <article
      className={`rounded-md bg-surface p-4 shadow-card ${
        expanded ? "border-2 border-primary" : "border-2 border-transparent"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-badge text-surface">
            {questionNumberForBadge(question)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              ref={textRef}
              className={`break-words text-body text-ink ${
                expanded ? "" : "line-clamp-2"
              }`}
            >
              {sub ? <span className="mr-2 font-medium">{sub}</span> : null}
              {body}
            </p>
            <div className="mt-1 flex min-h-5 items-center gap-2">
              <StatusLabel result={result} />
              {needsToggle && !expanded ? (
                <span className="text-caption text-muted">Show more</span>
              ) : null}
              {needsToggle && expanded ? (
                <span className="text-caption text-muted">Show less</span>
              ) : null}
            </div>
          </div>
          {scoreLabel && grade ? (
            <span
              className={`shrink-0 rounded-pill px-3 py-1 text-badge ${SCORE_TONE_CLASS[scoreTone(grade)]}`}
            >
              {scoreLabel}
            </span>
          ) : grade?.verdict === "not-gradable" ? (
            <span className="shrink-0 text-caption text-muted">Not gradable</span>
          ) : null}
        </button>
        <button
          type="button"
          aria-label={expanded ? "Collapse question" : "Expand question"}
          className="min-h-10 min-w-10 shrink-0 pt-1 text-muted"
          onClick={onToggleExpand}
        >
          {expanded ? (
            <ChevronUp size={18} strokeWidth={1.75} />
          ) : (
            <ChevronDown size={18} strokeWidth={1.75} />
          )}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 pl-11">
          <p className="text-body-small font-semibold text-ink">AI Feedback</p>
          <div className="mt-2 rounded-md bg-surface-muted px-4 py-3">
            <p
              className={`break-words text-body ${
                feedbackText ? "text-ink-secondary" : "text-muted"
              }`}
            >
              {feedbackText
                ? grade?.feedback
                : grading
                  ? "Grading this answer…"
                  : "Feedback appears here after grading."}
            </p>
          </div>
        </div>
      ) : null}
    </article>
  );
}
