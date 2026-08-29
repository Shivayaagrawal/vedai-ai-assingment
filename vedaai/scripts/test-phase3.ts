import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as extractAnswersPOST } from "../app/api/extract-answers/route";
import { POST as extractQuestionsPOST } from "../app/api/extract-questions/route";
import { generatePhase1Fixtures, generatePhase2Fixtures } from "./generate-test-assets";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = resolve(ROOT, "test-assets");

function loadEnvFiles() {
  for (const filename of [".env.local", ".env"]) {
    const filePath = resolve(ROOT, filename);
    if (!existsSync(filePath)) continue;

    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function fileToDataUrl(filePath: string): string {
  return `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
}

async function callRoute(
  handler: typeof extractQuestionsPOST,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown>; ms: number }> {
  const started = Date.now();
  const request = new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handler(request);
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json, ms: Date.now() - started };
}

function label(q: {
  displayNumber: string;
  subPart?: string;
  page: number;
  section?: string;
}): string {
  const sub = q.subPart ? `(${q.subPart})` : "";
  return `p${q.page}:${q.displayNumber}${sub}`;
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }

  generatePhase1Fixtures();
  generatePhase2Fixtures();

  const page1 = fileToDataUrl(resolve(ASSETS, "sample-qp-page1.png"));
  const page2 = fileToDataUrl(resolve(ASSETS, "sample-qp-page2.png"));
  const answerPage = fileToDataUrl(resolve(ASSETS, "sample-clean.png"));

  console.log("[test-phase3] malformed bodies…");
  const empty = await callRoute(extractQuestionsPOST, []);
  console.log(
    empty.status === 400
      ? `PASS empty array → 400 (${String(empty.json.error)})`
      : `FAIL empty array → ${empty.status} ${JSON.stringify(empty.json)}`,
  );

  const garbage = await callRoute(extractQuestionsPOST, { foo: "bar" });
  console.log(
    garbage.status === 400
      ? `PASS malformed object → 400 (${String(garbage.json.error)})`
      : `FAIL malformed object → ${garbage.status}`,
  );

  const notBase64Field = await callRoute(extractQuestionsPOST, [
    { pageNumber: 1, imageBase64: 123 },
  ]);
  console.log(
    notBase64Field.status === 400
      ? `PASS non-string imageBase64 → 400 (${String(notBase64Field.json.error)})`
      : `FAIL non-string imageBase64 → ${notBase64Field.status}`,
  );

  console.log("[test-phase3] extract-questions happy path (2 pages)…");
  const happy = await callRoute(extractQuestionsPOST, [
    { pageNumber: 1, imageBase64: page1 },
    { pageNumber: 2, imageBase64: page2 },
  ]);
  const questions = Array.isArray(happy.json.questions)
    ? (happy.json.questions as Array<{
        displayNumber: string;
        subPart?: string;
        page: number;
        section?: string;
        maxMarks?: number;
      }>)
    : [];
  const warnings = Array.isArray(happy.json.warnings)
    ? (happy.json.warnings as Array<{ page: number; message: string }>)
    : [];

  console.log(
    `status=${happy.status} count=${questions.length} warnings=${warnings.length} elapsedMs=${happy.ms} (maxDuration=300s)`,
  );
  console.log("order:", questions.map(label).join(" → "));

  const q11a = questions.find(
    (q) => q.displayNumber === "11" && (q.subPart ?? "").startsWith("a"),
  );
  const continuation = questions.find((q) => {
    if (q.page !== 2) return false;
    const sub = (q.subPart ?? "").replace(/\s/g, "").toLowerCase();
    const num = q.displayNumber.replace(/[()]/g, "").toLowerCase();
    return sub.startsWith("b") || num === "b";
  });
  console.log(
    q11a?.page === 1 && continuation?.page === 2
      ? `PASS continuation pages retained (11a section=${q11a.section ?? "null"} page=${q11a.page}; continuation displayNumber=${continuation.displayNumber} subPart=${continuation.subPart ?? "null"} section=${continuation.section ?? "null"} page=${continuation.page})`
      : `FAIL continuation page fields: 11a=${JSON.stringify(q11a)} continuation=${JSON.stringify(continuation)}`,
  );

  const q3 = questions.find((q) => q.displayNumber === "3" && q.page === 2);
  console.log(
    q3
      ? "PASS number-gap Q3 still Q3 (route did not fill to Q2)"
      : "FAIL number-gap Q3 missing or renumbered",
  );
  console.log(
    questions.length === 10 && warnings.length === 0
      ? "PASS route count matches Phase 2 (10 questions, no warnings)"
      : `NOTE count/warnings differ from Phase 2 function-level (count=${questions.length} warnings=${warnings.length})`,
  );

  console.log("[test-phase3] one corrupt page among two…");
  const partial = await callRoute(extractQuestionsPOST, [
    { pageNumber: 1, imageBase64: page1 },
    { pageNumber: 2, imageBase64: "%%%not-valid-base64%%%" },
  ]);
  const partialQuestions = Array.isArray(partial.json.questions)
    ? (partial.json.questions as unknown[])
    : [];
  const partialWarnings = Array.isArray(partial.json.warnings)
    ? (partial.json.warnings as Array<{ page: number; message: string }>)
    : [];
  const partialOk =
    partial.status === 200 &&
    partialQuestions.length > 0 &&
    partialWarnings.some((w) => w.page === 2);
  console.log(
    partialOk
      ? `PASS partial results: ${partialQuestions.length} question(s) + warning on page 2 (${partialWarnings[0]?.message})`
      : `FAIL partial: status=${partial.status} q=${partialQuestions.length} warnings=${JSON.stringify(partialWarnings)}`,
  );

  console.log("[test-phase3] extract-answers one page…");
  const answersRes = await callRoute(extractAnswersPOST, [
    { pageNumber: 1, imageBase64: answerPage },
  ]);
  const answers = Array.isArray(answersRes.json.answers)
    ? (answersRes.json.answers as Array<{ id: string }>)
    : [];
  const idsOk = answers.every((a, i) => a.id === `page1-answer${i + 1}`);
  console.log(
    answersRes.status === 200 && answers.length > 0 && idsOk
      ? `PASS answers ${answers.length} with ids ${answers.map((a) => a.id).join(", ")} elapsedMs=${answersRes.ms}`
      : `FAIL answers status=${answersRes.status} ids=${answers.map((a) => a.id).join(", ")}`,
  );

  console.log("[test-phase3] back-to-back questions request (rate-limit surface)…");
  const second = await callRoute(extractQuestionsPOST, [
    { pageNumber: 1, imageBase64: page1 },
    { pageNumber: 2, imageBase64: page2 },
  ]);
  const secondWarnings = Array.isArray(second.json.warnings)
    ? (second.json.warnings as Array<{ page: number; message: string }>)
    : [];
  const secondQuestions = Array.isArray(second.json.questions)
    ? (second.json.questions as unknown[])
    : [];
  const rateLimited = secondWarnings.some((w) => /429|rate limit/i.test(w.message));
  if (second.status === 500) {
    console.log(`FAIL back-to-back crashed the route: ${JSON.stringify(second.json)}`);
  } else if (rateLimited) {
    console.log(
      `PASS 429 surfaced as per-page warning(s), not a crash; kept ${secondQuestions.length} question(s)`,
    );
  } else {
    console.log(
      `NOTE no 429 on back-to-back (status=${second.status} questions=${secondQuestions.length} warnings=${secondWarnings.length} elapsedMs=${second.ms}). Concurrency waves of 3 still applied.`,
    );
  }

  console.log(
    `[test-phase3] timing vs maxDuration=300s: happy=${(happy.ms / 1000).toFixed(1)}s answers=${(answersRes.ms / 1000).toFixed(1)}s second=${(second.ms / 1000).toFixed(1)}s`,
  );
}

main().catch((error) => {
  console.error("[test-phase3] Failed:", error);
  process.exit(1);
});
