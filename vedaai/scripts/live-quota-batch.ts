/**
 * One live-quota sitting: text pipeline first (page-2 split + Pin #1 +
 * positional fallback), then map extract/grade. If a 429 stops the first,
 * skip the second so leftover quota isn't spent on the lower-priority path.
 *
 *   npx tsx scripts/live-quota-batch.ts
 *
 * After it finishes, compare:
 *   test-assets/output-real-pipeline.json  (+ Pin #2 block in the log)
 *   test-assets/diagnostics/map-questions-result.json
 * Marker 5 ("Paris") should grade incorrect if extract+grade both ran.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const STEPS = [
  {
    id: "text",
    label: "test-real-papers.ts (page-2 split, Pin #1, positional fallback)",
    file: "scripts/test-real-papers.ts",
    retryFirst: true,
  },
  {
    id: "map",
    label: "test-map-questions.ts (extract + Paris=incorrect)",
    file: "scripts/test-map-questions.ts",
    retryFirst: false,
  },
] as const;

function runStep(file: string): { status: number | null; signal: string | null } {
  const result = spawnSync("npx", ["--yes", "tsx", file], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return { status: result.status, signal: result.signal };
}

function main() {
  const outcomes: Array<{ id: string; ok: boolean }> = [];

  for (const step of STEPS) {
    console.log(`\n======== LIVE BATCH: ${step.label} ========`);
    const { status, signal } = runStep(step.file);
    const ok = status === 0 && !signal;
    outcomes.push({ id: step.id, ok });
    if (!ok) {
      console.error(
        `\n[live-batch] ${step.id} stopped (status=${status} signal=${signal ?? "none"}).`,
      );
      if (step.retryFirst) {
        console.error(
          "[live-batch] Re-run this script when quota returns — text pipeline first, map second.",
        );
      } else {
        console.error(
          "[live-batch] Text pipeline already ran. Retry only: npx tsx scripts/test-map-questions.ts",
        );
      }
      break;
    }
  }

  console.log("\n======== LIVE BATCH SUMMARY ========");
  for (const row of outcomes) {
    console.log(`  ${row.id}: ${row.ok ? "ok" : "failed"}`);
  }
  if (outcomes.length < STEPS.length) {
    const skipped = STEPS.slice(outcomes.length);
    for (const step of skipped) {
      console.log(`  ${step.id}: skipped`);
    }
  }
  process.exit(outcomes.every((row) => row.ok) && outcomes.length === STEPS.length ? 0 : 1);
}

main();
