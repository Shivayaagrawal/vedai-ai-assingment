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

async function visibleHighlightTags(page: Page): Promise<string[]> {
  return page.locator("[data-highlight-tag]").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const el = node as HTMLElement;
        return el.offsetParent !== null && el.getBoundingClientRect().width > 0;
      })
      .map((node) => node.getAttribute("data-highlight-tag") ?? ""),
  );
}

async function clickQuestion(page: Page, text: string) {
  await page.getByRole("button").filter({ hasText: text }).first().click();
}

async function openDemo(page: Page, width: number, height = 812) {
  await page.setViewportSize({ width, height });
  await page.goto("http://localhost:3000/?demo=results", {
    waitUntil: "networkidle",
  });
  await page.getByText("Extracted Questions (from question paper)").waitFor();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  const failures: string[] = [];

  await openDemo(page, 375);
  if (await page.getByRole("tab", { name: "Questions" }).isHidden()) {
    failures.push("375px: Questions tab should be visible");
  }
  if (await page.getByRole("navigation").filter({ hasText: "My Classroom" }).count()) {
    const sidebar = page.locator("aside").filter({ hasText: "My Classroom" }).first();
    if (await sidebar.isVisible()) {
      failures.push("375px: desktop sidebar should be hidden");
    }
  }
  await page.screenshot({ path: resolve(OUT, "phase9-375-questions.png") });

  await clickQuestion(page, "This question was not answered");
  await page.getByText("No answer found for this question").waitFor();
  await page.getByRole("tab", { name: "Questions" }).click();
  await page.getByText("This question was not answered").waitFor();
  await page.getByRole("tab", { name: "Answer Sheet" }).click();
  await page.getByText("No answer found for this question").waitFor();
  const unansweredTags = await visibleHighlightTags(page);
  if (unansweredTags.includes("Q3")) {
    failures.push("Q3 unanswered should not draw a Q3 highlight");
  }

  await page.getByRole("tab", { name: "Questions" }).click();
  await clickQuestion(page, "Name the organelle");
  await page.locator("[data-highlight-tag='Q2']").waitFor();
  if (!(await visibleHighlightTags(page)).includes("Q2")) {
    failures.push("tapping Q2 should switch to Answer Sheet with Q2 highlight");
  }
  await page.getByRole("tab", { name: "Questions" }).click();
  await page.getByRole("tab", { name: "Answer Sheet" }).click();
  if (!(await visibleHighlightTags(page)).includes("Q2")) {
    failures.push("tab switch did not preserve Q2 highlight");
  }
  await page.screenshot({ path: resolve(OUT, "phase9-375-answers.png") });

  await page.getByRole("tab", { name: "Questions" }).click();
  await clickQuestion(page, "An answer that spans two pages.");
  await page.getByText("continues on page 2").waitFor();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByText("continues on page 1").waitFor();
  if (!(await visibleHighlightTags(page)).includes("Q8")) {
    failures.push("mobile multi-page paging lost Q8 highlight");
  }

  const box100 = await page.locator("[data-highlight-tag='Q8']").boundingBox();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByText("50%").waitFor();
  const box50 = await page.locator("[data-highlight-tag='Q8']").boundingBox();
  if (!box100 || !box50) {
    failures.push("50% zoom missing Q8 highlight");
  } else {
    const ratio = box50.width / box100.width;
    if (ratio < 0.45 || ratio > 0.55) {
      failures.push(`50% zoom box width ratio ${ratio} not ~0.5`);
    }
  }

  await page.getByRole("tab", { name: "Questions" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByText("My Classroom").waitFor();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "Close menu" }).click();
  if (await page.getByRole("dialog", { name: "Navigation" }).isVisible()) {
    failures.push("hamburger drawer did not close");
  }
  if (await page.getByRole("tab", { name: "Questions" }).getAttribute("aria-selected") !== "true") {
    failures.push("closing drawer changed the active tab");
  }

  await page.route("**/api/grade", async (route) => {
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
            feedback: "Excellent work! You correctly identified the chloroplast.",
          },
        ],
        skipped: [],
      }),
    });
  });
  await page.getByRole("button", { name: "Grade all answers" }).click();
  await page.getByText("2/2").waitFor({ timeout: 5000 });

  await page.getByText(
    "This is a deliberately long question stem so the card can demonstrate",
  ).waitFor();
  const longCard = page.getByRole("button").filter({
    hasText: "This is a deliberately long question stem",
  });
  const showMore = longCard.getByText("Show more", { exact: true });
  if (!(await showMore.isVisible())) {
    failures.push("375px: long question should show Show more");
  }

  await openDemo(page, 414);
  if (await page.getByRole("tab", { name: "Answer Sheet" }).isHidden()) {
    failures.push("414px: tab switcher should be visible");
  }

  await openDemo(page, 768, 1024);
  await page.getByText("Extracted Questions (from question paper)").waitFor();
  if (await page.getByRole("tab", { name: "Questions" }).isVisible()) {
    failures.push("768px: should use desktop two-pane, not tab switcher");
  }
  await clickQuestion(page, "Name the organelle");
  if (!(await highlightTags(page)).includes("Q2")) {
    failures.push("768px desktop pane: Q2 highlight missing");
  }

  await openDemo(page, 834, 1112);
  if (await page.getByRole("tab", { name: "Questions" }).isVisible()) {
    failures.push("834px: should stay on desktop two-pane");
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 767, height: 1024 });
  await page.getByRole("tab", { name: "Questions" }).waitFor();
  await page.setViewportSize({ width: 768, height: 1024 });
  if (await page.getByRole("tab", { name: "Questions" }).isVisible()) {
    failures.push("crossing 768px did not settle on desktop layout");
  }

  await browser.close();

  if (failures.length) {
    console.error(failures.map((item) => `FAIL ${item}`).join("\n"));
    process.exit(1);
  }
  console.log("PASS phase 9 mobile layout");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
