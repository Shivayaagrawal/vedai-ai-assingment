import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstRegionPage,
  highlightTagForQuestion,
  highlightTagForUnmatched,
  otherRegionPages,
  pixelBoxesForPage,
  regionsOnPage,
  scaleNormalizedBox,
} from "./highlight-geometry";
import type { Answer, Question } from "./types";

describe("scaleNormalizedBox", () => {
  it("maps 0-1 fractions through natural→displayed scale", () => {
    const box = scaleNormalizedBox(
      { x: 0.1, y: 0.2, width: 0.5, height: 0.25 },
      1000,
      2000,
      500,
      800,
    );
    assert.equal(box.left, 50);
    assert.equal(box.top, 160);
    assert.equal(box.width, 250);
    assert.equal(box.height, 200);
  });

  it("stays linear at 50% zoom without integer rounding drift", () => {
    const region = { x: 1 / 3, y: 0.2, width: 0.4, height: 0.25 };
    const at100 = scaleNormalizedBox(region, 1000, 2000, 1000, 2000);
    const at50 = scaleNormalizedBox(region, 1000, 2000, 500, 1000);
    assert.equal(at50.left * 2, at100.left);
    assert.equal(at50.top * 2, at100.top);
    assert.equal(at50.width * 2, at100.width);
    assert.equal(at50.height * 2, at100.height);
  });
});

describe("multi-page regions", () => {
  const regions = [
    { page: 1, x: 0.1, y: 0.8, width: 0.8, height: 0.15 },
    { page: 2, x: 0.1, y: 0.05, width: 0.8, height: 0.2 },
  ];

  it("keeps only the current page's boxes", () => {
    const page1 = pixelBoxesForPage(regions, 1, "Q8", 100, 100, 100, 100);
    const page2 = pixelBoxesForPage(regions, 2, "Q8", 100, 100, 100, 100);
    assert.equal(page1.length, 1);
    assert.equal(page2.length, 1);
    assert.equal(page1[0].top, 80);
    assert.equal(page2[0].top, 5);
  });

  it("lists continuation pages without requiring a re-click", () => {
    assert.deepEqual(otherRegionPages(regions, 1), [2]);
    assert.deepEqual(otherRegionPages(regions, 2), [1]);
    assert.equal(firstRegionPage(regions), 1);
    assert.equal(regionsOnPage(regions, 3).length, 0);
  });
});

describe("highlight tags", () => {
  it("renders Q + number + sub-part", () => {
    const question: Question = {
      id: "q11b",
      displayNumber: "11",
      subPart: "b",
      text: "Explain",
      page: 2,
    };
    assert.equal(highlightTagForQuestion(question), "Q11b");
  });

  it("falls back cleanly when unmatched has no detected number", () => {
    const unlabeled: Answer = {
      id: "a-x",
      detectedQuestionNumber: null,
      text: "stray",
      regions: [{ page: 1, x: 0, y: 0, width: 0.2, height: 0.1 }],
      confidence: 0.4,
    };
    assert.equal(highlightTagForUnmatched(unlabeled), "Q?");
    assert.equal(
      highlightTagForUnmatched({ ...unlabeled, detectedQuestionNumber: "  " }),
      "Q?",
    );
  });
});
