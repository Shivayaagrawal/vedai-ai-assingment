import {
  extractAnswersRequest,
  extractQuestionsRequest,
  ExtractRequestError,
  RATE_LIMIT_MESSAGE,
  type AnswersExtract,
  type QuestionsExtract,
  type PageProgressFn,
} from "./extract-client";
import { mapAnswersToQuestions, type MappingOutput } from "./matching";
import { pagesFromUpload } from "./pdf-to-images";
import type { ExtractPageInput, ExtractWarning } from "./types";
import type { SelectedUpload } from "./upload-file";

export const PIPELINE_STAGES = {
  reading: "Reading your files...",
  extractingBoth: "Extracting questions and answers...",
  extractingQuestions: "Extracting questions...",
  extractingAnswers: "Extracting answers...",
  mapping: "Mapping answers to questions...",
} as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[keyof typeof PIPELINE_STAGES];

export type PipelineProgress = {
  stage: PipelineStage;
  message: string;
};

export function pipelineHeading(stage: PipelineStage): string {
  if (stage === PIPELINE_STAGES.reading) return "Scanning...";
  if (stage === PIPELINE_STAGES.mapping) return "Mapping...";
  return "Extracting...";
}

function pagesLabel(count: number): string {
  return count === 1 ? "1 page" : `${count} pages`;
}

function countLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export type PipelineCache = {
  questionPages?: ExtractPageInput[];
  answerPages?: ExtractPageInput[];
  questions?: QuestionsExtract;
  answers?: AnswersExtract;
};

export type MappingSession = {
  mapping: MappingOutput;
  warnings: ExtractWarning[];
  questionPages: ExtractPageInput[];
  answerPages: ExtractPageInput[];
};

export type PipelineFailure = {
  ok: false;
  cache: PipelineCache;
  rateLimited: boolean;
  failed: "questions" | "answers" | "both" | "convert";
  message: string;
};

export type PipelineSuccess = {
  ok: true;
  session: MappingSession;
};

export type ConvertUploadFn = (
  upload: SelectedUpload,
  onPage?: (current: number, total: number) => void,
) => Promise<ExtractPageInput[]>;

export type PipelineDeps = {
  convert?: ConvertUploadFn;
  extractQuestions?: (
    pages: ExtractPageInput[] | undefined,
    onPage?: PageProgressFn,
  ) => Promise<QuestionsExtract>;
  extractAnswers?: (
    pages: ExtractPageInput[] | undefined,
    onPage?: PageProgressFn,
  ) => Promise<AnswersExtract>;
};

export async function runExtractPipeline(
  questionPaper: SelectedUpload,
  answerSheet: SelectedUpload,
  cache: PipelineCache,
  onStage: (progress: PipelineProgress) => void,
  deps: PipelineDeps = {},
): Promise<PipelineSuccess | PipelineFailure> {
  const convert = deps.convert ?? pagesFromUpload;
  const extractQuestions = deps.extractQuestions ?? extractQuestionsRequest;
  const extractAnswers = deps.extractAnswers ?? extractAnswersRequest;
  const next: PipelineCache = { ...cache };

  const report = (stage: PipelineStage, message: string) => {
    onStage({ stage, message });
  };

  try {
    if (!next.questionPages || !next.answerPages) {
      report(PIPELINE_STAGES.reading, "Opening your files…");
      if (!next.questionPages) {
        next.questionPages = await convert(questionPaper, (current, total) => {
          report(
            PIPELINE_STAGES.reading,
            `Scanning the question paper — page ${current} of ${total}…`,
          );
        });
        report(
          PIPELINE_STAGES.reading,
          `Scanned the question paper (${pagesLabel(next.questionPages.length)}).`,
        );
      }
      if (!next.answerPages) {
        next.answerPages = await convert(answerSheet, (current, total) => {
          report(
            PIPELINE_STAGES.reading,
            `Scanning the answer sheet — page ${current} of ${total}…`,
          );
        });
        report(
          PIPELINE_STAGES.reading,
          `Scanned the answer sheet (${pagesLabel(next.answerPages.length)}).`,
        );
      }
    }
  } catch (error) {
    return {
      ok: false,
      cache: next,
      rateLimited: false,
      failed: "convert",
      message:
        error instanceof Error ? error.message : "Couldn't read this file",
    };
  }

  const needQuestions = next.questions === undefined;
  const needAnswers = next.answers === undefined;

  try {
    if (needQuestions || needAnswers) {
      const questionPageCount = next.questionPages?.length ?? 0;
      const answerPageCount = next.answerPages?.length ?? 0;
      let questionPageProgress = "";
      let answerPageProgress = "";

      const publishExtract = () => {
        const lines = [questionPageProgress, answerPageProgress].filter(Boolean);
        if (needQuestions && needAnswers) {
          report(
            PIPELINE_STAGES.extractingBoth,
            lines.length > 0
              ? lines.join(" ")
              : `Extracting questions on ${pagesLabel(questionPageCount)} and answers on ${pagesLabel(answerPageCount)}…`,
          );
        } else if (needQuestions) {
          report(
            PIPELINE_STAGES.extractingQuestions,
            questionPageProgress ||
              `Extracting questions on ${pagesLabel(questionPageCount)}…`,
          );
        } else {
          report(
            PIPELINE_STAGES.extractingAnswers,
            answerPageProgress ||
              `Extracting handwritten answers on ${pagesLabel(answerPageCount)}…`,
          );
        }
      };

      publishExtract();

      const questionPromise = needQuestions
        ? extractQuestions(next.questionPages, (current, total) => {
            questionPageProgress = `Extracting questions — page ${current} of ${total}.`;
            publishExtract();
          }).then((value) => {
            next.questions = value;
            questionPageProgress = `Extracted ${countLabel(value.questions.length, "question", "questions")}.`;
            publishExtract();
            return value;
          })
        : Promise.resolve(next.questions);

      const answerPromise = needAnswers
        ? extractAnswers(next.answerPages, (current, total) => {
            answerPageProgress = `Extracting answers — page ${current} of ${total}.`;
            publishExtract();
          }).then((value) => {
            next.answers = value;
            answerPageProgress = `Extracted ${countLabel(value.answers.length, "answer", "answers")}.`;
            publishExtract();
            return value;
          })
        : Promise.resolve(next.answers);

      const settled = await Promise.allSettled([questionPromise, answerPromise]);
      const questionResult = settled[0];
      const answerResult = settled[1];

      const qFailed = questionResult.status === "rejected";
      const aFailed = answerResult.status === "rejected";
      if (qFailed || aFailed) {
        const errors = [questionResult, answerResult].filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        const rateLimited = errors.some(
          (result) =>
            result.reason instanceof ExtractRequestError &&
            result.reason.rateLimited,
        );
        const failed: PipelineFailure["failed"] =
          qFailed && aFailed ? "both" : qFailed ? "questions" : "answers";
        const first = errors[0]?.reason;
        const message =
          rateLimited
            ? RATE_LIMIT_MESSAGE
            : first instanceof Error
              ? first.message
              : "Something went wrong";
        return { ok: false, cache: next, rateLimited, failed, message };
      }
    }

    const questions = next.questions!.questions;
    const answers = next.answers!.answers;
    report(
      PIPELINE_STAGES.mapping,
      `Matching ${countLabel(answers.length, "answer", "answers")} to ${countLabel(questions.length, "question", "questions")}…`,
    );
    const mapping = mapAnswersToQuestions(questions, answers);
    const warnings = [
      ...(next.questions?.warnings ?? []),
      ...(next.answers?.warnings ?? []),
    ];

    return {
      ok: true,
      session: {
        mapping,
        warnings,
        questionPages: next.questionPages!,
        answerPages: next.answerPages!,
      },
    };
  } catch (error) {
    return {
      ok: false,
      cache: next,
      rateLimited:
        error instanceof ExtractRequestError && error.rateLimited,
      failed: "both",
      message:
        error instanceof ExtractRequestError && error.rateLimited
          ? RATE_LIMIT_MESSAGE
          : error instanceof Error
            ? error.message
            : "Something went wrong",
    };
  }
}
