import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapAnswersToQuestions } from "../lib/matching";
import {
  generatePhase1Fixtures,
  generatePhase2Fixtures,
} from "./generate-test-assets";

function dataUrl(filePath: string): string {
  return `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
}

async function main() {
  generatePhase1Fixtures();
  generatePhase2Fixtures();
  const qp = dataUrl(resolve("test-assets/sample-qp-page1.png"));
  const as = dataUrl(resolve("test-assets/sample-clean.png"));
  const started = Date.now();
  const [qRes, aRes] = await Promise.all([
    fetch("http://localhost:3000/api/extract-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages: [{ pageNumber: 1, imageBase64: qp }],
      }),
    }),
    fetch("http://localhost:3000/api/extract-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages: [{ pageNumber: 1, imageBase64: as }],
      }),
    }),
  ]);
  const qJson = (await qRes.json()) as {
    questions?: unknown[];
    warnings?: unknown[];
    error?: string;
  };
  const aJson = (await aRes.json()) as {
    answers?: unknown[];
    warnings?: unknown[];
    error?: string;
  };
  console.log("status", qRes.status, aRes.status, "ms", Date.now() - started);
  console.log("questions", qJson.questions?.length, "qWarnings", qJson.warnings);
  console.log("answers", aJson.answers?.length, "aWarnings", aJson.warnings);
  if (!qRes.ok || !aRes.ok) {
    console.error(qJson, aJson);
    process.exit(1);
  }
  const mapped = mapAnswersToQuestions(
    qJson.questions as never,
    aJson.answers as never,
  );
  console.log(
    "mapped",
    mapped.results.length,
    "unmatched",
    mapped.unmatchedAnswers.length,
  );
  console.log("[test-phase7] PASS image-only parallel extract");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
