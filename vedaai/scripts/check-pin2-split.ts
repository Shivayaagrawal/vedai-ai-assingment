/**
 * Pin #2 live-dump check (no Gemini calls).
 *
 * The extract prompt asks Gemini to split a labeled block that is followed by
 * a different unlabeled topic (the real-paper Q1 inertia + photosynthesis
 * equation merge). That split can create a new unlabeled box the current
 * matcher never saw when the region was one labeled card.
 *
 * After quota recovers:
 *   1. npx tsx scripts/test-real-papers.ts
 *   2. npx tsx scripts/check-pin2-split.ts
 *
 * Specifically look at: did the split create a third unlabeled box, and did
 * that box bind to B2 (photosynthesis) via topic overlap rather than A2
 * (newton) via paper order. Confidence stays 0.3 either way.
 *
 * This script also simulates a split of the current merged Q1 dump (no Gemini)
 * so the fallback change can be checked against real strings before quota
 * recovers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapAnswersToQuestions } from "../lib/matching";
import type { Answer, MappedResult, Question } from "../lib/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DUMP_PATH = resolve(ROOT, "test-assets/output-real-pipeline.json");
const OUT_PATH = resolve(
  ROOT,
  "test-assets/diagnostics/pin2-split-check.json",
);

const PHOTOSYNTHESIS_RE = /photosynthesis|6\s*co2|c6h12o6/i;
const INERTIA_RE = /inertia/i;
const POSITIONAL_CONFIDENCE = 0.3;

type BoundSummary = {
  questionId: string;
  questionLabel: string;
  questionText: string;
  matchConfidence: number;
  status: string;
} | null;

export type Pin2SplitReport = {
  dumpPath: string;
  unlabeledCount: number;
  labeledQ1StillMerged: boolean;
  splitLooksApplied: boolean;
  unlabeledPhotosynthesis: {
    id: string;
    text: string;
    pages: number[];
  } | null;
  positionalFallbackPairs: Array<{
    questionId: string;
    questionLabel: string;
    questionText: string;
    answerId: string;
    answerText: string;
  }>;
  unlabeledPhotosynthesisBoundTo: BoundSummary;
  simulatedSplitBoundTo: BoundSummary;
  simulatedSplitWithPrintedB2BoundTo: BoundSummary;
  notes: string[];
};

const PRINTED_B2: Question = {
  id: "dry-run-section-b-2",
  displayNumber: "2",
  section: "SECTION B — BIOLOGY & CHEMISTRY",
  text: "What is photosynthesis? Write the balanced chemical equation for photosynthesis.",
  page: 2,
  maxMarks: 4,
};

const PRINTED_Q10: Question = {
  id: "dry-run-q10",
  displayNumber: "10",
  text: "Balance the following chemical equation: Fe + O2 -> Fe2O3",
  page: 2,
  maxMarks: 3,
};

function isLabeled(answer: Answer): boolean {
  const raw = answer.detectedQuestionNumber;
  return typeof raw === "string" && raw.trim() !== "";
}

function questionLabel(question: Question): string {
  return question.subPart
    ? `${question.displayNumber}(${question.subPart})`
    : question.displayNumber;
}

function boundSummaryForPhotosynthesis(
  results: MappedResult[],
  answers: Answer[],
): BoundSummary {
  const unlabeled = answers.find(
    (answer) => !isLabeled(answer) && PHOTOSYNTHESIS_RE.test(answer.text),
  );
  if (!unlabeled) return null;
  const row = results.find((item) => item.answer?.id === unlabeled.id);
  if (!row) return null;
  return {
    questionId: row.question.id,
    questionLabel: questionLabel(row.question),
    questionText: row.question.text,
    matchConfidence: row.matchConfidence,
    status: row.status,
  };
}

function splitMergedQ1IfPresent(answers: Answer[]): Answer[] | null {
  const merged = answers.find(
    (answer) =>
      isLabeled(answer) &&
      INERTIA_RE.test(answer.text) &&
      PHOTOSYNTHESIS_RE.test(answer.text),
  );
  if (!merged) return null;

  const lines = merged.text.split(/\n+/);
  const unlabeledLines = lines.filter((line) => PHOTOSYNTHESIS_RE.test(line));
  const labeledLines = lines.filter((line) => !PHOTOSYNTHESIS_RE.test(line));
  const region = merged.regions[0];
  const unlabeled: Answer = {
    ...merged,
    id: `${merged.id}-split-unlabeled`,
    detectedQuestionNumber: null,
    text: unlabeledLines.join("\n"),
    regions: region
      ? [
          {
            ...region,
            y: region.y + region.height * 0.55,
            height: region.height * 0.45,
          },
        ]
      : merged.regions,
  };
  const labeled: Answer = {
    ...merged,
    id: `${merged.id}-split-labeled`,
    text: labeledLines.join("\n"),
    regions: region
      ? [{ ...region, height: region.height * 0.55 }]
      : merged.regions,
  };
  return answers.flatMap((answer) =>
    answer.id === merged.id ? [labeled, unlabeled] : [answer],
  );
}

export function analyzePin2Split(
  questions: Question[],
  answers: Answer[],
  results: MappedResult[],
): Pin2SplitReport {
  const unlabeled = answers.filter((answer) => !isLabeled(answer));
  const labeledQ1Merged = answers.some(
    (answer) =>
      isLabeled(answer) &&
      INERTIA_RE.test(answer.text) &&
      PHOTOSYNTHESIS_RE.test(answer.text),
  );
  const labeledInertiaOnly = answers.some(
    (answer) =>
      isLabeled(answer) &&
      INERTIA_RE.test(answer.text) &&
      !PHOTOSYNTHESIS_RE.test(answer.text),
  );
  const unlabeledPhotosynthesis =
    unlabeled.find((answer) => PHOTOSYNTHESIS_RE.test(answer.text)) ?? null;

  const positionalFallbackPairs = results
    .filter(
      (row) =>
        row.answer &&
        row.matchConfidence === POSITIONAL_CONFIDENCE &&
        row.status === "low-confidence",
    )
    .map((row) => ({
      questionId: row.question.id,
      questionLabel: questionLabel(row.question),
      questionText: row.question.text,
      answerId: row.answer!.id,
      answerText: row.answer!.text,
    }));

  const boundRow = unlabeledPhotosynthesis
    ? results.find((row) => row.answer?.id === unlabeledPhotosynthesis.id) ??
      null
    : null;

  const notes: string[] = [];
  if (labeledQ1Merged) {
    notes.push(
      "Q1 is still one labeled box containing inertia AND the photosynthesis equation — the prompt split did not fire on this dump.",
    );
  }
  if (labeledInertiaOnly && unlabeledPhotosynthesis) {
    notes.push(
      "Split looks applied: labeled inertia-only Q1 plus an unlabeled photosynthesis box.",
    );
  }
  if (unlabeledPhotosynthesis && !boundRow) {
    notes.push(
      "Unlabeled photosynthesis box was not mapped to any question (leftover unmatched). Positional fallback did not claim it — likely no unanswered slots remained.",
    );
  }
  if (boundRow) {
    const looksLikePhotosynthesisQuestion = PHOTOSYNTHESIS_RE.test(
      boundRow.question.text,
    );
    if (boundRow.matchConfidence === POSITIONAL_CONFIDENCE) {
      notes.push(
        looksLikePhotosynthesisQuestion
          ? "Unlabeled photosynthesis box bound at conf=0.3 to a photosynthesis question (topic overlap, or lucky paper-order slot)."
          : `Unlabeled photosynthesis box bound at conf=0.3 to ${questionLabel(boundRow.question)} — topic overlap did not uniquely pick photosynthesis (missing B2 in extract, or a tie).`,
      );
    } else {
      notes.push(
        `Unlabeled photosynthesis box bound to ${questionLabel(boundRow.question)} at confidence ${boundRow.matchConfidence} (not positional fallback).`,
      );
    }
  }
  if (unlabeled.length > 0 && positionalFallbackPairs.length === 0) {
    notes.push(
      `${unlabeled.length} unlabeled box(es) exist but none were claimed by positional fallback.`,
    );
  }
  if (!labeledQ1Merged && !unlabeledPhotosynthesis && !labeledInertiaOnly) {
    notes.push(
      "Dump does not contain the Q1 inertia/photosynthesis region — incomplete extract (429/partial page) or a different paper.",
    );
  }

  const simulatedAnswers = splitMergedQ1IfPresent(answers);
  let simulatedSplitBoundTo: BoundSummary = null;
  let simulatedSplitWithPrintedB2BoundTo: BoundSummary = null;
  if (simulatedAnswers) {
    const simulated = mapAnswersToQuestions(questions, simulatedAnswers);
    simulatedSplitBoundTo = boundSummaryForPhotosynthesis(
      simulated.results,
      simulatedAnswers,
    );
    const hasB2 = questions.some((question) =>
      PHOTOSYNTHESIS_RE.test(question.text),
    );
    const hasQ10 = questions.some((question) => /fe2o3/i.test(question.text));
    const withPrinted = [
      ...questions,
      ...(hasB2 ? [] : [PRINTED_B2]),
      ...(hasQ10 ? [] : [PRINTED_Q10]),
    ];
    const simulatedFull = mapAnswersToQuestions(withPrinted, simulatedAnswers);
    simulatedSplitWithPrintedB2BoundTo = boundSummaryForPhotosynthesis(
      simulatedFull.results,
      simulatedAnswers,
    );
    if (simulatedSplitBoundTo) {
      notes.push(
        `Simulated split on this dump bound unlabeled equation to ${simulatedSplitBoundTo.questionLabel} (${simulatedSplitBoundTo.questionId}).`,
      );
    }
    if (simulatedSplitWithPrintedB2BoundTo) {
      const ok = PHOTOSYNTHESIS_RE.test(
        simulatedSplitWithPrintedB2BoundTo.questionText,
      );
      notes.push(
        ok
          ? `With printed B2/Q10 present, simulated split bound to ${simulatedSplitWithPrintedB2BoundTo.questionLabel} via topic overlap.`
          : `With printed B2/Q10 present, simulated split still bound to ${simulatedSplitWithPrintedB2BoundTo.questionLabel} — not B2.`,
      );
    }
  }

  return {
    dumpPath: DUMP_PATH,
    unlabeledCount: unlabeled.length,
    labeledQ1StillMerged: labeledQ1Merged,
    splitLooksApplied: Boolean(labeledInertiaOnly && unlabeledPhotosynthesis),
    unlabeledPhotosynthesis: unlabeledPhotosynthesis
      ? {
          id: unlabeledPhotosynthesis.id,
          text: unlabeledPhotosynthesis.text,
          pages: unlabeledPhotosynthesis.regions.map((region) => region.page),
        }
      : null,
    positionalFallbackPairs,
    unlabeledPhotosynthesisBoundTo: boundRow
      ? {
          questionId: boundRow.question.id,
          questionLabel: questionLabel(boundRow.question),
          questionText: boundRow.question.text,
          matchConfidence: boundRow.matchConfidence,
          status: boundRow.status,
        }
      : null,
    simulatedSplitBoundTo,
    simulatedSplitWithPrintedB2BoundTo,
    notes,
  };
}

export function printPin2SplitReport(report: Pin2SplitReport): void {
  console.log("\n=== PIN #2 SPLIT / ORPHAN CHECK ===");
  console.log(`unlabeled boxes: ${report.unlabeledCount}`);
  console.log(`Q1 still merged (inertia+equation): ${report.labeledQ1StillMerged}`);
  console.log(`split looks applied: ${report.splitLooksApplied}`);
  if (report.unlabeledPhotosynthesis) {
    console.log(
      `unlabeled photosynthesis: ${report.unlabeledPhotosynthesis.id} pages=${report.unlabeledPhotosynthesis.pages.join(",")} ${report.unlabeledPhotosynthesis.text.replace(/\s+/g, " ").slice(0, 120)}`,
    );
  } else {
    console.log("unlabeled photosynthesis: none");
  }
  if (report.unlabeledPhotosynthesisBoundTo) {
    const bound = report.unlabeledPhotosynthesisBoundTo;
    console.log(
      `live bound to: ${bound.questionLabel} (${bound.questionId}) status=${bound.status} conf=${bound.matchConfidence}`,
    );
  }
  if (report.simulatedSplitBoundTo) {
    const bound = report.simulatedSplitBoundTo;
    console.log(
      `simulated split bound to: ${bound.questionLabel} (${bound.questionId}) conf=${bound.matchConfidence}`,
    );
  }
  if (report.simulatedSplitWithPrintedB2BoundTo) {
    const bound = report.simulatedSplitWithPrintedB2BoundTo;
    console.log(
      `simulated split + printed B2/Q10 bound to: ${bound.questionLabel} (${bound.questionId}) conf=${bound.matchConfidence} ${bound.questionText.slice(0, 80)}`,
    );
  }
  if (report.positionalFallbackPairs.length) {
    console.log("positional-fallback pairs (conf=0.3):");
    for (const pair of report.positionalFallbackPairs) {
      console.log(
        `  ${pair.questionLabel.padEnd(12)} ← ${pair.answerId}  ${pair.answerText.replace(/\s+/g, " ").slice(0, 90)}`,
      );
    }
  } else {
    console.log("positional-fallback pairs (conf=0.3): none");
  }
  for (const note of report.notes) {
    console.log(`note: ${note}`);
  }
}

export function reportPin2SplitFromDump(dumpPath = DUMP_PATH): Pin2SplitReport {
  if (!existsSync(dumpPath)) {
    throw new Error(
      `Missing ${dumpPath}. Run npx tsx scripts/test-real-papers.ts first.`,
    );
  }
  const raw = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    questions?: Question[];
    answers?: Answer[];
  };
  if (!Array.isArray(raw.questions) || !Array.isArray(raw.answers)) {
    throw new Error("Dump must include questions[] and answers[]");
  }
  const mapping = mapAnswersToQuestions(raw.questions, raw.answers);
  return analyzePin2Split(raw.questions, raw.answers, mapping.results);
}

function main() {
  const report = reportPin2SplitFromDump();
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  printPin2SplitReport(report);
  console.log(`[pin2-split] JSON written to ${OUT_PATH}`);
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error("[pin2-split] Failed:", error);
    process.exit(1);
  }
}
