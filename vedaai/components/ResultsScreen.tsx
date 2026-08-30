"use client";

import { useState } from "react";
import { classifyExtractEmpty } from "../lib/extract-empty";
import type { MappingSession } from "../lib/pipeline";
import { AnswerSheetViewer } from "./AnswerSheetViewer";
import { GradingSummary } from "./GradingSummary";
import {
  MobileTabSwitcher,
  type ResultsTab,
} from "./MobileTabSwitcher";
import { QuestionList } from "./QuestionList";
import { ResultsEmptyState } from "./ResultsEmptyState";
import { UnmatchedAnswers } from "./UnmatchedAnswers";
import { useResultsInteraction } from "./useResultsInteraction";

type ResultsScreenProps = {
  session: MappingSession;
  onTryDifferentFile: () => void;
  autoGrade?: boolean;
};

export function ResultsScreen({
  session,
  onTryDifferentFile,
  autoGrade = false,
}: ResultsScreenProps) {
  const emptyKind = classifyExtractEmpty(session.mapping);
  const interaction = useResultsInteraction(session, { autoGrade });
  const [tab, setTab] = useState<ResultsTab>("questions");

  if (emptyKind) {
    return (
      <ResultsEmptyState
        kind={emptyKind}
        onTryDifferentFile={onTryDifferentFile}
      />
    );
  }

  function selectAndShowAnswer(questionId: string) {
    interaction.selectQuestion(questionId);
    setTab("answers");
  }

  function selectUnmatchedAndShow(answerId: string) {
    interaction.selectUnmatched(answerId);
    setTab("answers");
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
      <div className="shrink-0 px-4 py-3 md:hidden">
        <MobileTabSwitcher value={tab} onChange={setTab} />
      </div>

      <QuestionsPane
        session={session}
        interaction={interaction}
        onSelectQuestion={selectAndShowAnswer}
        onSelectUnmatched={selectUnmatchedAndShow}
        className={`${
          tab === "questions" ? "flex" : "hidden"
        } min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 md:flex md:w-[45%] md:flex-none md:px-6 md:py-6`}
      />

      <div
        className={`${
          tab === "answers" ? "flex" : "hidden"
        } min-h-0 flex-1 flex-col md:flex md:w-[55%] md:flex-none md:py-6 md:pr-6`}
      >
        <div className="min-h-0 flex-1">
          <AnswerSheetViewer
            pageImages={interaction.pageImages.answerSheet}
            pageNumbers={interaction.pageNumbers}
            pageIndex={interaction.pageIndex}
            onPageIndexChange={interaction.setPageIndex}
            selection={interaction.viewerSelection}
            sheetHighlights={interaction.sheetHighlights}
          />
        </div>
      </div>
    </div>
  );
}

type Interaction = ReturnType<typeof useResultsInteraction>;

function QuestionsPane({
  session,
  interaction,
  onSelectQuestion,
  onSelectUnmatched,
  className,
}: {
  session: MappingSession;
  interaction: Interaction;
  onSelectQuestion: (questionId: string) => void;
  onSelectUnmatched: (answerId: string) => void;
  className: string;
}) {
  const warningCount = new Set(session.warnings.map((item) => item.page)).size;
  const grades = Object.values(interaction.gradesById);

  return (
    <div className={className}>
      {session.warnings.length > 0 ? (
        <p
          className="mb-6 rounded-md bg-warning-bg px-4 py-3 text-body-small text-warning-text"
          role="status"
        >
          {warningCount === 1
            ? "1 page couldn't be read"
            : `${warningCount} pages couldn't be read`}
          . Mapping continued with the pages that succeeded.
        </p>
      ) : null}

      <GradingSummary
        results={interaction.mapping.results}
        grades={grades}
        inFlight={interaction.grading}
        error={interaction.gradeError}
        onGradeAll={() => {
          void interaction.gradeAll();
        }}
      />

      <QuestionList
        results={interaction.mapping.results}
        gradesById={interaction.displayGradesById}
        expandedIds={interaction.expandedIds}
        selectedQuestionId={interaction.selectedQuestionId}
        allExpanded={interaction.allExpanded}
        grading={interaction.grading}
        onExpandAll={interaction.expandAll}
        onSelect={onSelectQuestion}
        onToggleExpand={interaction.toggleExpand}
      />

      <UnmatchedAnswers
        items={interaction.mapping.unmatchedAnswers}
        selectedAnswerId={interaction.selectedUnmatchedId}
        onSelect={onSelectUnmatched}
      />
    </div>
  );
}
