/**
 * Standalone validation of the map-answer pipeline: one combined image
 * (printed markers + handwritten labels) -> extractMapMarkersAndLabels ->
 * matchMapAnswers -> gradeMapAnswers.
 *
 * Does not import lib/matching.ts. Live Gemini is optional: without a key,
 * the script still matches against the synthetic PNG's ground-truth labels.
 *
 * Usage:
 *   npx tsx scripts/test-map-questions.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isGeminiRateLimitError } from "../lib/gemini";
import {
  extractMapMarkersAndLabels,
  extractedToMarkersAndLabels,
  gradeMapAnswers,
  matchMapAnswers,
} from "../lib/map-questions";
import { MAP_SAMPLE_PNG, MAP_SAMPLE_TRUTH, writeMapSamplePng } from "./generate-map-sample";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_PATHS = [
  MAP_SAMPLE_PNG,
  resolve(ROOT, "test-assets/map-answer-sample.jpg"),
];
const OUT_PATH = resolve(ROOT, "test-assets/diagnostics/map-questions-result.json");

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

function loadSampleImage(): { base64: string; path: string } {
  writeMapSamplePng();
  const imgPath = CANDIDATE_PATHS.find((path) => existsSync(path));
  if (!imgPath) {
    throw new Error("Failed to write map-answer-sample.png");
  }
  const buffer = readFileSync(imgPath);
  const ext = imgPath.toLowerCase().endsWith(".jpg") ? "jpeg" : "png";
  return {
    base64: `data:image/${ext};base64,${buffer.toString("base64")}`,
    path: imgPath,
  };
}

async function main() {
  loadEnvFiles();
  const { base64, path: imgPath } = loadSampleImage();
  console.log(`Loaded sample map: ${imgPath}\n`);

  const fromTruth = extractedToMarkersAndLabels(MAP_SAMPLE_TRUTH);
  const canned = matchMapAnswers(fromTruth.markers, fromTruth.labels);
  console.log("Ground-truth match (no Gemini):");
  console.log(`  Matched: ${canned.matched.length}`);
  console.log(`  Unanswered markers: ${canned.unansweredMarkers.length}`);
  console.log(`  Orphan labels: ${canned.orphanLabels.length}`);
  if (canned.unansweredMarkers.length !== 1 || canned.matched.length !== 5) {
    throw new Error("Synthetic map should have 5 labels and 1 unanswered marker");
  }

  if (!process.env.GEMINI_API_KEY) {
    console.log(
      "\nGEMINI_API_KEY missing — skipped extractMapMarkersAndLabels / gradeMapAnswers.",
    );
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ sourceImage: imgPath, canned, live: null }, null, 2),
    );
    console.log(`Wrote ${OUT_PATH}`);
    return;
  }

  console.log("\nRunning extractMapMarkersAndLabels...");
  let extracted;
  try {
    extracted = await extractMapMarkersAndLabels(base64, 1);
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      console.warn("Live extract hit 429 — canned match above still stands.");
      process.exit(0);
    }
    throw error;
  }

  console.log(`\nExtracted ${extracted.length} marker(s):`);
  for (const item of extracted) {
    console.log(
      `  #${item.markerNumber ?? "(unlabeled marker!)"} at (${item.x.toFixed(2)}, ${item.y.toFixed(2)}) -> student wrote: "${item.studentLabel ?? "(none)"}"`,
    );
  }

  if (extracted.length === 0) {
    console.log(
      "\nZero markers extracted. Open the PNG and confirm the numbered dots are visible.",
    );
  }

  const nullMarkerNumbers = extracted.filter((item) => item.markerNumber == null);
  if (nullMarkerNumbers.length > 0) {
    console.log(
      `\nNOTE: ${nullMarkerNumbers.length} marker(s) came back with no number.`,
    );
  }

  console.log("\nRunning matchMapAnswers...");
  const { markers, labels } = extractedToMarkersAndLabels(extracted);
  const matchResult = matchMapAnswers(markers, labels);
  console.log(`  Matched: ${matchResult.matched.length}`);
  console.log(`  Unanswered markers: ${matchResult.unansweredMarkers.length}`);
  console.log(
    `  Orphan labels (no matching marker number): ${matchResult.orphanLabels.length}`,
  );

  let grades = null;
  if (matchResult.matched.length === 0) {
    console.log("\nNo matched pairs to grade — skipping gradeMapAnswers.");
  } else {
    console.log(
      `\nRunning gradeMapAnswers on ${matchResult.matched.length} pair(s)...`,
    );
    try {
      grades = await gradeMapAnswers(base64, matchResult.matched);
      console.log("\nGrading results:");
      for (const grade of grades) {
        console.log(
          `  #${grade.markerNumber}: "${grade.studentLabel}" -> ${grade.verdict}` +
            (grade.verdict === "incorrect" && grade.correctAnswer
              ? ` (correct: ${grade.correctAnswer})`
              : ""),
        );
      }
      const gradedNumbers = new Set(grades.map((grade) => grade.markerNumber));
      const missing = matchResult.matched.filter(
        (pair) => !gradedNumbers.has(pair.marker.markerNumber),
      );
      if (missing.length > 0) {
        console.log(
          `\nFLAG: ${missing.length} matched pair(s) got no grade back: ` +
            missing.map((pair) => pair.marker.markerNumber).join(", "),
        );
      }
    } catch (error) {
      if (isGeminiRateLimitError(error)) {
        console.warn("Live grade hit 429 — extract/match output is still saved.");
      } else {
        throw error;
      }
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        sourceImage: imgPath,
        canned,
        extracted,
        matchResult,
        grades,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull output saved to: ${OUT_PATH}`);
  console.log(
    "\nManual checks:\n" +
      "  1. Marker count vs the six numbered dots on the PNG.\n" +
      "  2. Marker 3 should be unanswered; marker 5 (Paris) should grade incorrect if geography is readable.\n" +
      "  3. Combined write-on-map — labels sit next to dots, not on a separate sheet.",
  );
}

main().catch((error) => {
  console.error("Map pipeline test failed:", error);
  process.exit(1);
});
