import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtractRequestError } from "./extract-client";
import { PIPELINE_STAGES, runExtractPipeline } from "./pipeline";
import type { Answer, ExtractPageInput, Question } from "./types";
import type { SelectedUpload } from "./upload-file";

function upload(kind: SelectedUpload["kind"], name: string): SelectedUpload {
  return {
    file: new File([new Uint8Array([1, 2, 3])], name),
    pageCount: 1,
    sizeBytes: 3,
    kind,
  };
}

const page: ExtractPageInput = {
  pageNumber: 1,
  imageBase64: "data:image/png;base64,aaaa",
};

const question: Question = {
  id: "q1",
  displayNumber: "1",
  text: "Define velocity.",
  page: 1,
};

const answer: Answer = {
  id: "a1",
  detectedQuestionNumber: "1",
  text: "displacement / time",
  regions: [{ page: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.1 }],
  confidence: 0.9,
};

describe("runExtractPipeline", () => {
  it("skips pdf conversion for image uploads", async () => {
    const converted: string[] = [];
    const result = await runExtractPipeline(
      upload("image", "qp.png"),
      upload("image", "as.jpg"),
      {},
      () => undefined,
      {
        convert: async (file) => {
          converted.push(file.kind);
          assert.equal(file.kind, "image");
          return [page];
        },
        extractQuestions: async () => ({ questions: [question], warnings: [] }),
        extractAnswers: async () => ({ answers: [answer], warnings: [] }),
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(converted, ["image", "image"]);
  });

  it("retries only the failed extract and keeps the successful one", async () => {
    let questionCalls = 0;
    let answerCalls = 0;
    const extractQuestions = async () => {
      questionCalls += 1;
      return { questions: [question], warnings: [] };
    };
    const extractAnswers = async () => {
      answerCalls += 1;
      throw new ExtractRequestError("answers", false, "boom");
    };

    const stages: string[] = [];
    const first = await runExtractPipeline(
      upload("pdf", "qp.pdf"),
      upload("pdf", "as.pdf"),
      {},
      (progress) => stages.push(progress.stage),
      {
        convert: async () => [page],
        extractQuestions,
        extractAnswers,
      },
    );

    assert.equal(first.ok, false);
    if (first.ok) return;
    assert.equal(first.failed, "answers");
    assert.ok(first.cache.questions);
    assert.equal(first.cache.answers, undefined);
    assert.equal(questionCalls, 1);
    assert.equal(answerCalls, 1);

    const second = await runExtractPipeline(
      upload("pdf", "qp.pdf"),
      upload("pdf", "as.pdf"),
      first.cache,
      () => undefined,
      {
        convert: async () => {
          throw new Error("should not reconvert");
        },
        extractQuestions: async () => {
          throw new Error("should not re-extract questions");
        },
        extractAnswers: async () => {
          answerCalls += 1;
          return { answers: [answer], warnings: [] };
        },
      },
    );

    assert.equal(second.ok, true);
    assert.equal(questionCalls, 1);
    assert.equal(answerCalls, 2);
    assert.ok(stages.includes(PIPELINE_STAGES.reading));
    assert.ok(stages.includes(PIPELINE_STAGES.extractingBoth));
  });

  it("reports live counts instead of filler wait copy", async () => {
    const messages: string[] = [];
    await runExtractPipeline(
      upload("pdf", "qp.pdf"),
      upload("pdf", "as.pdf"),
      {},
      (progress) => messages.push(progress.message),
      {
        convert: async (_file, onPage) => {
          onPage?.(1, 2);
          onPage?.(2, 2);
          return [page, { ...page, pageNumber: 2 }];
        },
        extractQuestions: async () => ({ questions: [question], warnings: [] }),
        extractAnswers: async () => ({ answers: [answer], warnings: [] }),
      },
    );
    assert.ok(messages.some((line) => /question paper — page 1 of 2/.test(line)));
    assert.ok(messages.some((line) => /answer sheet — page/.test(line)));
    assert.ok(
      messages.some((line) =>
        /Detecting questions on 2 pages and answers on 2 pages/.test(line),
      ),
    );
    assert.ok(
      messages.some((line) => /Matching 1 answer to 1 question/.test(line)),
    );
    assert.ok(!messages.some((line) => /just a little longer/i.test(line)));
  });

  it("proceeds to results when warnings are present", async () => {
    const result = await runExtractPipeline(
      upload("image", "qp.png"),
      upload("image", "as.png"),
      {},
      () => undefined,
      {
        convert: async () => [page],
        extractQuestions: async () => ({
          questions: [question],
          warnings: [{ page: 2, message: "Page 2 failed: bad base64" }],
        }),
        extractAnswers: async () => ({ answers: [answer], warnings: [] }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.session.warnings.length, 1);
    assert.equal(result.session.mapping.results.length, 1);
  });

  it("surfaces a rate-limit failure distinctly", async () => {
    const result = await runExtractPipeline(
      upload("pdf", "qp.pdf"),
      upload("image", "as.png"),
      {},
      () => undefined,
      {
        convert: async () => [page],
        extractQuestions: async () => {
          throw new ExtractRequestError("questions", true, "Rate limit reached — please wait a moment and retry");
        },
        extractAnswers: async () => ({ answers: [answer], warnings: [] }),
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rateLimited, true);
    assert.equal(result.failed, "questions");
    assert.match(result.message, /Rate limit reached/);
    assert.ok(result.cache.answers);
  });
});
