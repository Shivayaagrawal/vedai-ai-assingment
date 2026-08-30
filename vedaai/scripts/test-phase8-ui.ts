import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "test-assets");

async function highlightTags(page: Page): Promise<string[]> {
  return page.locator("[data-highlight-tag]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-highlight-tag") ?? ""),
  );
}

async function clickQuestion(page: Page, text: string) {
  await page.getByRole("button").filter({ hasText: text }).first().click();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://localhost:3000/?demo=results", {
    waitUntil: "networkidle",
  });
  await page.getByText("Extracted Questions (from question paper)").waitFor();

  const failures: string[] = [];

  await clickQuestion(page, "Define osmosis.");
  await page.waitForTimeout(200);
  if (!(await highlightTags(page)).includes("Q1")) {
    failures.push("Q1 click did not activate Q1 highlight");
  }

  await clickQuestion(page, "Name the organelle");
  await page.waitForTimeout(200);
  const q2 = await highlightTags(page);
  if (!q2.includes("Q2") || !q2.includes("Q1")) {
    failures.push(`page should keep all grade boxes, got ${JSON.stringify(q2)}`);
  }
  if ((await page.locator("[data-highlight-emphasized='true']").count()) < 1) {
    failures.push("selected question should emphasize its answer box");
  }
  await page.screenshot({ path: resolve(OUT, "phase8-q2.png") });

  await clickQuestion(page, "This question was not answered");
  await page.waitForTimeout(200);
  if ((await page.getByText("AI Feedback").count()) > 0) {
    failures.push("clicking a question should not expand the card");
  }
  if (!(await highlightTags(page)).includes("Q1")) {
    failures.push("unanswered question should still show other grade boxes");
  }

  await clickQuestion(page, "An answer that spans two pages.");
  await page.getByText("continues on page 2").waitFor();
  const page1Tags = await highlightTags(page);
  if (!page1Tags.includes("Q8")) {
    failures.push("Q8 highlight missing on page 1");
  }
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByText("continues on page 1").waitFor();
  const page2Tags = await highlightTags(page);
  if (!page2Tags.includes("Q8")) {
    failures.push("Q8 highlight missing on page 2 after paging (should not need re-click)");
  }
  await page.getByRole("button", { name: "Previous page" }).click();

  await clickQuestion(page, "State the function of mitochondria.");
  await page.waitForTimeout(200);
  if (!(await highlightTags(page)).includes("Q11a")) {
    failures.push("11a should highlight Q11a");
  }
  await clickQuestion(page, "State the function of the nucleus.");
  await page.waitForTimeout(200);
  if (!(await highlightTags(page)).includes("Q11b")) {
    failures.push("11b should highlight Q11b");
  }

  await page.getByRole("button", { name: "Expand All" }).click();
  const feedbackCount = await page.getByText("AI Feedback").count();
  if (feedbackCount < 10) {
    failures.push(`Expand All should open every card, got ${feedbackCount} panels`);
  }
  await page.getByRole("button", { name: "Expand All" }).click();
  const afterCollapse = await page.getByText("AI Feedback").count();
  if (afterCollapse !== 0) {
    failures.push(`second Expand All click should collapse all, got ${afterCollapse}`);
  }

  await page.getByRole("button", { name: /Unmatched answer \(unlabeled\)/ }).click();
  await page.waitForTimeout(200);
  if (!(await highlightTags(page)).includes("Q?")) {
    failures.push("unlabeled unmatched should highlight as Q? without printing null");
  }

  await page.getByRole("button", { name: /detected as Q99/ }).click();
  await page.waitForTimeout(200);
  if (!(await highlightTags(page)).includes("Q99")) {
    failures.push("Q99 unmatched should highlight Q99");
  }

  await clickQuestion(page, "Name the organelle");
  const boxBefore = await page.locator("[data-highlight-tag='Q2']").boundingBox();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(200);
  const boxAfter = await page.locator("[data-highlight-tag='Q2']").boundingBox();
  if (!boxBefore || !boxAfter) {
    failures.push("Q2 highlight missing around zoom");
  } else if (Math.abs(boxAfter.width - boxBefore.width) < 1) {
    failures.push("zoom in did not rescale the highlight box");
  }

  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(300);
  const boxResized = await page.locator("[data-highlight-tag='Q2']").boundingBox();
  if (!boxResized) {
    failures.push("highlight disappeared after resize");
  }

  await page.getByRole("button", { name: "Grade all answers" }).waitFor();
  await page.route("**/api/grade", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        grades: [
          {
            questionId: "q2",
            score: 2,
            maxScore: 2,
            verdict: "correct",
            feedback:
              "Excellent work! You correctly identified the chloroplast.",
          },
        ],
        skipped: [],
      }),
    });
  });
  await page.getByRole("button", { name: "Grade all answers" }).click();
  await clickQuestion(page, "Define osmosis.");
  await page.waitForTimeout(200);
  if (!(await highlightTags(page)).includes("Q1")) {
    failures.push("clicking a card while grading is in flight lost the highlight");
  }
  await page.getByText("2/2").waitFor({ timeout: 5000 });
  if (!(await highlightTags(page)).includes("Q1")) {
    failures.push("grading response disturbed the selected highlight");
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await clickQuestion(page, "Name the organelle");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: resolve(OUT, "phase8-desktop.png"),
    fullPage: false,
  });

  await browser.close();

  if (errors.length) {
    console.error("page errors:\n", errors.join("\n"));
  }
  if (failures.length) {
    console.error(failures.map((item) => `FAIL ${item}`).join("\n"));
    process.exit(1);
  }
  console.log("PASS phase 8 UI edge cases");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
