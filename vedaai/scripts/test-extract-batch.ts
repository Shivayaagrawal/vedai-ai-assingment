import { POST as extractAnswersPOST } from "../app/api/extract-answers/route";
import { POST as extractQuestionsPOST } from "../app/api/extract-questions/route";
import { MAX_EXTRACT_PAGES } from "../lib/upload-file";
import {
  EXTRACT_CONCURRENCY,
  mapSettledWithConcurrency,
  parseExtractPagesBody,
} from "../lib/extract-batch";
import { GeminiRateLimitError, isGeminiRateLimitError } from "../lib/gemini";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runUnitTests() {
  const empty = parseExtractPagesBody([]);
  assert(!empty.ok, "empty array should be rejected");

  const notArray = parseExtractPagesBody({ foo: 1 });
  assert(!notArray.ok, "non-array body should be rejected");

  const badNumber = parseExtractPagesBody([
    { pageNumber: "1", imageBase64: "abcd" },
  ]);
  assert(!badNumber.ok, "non-numeric pageNumber should be rejected");

  const missingImage = parseExtractPagesBody([{ pageNumber: 1 }]);
  assert(!missingImage.ok, "missing imageBase64 should be rejected");

  const ok = parseExtractPagesBody([
    { pageNumber: 1, imageBase64: "data:image/png;base64,aaaa" },
    { pageNumber: 2, imageBase64: "bbbbbbbb" },
  ]);
  assert(ok.ok && ok.pages.length === 2, "valid pages should parse");

  const withText = parseExtractPagesBody([
    {
      pageNumber: 1,
      imageBase64: "data:image/png;base64,aaaa",
      textItems: [
        { text: "1. Hello", y: 0.1 },
        { text: "skip-me" },
      ],
    },
  ]);
  assert(
    withText.ok &&
      withText.pages[0].textItems?.length === 1 &&
      withText.pages[0].textItems[0].text === "1. Hello",
    "optional textItems should be kept when well-formed",
  );

  const wrapped = parseExtractPagesBody({
    pages: [{ pageNumber: 3, imageBase64: "cccccccc" }],
  });
  assert(wrapped.ok && wrapped.pages[0].pageNumber === 3, "pages wrapper should parse");

  const atCap = parseExtractPagesBody(
    Array.from({ length: MAX_EXTRACT_PAGES }, (_, index) => ({
      pageNumber: index + 1,
      imageBase64: "aaaaaaaa",
    })),
  );
  assert(atCap.ok, "exactly MAX_EXTRACT_PAGES should parse");

  const tooMany = parseExtractPagesBody(
    Array.from({ length: MAX_EXTRACT_PAGES + 1 }, (_, index) => ({
      pageNumber: index + 1,
      imageBase64: "aaaaaaaa",
    })),
  );
  assert(!tooMany.ok, "bodies over MAX_EXTRACT_PAGES should be rejected");
  if (!tooMany.ok) {
    assert(
      tooMany.error.includes(String(MAX_EXTRACT_PAGES)),
      "page-cap error should name the limit",
    );
  }

  const ninePages = Array.from({ length: MAX_EXTRACT_PAGES + 1 }, (_, index) => ({
    pageNumber: index + 1,
    imageBase64: "aaaaaaaa",
  }));
  const questionsCap = await extractQuestionsPOST(
    new Request("http://localhost/api/extract-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: ninePages }),
    }),
  );
  const answersCap = await extractAnswersPOST(
    new Request("http://localhost/api/extract-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: ninePages }),
    }),
  );
  const questionsJson = (await questionsCap.json()) as { error?: string };
  const answersJson = (await answersCap.json()) as { error?: string };
  assert(questionsCap.status === 400, "extract-questions must 400 on 9 pages");
  assert(answersCap.status === 400, "extract-answers must 400 on 9 pages");
  assert(
    questionsJson.error?.includes(String(MAX_EXTRACT_PAGES)),
    "extract-questions 400 should use the page-cap message",
  );
  assert(
    answersJson.error?.includes(String(MAX_EXTRACT_PAGES)),
    "extract-answers 400 should use the page-cap message",
  );

  let current = 0;
  let peak = 0;
  const settled = await mapSettledWithConcurrency(
    [1, 2, 3, 4, 5, 6],
    EXTRACT_CONCURRENCY,
    async (n) => {
      current += 1;
      peak = Math.max(peak, current);
      await sleep(40);
      current -= 1;
      if (n === 5) throw new GeminiRateLimitError();
      return n * 10;
    },
  );

  assert(peak <= EXTRACT_CONCURRENCY, `peak concurrency ${peak} exceeded ${EXTRACT_CONCURRENCY}`);
  assert(settled.filter((r) => r.status === "fulfilled").length === 5, "five fulfilled");
  assert(settled[4].status === "rejected", "page-equivalent index 5 should reject");
  if (settled[4].status === "rejected") {
    assert(
      isGeminiRateLimitError(settled[4].reason),
      "429 should stay a per-item rejection, not crash the batch",
    );
  }

  console.log("[test-extract-batch] unit checks passed (concurrency peak=", peak, ")");
}

runUnitTests().catch((error) => {
  console.error("[test-extract-batch] Failed:", error);
  process.exit(1);
});
