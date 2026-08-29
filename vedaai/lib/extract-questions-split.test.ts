import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { describe, it } from "node:test";
import {
  BOTTOM_HALF,
  TOP_HALF,
  countExpectedInBand,
  cropPageHalf,
  extractQuestionsFromFullPage,
  isHalfComplete,
  looksLikeQuestionLabel,
  mergeQuestionHalves,
} from "./extract-questions-split";
import type { Question } from "./types";

function question(
  partial: Partial<Question> & Pick<Question, "id" | "displayNumber">,
): Question {
  return {
    text: partial.text ?? `Question ${partial.displayNumber}`,
    page: partial.page ?? 2,
    ...partial,
  };
}

function solidPageJpeg(): string {
  const canvas = createCanvas(40, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 40, 200);
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, 40, 20);
  const jpeg = canvas.toBuffer("image/jpeg", 85);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

describe("looksLikeQuestionLabel", () => {
  it("counts numbered and parenthetical labels, not section headers", () => {
    assert.equal(looksLikeQuestionLabel("1. Name the powerhouse"), true);
    assert.equal(looksLikeQuestionLabel("(b) Calculate the heat"), true);
    assert.equal(looksLikeQuestionLabel("(a i) What is the pH"), true);
    assert.equal(looksLikeQuestionLabel("SECTION B — BIOLOGY"), false);
    assert.equal(looksLikeQuestionLabel("Time allowed: 2 hours"), false);
  });
});

describe("countExpectedInBand / isHalfComplete", () => {
  const items = [
    { text: "(b) Calculate heat", y: 0.02 },
    { text: "SECTION B — BIOLOGY", y: 0.08 },
    { text: "1. Powerhouse", y: 0.12 },
    { text: "2. Photosynthesis", y: 0.18 },
    { text: "9. Plant vs animal", y: 0.24 },
    { text: "10. Fe2O3", y: 0.3 },
    { text: "11. Acids", y: 0.36 },
    { text: "(a i) pH", y: 0.4 },
    { text: "(a ii) stomach", y: 0.44 },
    { text: "(b) molten salt", y: 0.48 },
    { text: "12. Digestive system", y: 0.52 },
  ];

  it("assigns dense page-2 labels to the overlapping halves", () => {
    const top = countExpectedInBand(items, TOP_HALF.y0, TOP_HALF.y1);
    const bottom = countExpectedInBand(items, BOTTOM_HALF.y0, BOTTOM_HALF.y1);
    assert.equal(top, 10);
    assert.ok(bottom >= 2);
    assert.ok(bottom < top);
  });

  it("treats a one-item miss as complete and a large miss as not", () => {
    assert.equal(isHalfComplete(9, 10), true);
    assert.equal(isHalfComplete(4, 10), false);
    assert.equal(isHalfComplete(0, 0), true);
    assert.equal(isHalfComplete(0, 1), false);
  });
});

describe("mergeQuestionHalves", () => {
  it("dedupes on displayNumber+subPart and keeps the richer text/marks", () => {
    const top = [
      question({
        id: "short-9",
        displayNumber: "9",
        text: "List two differences",
      }),
      question({
        id: "q10",
        displayNumber: "10",
        text: "Balance Fe + O2",
        maxMarks: 3,
      }),
    ];
    const bottom = [
      question({
        id: "long-9",
        displayNumber: "9",
        text: "List two differences between plant cells and animal cells.",
        maxMarks: 4,
      }),
      question({
        id: "q12",
        displayNumber: "12",
        text: "Draw a labelled diagram of the human digestive system.",
      }),
    ];
    const merged = mergeQuestionHalves(top, bottom);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].id, "long-9");
    assert.equal(merged[0].maxMarks, 4);
    assert.equal(merged[1].id, "q10");
    assert.equal(merged[2].id, "q12");
  });

  it("does not collapse 8(b) continuation into 11(b)", () => {
    const merged = mergeQuestionHalves(
      [
        question({
          id: "cont-b",
          displayNumber: "(b)",
          subPart: "b",
          text: "Calculate the heat required",
        }),
      ],
      [
        question({
          id: "11b",
          displayNumber: "11",
          subPart: "b",
          text: "Explain molten sodium chloride",
        }),
      ],
    );
    assert.equal(merged.length, 2);
  });
});

describe("cropPageHalf", () => {
  it("keeps overlap height rather than a 50/50 cut", async () => {
    const page = solidPageJpeg();
    const top = await cropPageHalf(page, TOP_HALF.y0, TOP_HALF.y1);
    const bottom = await cropPageHalf(page, BOTTOM_HALF.y0, BOTTOM_HALF.y1);
    const { loadImage } = await import("@napi-rs/canvas");
    const topImg = await loadImage(
      Buffer.from(top.replace(/^data:image\/\w+;base64,/, ""), "base64"),
    );
    const bottomImg = await loadImage(
      Buffer.from(bottom.replace(/^data:image\/\w+;base64,/, ""), "base64"),
    );
    assert.equal(topImg.height, 120);
    assert.equal(bottomImg.height, 110);
  });
});

describe("extractQuestionsFromFullPage", () => {
  it("retries a short half once, then merges", async () => {
    const calls: string[] = [];
    const page = {
      pageNumber: 2,
      imageBase64: solidPageJpeg(),
      textItems: [
        { text: "1. One", y: 0.1 },
        { text: "2. Two", y: 0.2 },
        { text: "9. Nine", y: 0.25 },
        { text: "12. Twelve", y: 0.5 },
      ],
    };

    const extracted = await extractQuestionsFromFullPage(page, async () => {
      calls.push("call");
      if (calls.length === 1) {
        return [question({ id: "only-12", displayNumber: "12", text: "Draw" })];
      }
      if (calls.length === 2) {
        return [
          question({ id: "q1", displayNumber: "1", text: "One" }),
          question({ id: "q2", displayNumber: "2", text: "Two" }),
          question({ id: "q9", displayNumber: "9", text: "Nine" }),
          question({ id: "q12a", displayNumber: "12", text: "Draw a labelled diagram" }),
        ];
      }
      return [
        question({
          id: "q12b",
          displayNumber: "12",
          text: "Draw a labelled diagram of the human digestive system.",
        }),
      ];
    });

    assert.ok(calls.length >= 3);
    assert.equal(extracted.length, 4);
    const twelve = extracted.find((item) => item.displayNumber === "12");
    assert.ok(twelve);
    assert.ok(twelve.text.length > 10);
  });
});
