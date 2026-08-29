import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAnswersFromPage,
  GeminiRateLimitError,
  isGeminiRateLimitError,
} from "../lib/gemini";
import type { Answer } from "../lib/types";
import { generatePhase1Fixtures } from "./generate-test-assets";

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
  const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
    ? "image/jpeg"
    : lower.endsWith(".webp")
      ? "image/webp"
      : "image/png";
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

async function drawBoxes(imagePath: string, answers: Answer[], outName: string) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  for (const answer of answers) {
    for (const region of answer.regions) {
      const x = region.x * image.width;
      const y = region.y * image.height;
      const width = region.width * image.width;
      const height = region.height * image.height;
      const raw = answer.detectedQuestionNumber;
      const label = raw ? (/^q/i.test(raw) ? raw : `Q${raw}`) : "Q?";

      ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#22C55E";
      ctx.lineWidth = Math.max(3, image.width / 400);
      ctx.strokeRect(x, y, width, height);

      ctx.font = `${Math.max(16, image.width / 50)}px sans-serif`;
      const tagPaddingX = 8;
      const metrics = ctx.measureText(label);
      const tagWidth = metrics.width + tagPaddingX * 2;
      const tagHeight = Math.max(22, image.width / 45);
      ctx.fillStyle = "#22C55E";
      ctx.fillRect(x, y, tagWidth, tagHeight);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, x + tagPaddingX, y + tagHeight - 6);
    }
  }

  const outPath = resolve(ASSETS, outName);
  writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

type CaseResult = {
  name: string;
  count: number;
  confidences: number[];
  numbers: Array<string | null>;
  emptyTexts: number;
  crossedOut: number;
  threw: boolean;
  error?: string;
  notes: string[];
};

async function runCase(
  name: string,
  fileName: string,
  outName: string,
): Promise<CaseResult> {
  const imagePath = resolve(ASSETS, fileName);
  const notes: string[] = [];
  try {
    const answers = await extractAnswersFromPage(fileToDataUrl(imagePath), 1);
    await drawBoxes(imagePath, answers, outName);
    notes.push(`wrote ${outName}`);
    return {
      name,
      count: answers.length,
      confidences: answers.map((a) => a.confidence),
      numbers: answers.map((a) => a.detectedQuestionNumber),
      emptyTexts: answers.filter((a) => a.text === "").length,
      crossedOut: answers.filter((a) => a.isCrossedOut).length,
      threw: false,
      notes,
    };
  } catch (error) {
    return {
      name,
      count: 0,
      confidences: [],
      numbers: [],
      emptyTexts: 0,
      crossedOut: 0,
      threw: true,
      error: error instanceof Error ? error.message : String(error),
      notes,
    };
  }
}

async function testRateLimit(): Promise<string> {
  const synthetic = isGeminiRateLimitError(
    new Error("429 Too Many Requests RESOURCE_EXHAUSTED"),
  );
  const blank = resolve(ASSETS, "sample-blank.png");
  const payload = fileToDataUrl(blank);

  let hitLive = false;
  try {
    await Promise.all(
      Array.from({ length: 8 }, () => extractAnswersFromPage(payload, 1)),
    );
  } catch (error) {
    if (error instanceof GeminiRateLimitError || isGeminiRateLimitError(error)) {
      hitLive = true;
      return `synthetic handler=${synthetic}; live burst HIT GeminiRateLimitError`;
    }
    return `synthetic handler=${synthetic}; live burst failed with non-429: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  return `synthetic handler=${synthetic}; live burst did not 429 (free-tier quota not exhausted this run). hitLive=${hitLive}`;
}

async function main() {
  loadEnvFiles();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env.local");
  }

  generatePhase1Fixtures();
  console.log("[test-phase1] fixtures written");

  const specs = [
    {
      name: "clean (style 1)",
      file: "sample-clean.png",
      out: "output-clean-with-boxes.png",
    },
    {
      name: "messy (style 2)",
      file: "sample-messy.png",
      out: "output-messy-with-boxes.png",
    },
    {
      name: "unlabeled (style 3)",
      file: "sample-unlabeled.png",
      out: "output-unlabeled-with-boxes.png",
    },
    {
      name: "diagram-only",
      file: "sample-diagram.png",
      out: "output-diagram-with-boxes.png",
    },
    {
      name: "crossed-out",
      file: "sample-crossed-out.png",
      out: "output-crossed-out-with-boxes.png",
    },
    {
      name: "blank page",
      file: "sample-blank.png",
      out: "output-blank-with-boxes.png",
    },
    {
      name: "large 3000x4000",
      file: "sample-large.png",
      out: "output-large-with-boxes.png",
    },
    {
      name: "skewed/rotated",
      file: "sample-skewed.png",
      out: "output-skewed-with-boxes.png",
    },
  ] as const;

  // Sequential to reduce 429s during the accuracy pass.
  const results: CaseResult[] = [];
  for (const spec of specs) {
    const result = await runCase(spec.name, spec.file, spec.out);
    results.push(result);
    console.log(
      `[test-phase1] ${result.name}: count=${result.count} conf=${JSON.stringify(
        result.confidences,
      )} numbers=${JSON.stringify(result.numbers)} emptyText=${result.emptyTexts} crossedOut=${result.crossedOut}${
        result.threw ? ` THREW ${result.error}` : ""
      }`,
    );
  }

  console.log("[test-phase1] rate-limit check…");
  const rateLimitNote = await testRateLimit();
  console.log("[test-phase1]", rateLimitNote);

  const allConf = results.flatMap((r) => r.confidences);
  const uniqueConf = Array.from(new Set(allConf.map((c) => c.toFixed(2))));
  console.log("[test-phase1] unique confidence values:", uniqueConf.join(", ") || "(none)");
  if (uniqueConf.length <= 1 && allConf.length > 1) {
    console.log(
      "[test-phase1] NOTE: confidence looks constant — do not rely on it for low-confidence mapping in Phase 4.",
    );
  }

  const blank = results.find((r) => r.name.startsWith("blank"));
  if (blank && !blank.threw && blank.count === 0) {
    console.log("[test-phase1] blank page: graceful []");
  } else if (blank?.threw) {
    console.log("[test-phase1] blank page CRASHED — must fix before Phase 2");
  } else {
    console.log(
      `[test-phase1] blank page returned ${blank?.count ?? "?"} region(s) (wanted [])`,
    );
  }

  const cleanOut = resolve(ASSETS, "output-clean-with-boxes.png");
  const canonicalOut = resolve(ASSETS, "output-with-boxes.png");
  if (existsSync(cleanOut)) {
    copyFileSync(cleanOut, canonicalOut);
  }
}

main().catch((error) => {
  console.error("[test-phase1] Failed:", error);
  process.exit(1);
});
