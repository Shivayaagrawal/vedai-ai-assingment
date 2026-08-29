import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { generatePhase1Fixtures } from "./generate-test-assets";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  generatePhase1Fixtures();
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "log") logs.push(msg.text());
  });

  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.screenshot({
    path: resolve(ROOT, "test-assets/phase6-empty.png"),
    fullPage: true,
  });

  const startBtn = page.getByRole("button", { name: "Start Mapping" });
  if (await startBtn.isEnabled()) {
    throw new Error("Start Mapping should be disabled when empty");
  }

  const qp = page.locator('input[data-slot="question-paper"]');
  const ans = page.locator('input[data-slot="answer-sheet"]');

  await qp.setInputFiles({
    name: "essay.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("not a pdf"),
  });
  await page.waitForSelector("text=Use a PDF, PNG, or JPG file.");

  await qp.setInputFiles({
    name: "huge.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1),
  });
  await page.waitForSelector("text=File must be 10MB or smaller.");

  writeFileSync(
    resolve(ROOT, "test-assets/sample-corrupt.pdf"),
    Buffer.from("%PDF-1.1 truncated"),
  );
  await qp.setInputFiles(resolve(ROOT, "test-assets/sample-corrupt.pdf"));
  await page.waitForSelector("text=Couldn't read this file");

  await qp.setInputFiles(resolve(ROOT, "test-assets/sample-2page.pdf"));
  await page.waitForSelector("text=sample-2page.pdf");
  await page.waitForSelector("text=/2 Pages/");

  await qp.setInputFiles(resolve(ROOT, "test-assets/sample-clean.png"));
  await page.waitForSelector("text=sample-clean.png");
  await page.waitForSelector("text=1 Page");

  await page.locator('[data-remove="question-paper"]').click();
  await page.waitForSelector("text=Max 10MB");
  await qp.setInputFiles(resolve(ROOT, "test-assets/sample-2page.pdf"));
  await page.waitForSelector("text=sample-2page.pdf");

  await ans.setInputFiles(resolve(ROOT, "test-assets/sample-clean.png"));
  await page.waitForSelector("text=sample-clean.png");

  if (!(await startBtn.isEnabled())) {
    throw new Error("Start Mapping should enable when both files are present");
  }

  await page.screenshot({
    path: resolve(ROOT, "test-assets/phase6-filled.png"),
    fullPage: true,
  });

  await startBtn.click();
  await page.waitForTimeout(200);
  if (!logs.some((line) => line.includes("[upload] Start Mapping"))) {
    throw new Error("Start Mapping did not log files");
  }

  await page.locator('[data-remove="answer-sheet"]').click();
  if (await startBtn.isEnabled()) {
    throw new Error("Start Mapping should disable after removing one file");
  }

  await browser.close();
  console.log("[test-phase6] PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
