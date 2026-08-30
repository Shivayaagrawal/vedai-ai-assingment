"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestGrades } from "../lib/grade-client";
import { previewDisplayGrades, skippedQuestionGrades } from "../lib/grading";
import {
  firstRegionPage,
  highlightTagForQuestion,
  highlightTagForUnmatched,
  type SheetHighlight,
} from "../lib/highlight-geometry";
import type { MappingSession } from "../lib/pipeline";
import { highlightToneForGrade } from "../lib/question-ui";
import type { GradeResult, MappedResult } from "../lib/types";
import type { ViewerSelection } from "./AnswerSheetViewer";

function pageIndexForNumber(pageNumbers: number[], pageNumber: number): number {
  const index = pageNumbers.findIndex((value) => value === pageNumber);
  return index >= 0 ? index : 0;
}

function gradesRecord(grades: GradeResult[]): Record<string, GradeResult> {
  const next: Record<string, GradeResult> = {};
  for (const grade of grades) {
    next[grade.questionId] = grade;
  }
  return next;
}

function selectionForResult(
  result: MappedResult,
  grade: GradeResult | undefined,
): ViewerSelection {
  if (
    result.status === "unanswered" ||
    result.status === "not-attempted-choice" ||
    result.answer === null
  ) {
    return { kind: "unanswered" };
  }
  return {
    kind: "answer",
    answer: result.answer,
    tag: highlightTagForQuestion(result.question),
    tone: highlightToneForGrade(grade),
  };
}

export function useResultsInteraction(
  session: MappingSession,
  options: { autoGrade?: boolean } = {},
) {
  const { mapping } = session;
  const answerPages = session.answerPages;
  const autoGrade = options.autoGrade ?? false;
  const skippedSeed = useMemo(
    () => gradesRecord(skippedQuestionGrades(mapping.results)),
    [mapping.results],
  );
  const previewSeed = useMemo(
    () => gradesRecord(previewDisplayGrades(mapping.results)),
    [mapping.results],
  );
  const pageImages = useMemo(
    () => ({
      questionPaper: session.questionPages.map((page) => page.imageBase64),
      answerSheet: answerPages.map((page) => page.imageBase64),
    }),
    [session.questionPages, answerPages],
  );
  const pageNumbers = useMemo(
    () => answerPages.map((page) => page.pageNumber),
    [answerPages],
  );

  const [pageIndex, setPageIndex] = useState(0);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [selectedUnmatchedId, setSelectedUnmatchedId] = useState<string | null>(
    null,
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [apiGrades, setApiGrades] = useState<Record<string, GradeResult>>({});
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const gradeRunRef = useRef(0);
  const gradesById = useMemo(
    () => ({ ...skippedSeed, ...apiGrades }),
    [skippedSeed, apiGrades],
  );
  const displayGradesById = useMemo(
    () => ({ ...previewSeed, ...skippedSeed, ...apiGrades }),
    [previewSeed, skippedSeed, apiGrades],
  );

  const viewerSelection: ViewerSelection = (() => {
    if (selectedUnmatchedId) {
      const unmatched = mapping.unmatchedAnswers.find(
        (item) => item.answer.id === selectedUnmatchedId,
      );
      if (!unmatched) return null;
      return {
        kind: "answer",
        answer: unmatched.answer,
        tag: highlightTagForUnmatched(unmatched.answer),
      };
    }
    if (selectedQuestionId) {
      const result = mapping.results.find(
        (item) => item.question.id === selectedQuestionId,
      );
      return result
        ? selectionForResult(result, displayGradesById[result.question.id])
        : null;
    }
    return null;
  })();

  const sheetHighlights: SheetHighlight[] = useMemo(() => {
    const mapped: SheetHighlight[] = mapping.results.flatMap((result) => {
      if (!result.answer) return [];
      return [
        {
          answer: result.answer,
          tag: highlightTagForQuestion(result.question),
          tone: highlightToneForGrade(displayGradesById[result.question.id]),
          emphasized: result.question.id === selectedQuestionId,
        },
      ];
    });
    const unmatched: SheetHighlight[] = mapping.unmatchedAnswers
      .filter((item) => item.answer.id === selectedUnmatchedId)
      .map((item) => ({
        answer: item.answer,
        tag: highlightTagForUnmatched(item.answer),
        emphasized: true,
      }));
    return [...mapped, ...unmatched];
  }, [
    displayGradesById,
    mapping.results,
    mapping.unmatchedAnswers,
    selectedQuestionId,
    selectedUnmatchedId,
  ]);

  const jumpToAnswerPage = useCallback(
    (pageNumber: number | null) => {
      if (pageNumber === null) return;
      setPageIndex(pageIndexForNumber(pageNumbers, pageNumber));
    },
    [pageNumbers],
  );

  function selectQuestion(questionId: string) {
    setSelectedUnmatchedId(null);
    setSelectedQuestionId(questionId);
    const result = mapping.results.find((item) => item.question.id === questionId);
    if (result?.answer) {
      jumpToAnswerPage(firstRegionPage(result.answer.regions));
    }
  }

  function toggleExpand(questionId: string) {
    if (allExpanded) {
      setAllExpanded(false);
      const next = new Set(mapping.results.map((item) => item.question.id));
      next.delete(questionId);
      setExpandedIds(next);
      return;
    }
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  function expandAll() {
    if (allExpanded) {
      setAllExpanded(false);
      setExpandedIds(new Set());
      return;
    }
    setAllExpanded(true);
  }

  function selectUnmatched(answerId: string) {
    setSelectedQuestionId(null);
    setSelectedUnmatchedId(answerId);
    if (!allExpanded) {
      setExpandedIds(new Set());
    }
    const unmatched = mapping.unmatchedAnswers.find(
      (item) => item.answer.id === answerId,
    );
    if (unmatched) {
      jumpToAnswerPage(firstRegionPage(unmatched.answer.regions));
    }
  }

  const gradeAll = useCallback(async () => {
    const runId = ++gradeRunRef.current;
    setGrading(true);
    setGradeError(null);
    try {
      const { grades: nextGrades } = await requestGrades(
        mapping.results,
        answerPages,
      );
      if (gradeRunRef.current !== runId) return;
      setApiGrades(gradesRecord(nextGrades));
    } catch (error) {
      if (gradeRunRef.current !== runId) return;
      setGradeError(
        error instanceof Error ? error.message : "Grading failed.",
      );
    } finally {
      if (gradeRunRef.current === runId) setGrading(false);
    }
  }, [answerPages, mapping.results]);

  useEffect(() => {
    if (!autoGrade) return;
    void gradeAll();
  }, [autoGrade, gradeAll]);

  return {
    mapping,
    pageImages,
    pageNumbers,
    pageIndex,
    setPageIndex,
    selectedQuestionId,
    selectedUnmatchedId,
    expandedIds,
    allExpanded,
    gradesById,
    displayGradesById,
    grading,
    gradeError,
    viewerSelection,
    sheetHighlights,
    selectQuestion,
    toggleExpand,
    expandAll,
    selectUnmatched,
    gradeAll,
  };
}
