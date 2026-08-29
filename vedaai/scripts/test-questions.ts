import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractQuestionsFromPage } from "../lib/gemini";
import type { Question } from "../lib/types";
import { generatePhase2Fixtures } from "./generate-test-assets";

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
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function fileToDataUrl(filePath: string): string {
  const lower = filePath.toLowerCase();
  const mime =
    lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

function label(q: Question): string {
  return q.subPart ? `${q.displayNumber}(${q.subPart})` : q.displayNumber;
}

function looksLikeInstruction(q: Question): boolean {
  const t = `${q.displayNumber} ${q.text}`.toLowerCase();
  return (
    /answer any \d/.test(t) ||
    /answer all questions/.test(t) ||
    /time allowed/.test(t) ||
    /maximum marks/.test(t) ||
    /do not write/.test(t) ||
    /^section\s+[a-z]/.test(q.displayNumber.toLowerCase()) ||
    /^section\s+[a-z]/.test(q.text.toLowerCase())
  );
}

function normalizeAlt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/^q/i, "").trim();
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }

  generatePhase2Fixtures();

  const page1Path = resolve(ASSETS, "sample-qp-page1.png");
  const page2Path = resolve(ASSETS, "sample-qp-page2.png");
  const instructionsPath = resolve(ASSETS, "sample-qp-instructions-only.png");

  console.log("[test-questions] Extracting page 1…");
  const page1 = await extractQuestionsFromPage(fileToDataUrl(page1Path), 1);
  console.log("[test-questions] Extracting page 2…");
  const page2 = await extractQuestionsFromPage(fileToDataUrl(page2Path), 2);
  console.log("[test-questions] Extracting instructions-only adversarial page…");
  const instructions = await extractQuestionsFromPage(
    fileToDataUrl(instructionsPath),
    1,
  );

  const combined = [...page1, ...page2];
  const outPath = resolve(ASSETS, "output-questions.json");
  writeFileSync(
    outPath,
    JSON.stringify({ page1, page2, instructionsOnly: instructions }, null, 2),
  );

  console.log("\n=== PAGE 1 JSON ===");
  console.log(JSON.stringify(page1, null, 2));
  console.log("\n=== PAGE 2 JSON ===");
  console.log(JSON.stringify(page2, null, 2));
  console.log("\n=== INSTRUCTIONS-ONLY JSON ===");
  console.log(JSON.stringify(instructions, null, 2));

  const HAND_COUNT_PAGE1 = 7;
  const HAND_COUNT_PAGE2 = 3;
  const HAND_COUNT_TOTAL = 10;

  console.log("\n=== GATE CHECKS ===");
  console.log(
    `count page1=${page1.length} (hand ${HAND_COUNT_PAGE1})  page2=${page2.length} (hand ${HAND_COUNT_PAGE2})  total=${combined.length} (hand ${HAND_COUNT_TOTAL})`,
  );
  console.log(
    "order:",
    combined.map((q) => `p${q.page}:${label(q)}`).join(" → "),
  );

  const q11a = page1.find(
    (q) => q.displayNumber === "11" && (q.subPart ?? "").replace(/\s/g, "").toLowerCase().startsWith("a"),
  );
  const q11b = page2.find((q) => {
    const sub = (q.subPart ?? "").replace(/\s/g, "").toLowerCase();
    if (q.displayNumber === "11" && sub.startsWith("b")) return true;
    return sub === "b" || q.displayNumber.replace(/[()]/g, "").toLowerCase() === "b";
  });
  console.log(
    q11a && q11b
      ? `PASS split 11(a) page ${q11a.page} + 11(b) page ${q11b.page}`
      : `FAIL split sub-parts: 11a=${q11a ? label(q11a) : "missing"} 11b=${q11b ? label(q11b) : "missing"}`,
  );

  const nested = page1.filter(
    (q) =>
      q.displayNumber === "8" &&
      /a/i.test(q.subPart ?? "") &&
      (/\(i\)|\bi\b/i.test(q.subPart ?? "") ||
        /\(ii\)|\bii\b/i.test(q.subPart ?? "") ||
        /i|ii/.test((q.subPart ?? "").toLowerCase())),
  );
  const q8Entries = page1.filter((q) => q.displayNumber === "8");
  if (q8Entries.length >= 2) {
    console.log(
      `PASS nested not silently merged (${q8Entries.length} Q8 entries):`,
      q8Entries.map((q) => `${label(q)} subPart=${JSON.stringify(q.subPart)}`).join("; "),
    );
  } else if (q8Entries.length === 1) {
    console.log(
      `FAIL nested sub-sub-parts merged into one entry: ${JSON.stringify(q8Entries[0])}`,
    );
  } else {
    console.log("FAIL nested Q8(a)(i)/(ii) not found");
  }
  void nested;

  const q5 = combined.find((q) => q.displayNumber.replace(/^q/i, "") === "5");
  const q6 = combined.find((q) => q.displayNumber.replace(/^q/i, "") === "6");
  const alt5 = normalizeAlt(q5?.isAlternativeOf);
  const alt6 = normalizeAlt(q6?.isAlternativeOf);
  if (alt5 === "6" && alt6 === "5") {
    console.log("PASS OR-question links both ways (5↔6)");
  } else {
    console.log(
      `FAIL OR-question link: Q5.isAlternativeOf=${q5?.isAlternativeOf ?? "missing"} Q6.isAlternativeOf=${q6?.isAlternativeOf ?? "missing"}`,
    );
  }

  const headerHits = [
    ...combined.filter(looksLikeInstruction),
    ...instructions.filter(looksLikeInstruction),
  ];
  if (instructions.length === 0 && headerHits.length === 0) {
    console.log("PASS section-header / instruction lines not extracted");
  } else {
    console.log(
      `FAIL section-header false positives (${headerHits.length} on paper, ${instructions.length} on instructions-only page):`,
    );
    for (const q of [...headerHits, ...instructions]) {
      console.log(`  - [${label(q)}] ${q.text}`);
    }
  }

  const q2 = combined.find(
    (q) => q.displayNumber === "2" && q.page === 1,
  );
  const q3 = combined.find(
    (q) => q.displayNumber === "3" && q.page === 2,
  );
  console.log(
    q2 && q2.maxMarks === undefined
      ? "PASS Q2 maxMarks omitted (none printed)"
      : `FAIL Q2 maxMarks=${q2?.maxMarks ?? "missing Q2"} (wanted omitted/null)`,
  );
  console.log(
    q3 && q3.maxMarks === undefined
      ? "PASS Q3 maxMarks omitted (none printed)"
      : `FAIL Q3 maxMarks=${q3?.maxMarks ?? "missing Q3"} (wanted omitted/null)`,
  );

  const a1 = combined.find(
    (q) => q.displayNumber === "1" && q.page === 1,
  );
  const c1 = combined.find(
    (q) => q.displayNumber === "1" && q.page === 2,
  );
  if (a1 && c1 && a1.section && c1.section && a1.id !== c1.id) {
    console.log(
      `PASS duplicate Q1 distinguished by section (${a1.section} vs ${c1.section}); ids ${a1.id} / ${c1.id}`,
    );
  } else {
    console.log(
      `FAIL duplicate numbering: p1 Q1 section=${a1?.section} id=${a1?.id}; p2 Q1 section=${c1?.section} id=${c1?.id}`,
    );
  }

  const marksChecks: Array<[string, number | undefined]> = [
    ["1", 2],
    ["5", 5],
    ["6", 5],
    ["11a", 3],
    ["11b", 2],
  ];
  for (const [key, expected] of marksChecks) {
    const q =
      key === "11a"
        ? q11a
        : key === "11b"
          ? q11b
          : combined.find((item) => item.displayNumber === key);
    const ok = q?.maxMarks === expected;
    console.log(
      ok
        ? `PASS maxMarks ${key}=${expected}`
        : `FAIL maxMarks ${key} got ${q?.maxMarks ?? "missing"} wanted ${expected}`,
    );
  }

  console.log(`\n[test-questions] Full JSON written to ${outPath}`);
}

main().catch((error) => {
  console.error("[test-questions] Failed:", error);
  process.exit(1);
});
