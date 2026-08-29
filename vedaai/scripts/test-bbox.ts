import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAnswersFromPage } from "../lib/gemini";
import type { Answer } from "../lib/types";
import { generatePhase1Fixtures } from "./generate-test-assets";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_PATH = resolve(ROOT, "test-assets/sample-answer-page.png");
const OUTPUT_PATH = resolve(ROOT, "test-assets/output-with-boxes.png");

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

function mimeTypeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function drawBoxes(imagePath: string, answers: Answer[]): Promise<boolean> {
  try {
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
        const label = raw
          ? /^q/i.test(raw)
            ? raw
            : `Q${raw}`
          : "Q?";

        ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
        ctx.fillRect(x, y, width, height);

        ctx.strokeStyle = "#22C55E";
        ctx.lineWidth = Math.max(3, image.width / 400);
        ctx.strokeRect(x, y, width, height);

        ctx.font = `${Math.max(16, image.width / 50)}px sans-serif`;
        const tagPaddingX = 8;
        const tagPaddingY = 4;
        const metrics = ctx.measureText(label);
        const tagWidth = metrics.width + tagPaddingX * 2;
        const tagHeight = Math.max(22, image.width / 45);

        ctx.fillStyle = "#22C55E";
        ctx.fillRect(x, y, tagWidth, tagHeight);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, x + tagPaddingX, y + tagHeight - tagPaddingY - 2);
      }
    }

    writeFileSync(OUTPUT_PATH, canvas.toBuffer("image/png"));
    return true;
  } catch (error) {
    console.warn(
      "[test-bbox] Could not draw annotated image (canvas unavailable). Logging JSON only.",
    );
    console.warn(error instanceof Error ? error.message : error);
    return false;
  }
}

async function main() {
  loadEnvFiles();

  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is missing. Copy .env.example to .env.local and add your key.",
    );
  }

  if (!existsSync(SAMPLE_PATH)) {
    generatePhase1Fixtures();
  }

  const imageBuffer = readFileSync(SAMPLE_PATH);
  const imageBase64 = `data:${mimeTypeFromPath(SAMPLE_PATH)};base64,${imageBuffer.toString("base64")}`;

  console.log("[test-bbox] Calling extractAnswersFromPage…");
  const answers = await extractAnswersFromPage(imageBase64, 1);

  console.log(`[test-bbox] Detected ${answers.length} answer region(s):`);
  console.log(JSON.stringify(answers, null, 2));

  const drew = await drawBoxes(SAMPLE_PATH, answers);
  if (drew) {
    console.log(`[test-bbox] Annotated image written to ${OUTPUT_PATH}`);
  }
}

main().catch((error) => {
  console.error("[test-bbox] Failed:", error);
  process.exit(1);
});
