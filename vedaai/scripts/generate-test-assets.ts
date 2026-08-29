import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ASSETS_DIR = resolve(ROOT, "test-assets");

const PAGE_W = 1240;
const PAGE_H = 1754;

function linedPaper(ctx: SKRSContext2D, width: number, height: number) {
  ctx.fillStyle = "#f7f4ea";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#e9e2cf";
  ctx.fillRect(0, 0, 88, height);
  ctx.strokeStyle = "#d9c9a3";
  ctx.lineWidth = 1;
  for (let y = 72; y < height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#e8a0a0";
  ctx.beginPath();
  ctx.moveTo(96, 0);
  ctx.lineTo(96, height);
  ctx.stroke();
}

function writeInk(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  extra?: { rotate?: number },
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  if (extra?.rotate) {
    ctx.translate(x, y);
    ctx.rotate(extra.rotate);
    ctx.fillText(text, 0, 0);
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function strikeThrough(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x, y + 8 + i * (height / 6));
    ctx.lineTo(x + width, y + i * (height / 6));
    ctx.stroke();
  }
  ctx.restore();
}

function drawTriangleDiagram(ctx: SKRSContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = "#1a365d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 160, y);
  ctx.lineTo(x + 320, y + 200);
  ctx.lineTo(x, y + 200);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 160, y);
  ctx.lineTo(x + 160, y + 200);
  ctx.stroke();
  ctx.restore();
}

function save(name: string, canvas: Canvas) {
  const path = resolve(ASSETS_DIR, name);
  writeFileSync(path, canvas.toBuffer("image/png"));
  return path;
}

export function generatePhase1Fixtures() {
  mkdirSync(ASSETS_DIR, { recursive: true });

  const clean = createCanvas(PAGE_W, PAGE_H);
  const c1 = clean.getContext("2d");
  linedPaper(c1, PAGE_W, PAGE_H);
  writeInk(c1, "1.", 40, 130, "italic 28px Georgia", "#1a365d");
  writeInk(
    c1,
    "Force = mass x acceleration.  F = 5 x 2 = 10 N",
    120,
    130,
    "italic 28px Georgia",
    "#1a365d",
  );
  writeInk(c1, "2.", 40, 280, "italic 28px Georgia", "#1a365d");
  writeInk(
    c1,
    "Photosynthesis converts light energy into chemical energy.",
    120,
    280,
    "italic 28px Georgia",
    "#1a365d",
  );
  writeInk(c1, "3(a).", 30, 430, "italic 26px Georgia", "#1a365d");
  writeInk(
    c1,
    "The boiling point of water is 100 C at 1 atm.",
    120,
    430,
    "italic 28px Georgia",
    "#1a365d",
  );
  save("sample-clean.png", clean);
  save("sample-answer-page.png", clean);

  const messy = createCanvas(PAGE_W, PAGE_H);
  const c2 = messy.getContext("2d");
  linedPaper(c2, PAGE_W, PAGE_H);
  writeInk(c2, "Q4", 36, 140, "28px Courier New", "#111827", {
    rotate: -0.04,
  });
  writeInk(
    c2,
    "kinetic energy = 1/2 mv^2   = 0.5 * 4 * 9 = 18 J",
    130,
    155,
    "26px Courier New",
    "#111827",
    { rotate: 0.03 },
  );
  writeInk(c2, "5", 48, 310, "32px Courier New", "#1f2937", { rotate: 0.08 });
  writeInk(
    c2,
    "osmosis is movement of water from high to low water pot.",
    130,
    330,
    "24px Courier New",
    "#1f2937",
    { rotate: -0.05 },
  );
  writeInk(c2, "6b", 40, 500, "30px Courier New", "#111827");
  writeInk(
    c2,
    "I think the answer is mitochondria but not sure??",
    130,
    510,
    "25px Courier New",
    "#111827",
    { rotate: 0.06 },
  );
  save("sample-messy.png", messy);

  const unlabeled = createCanvas(PAGE_W, PAGE_H);
  const c3 = unlabeled.getContext("2d");
  linedPaper(c3, PAGE_W, PAGE_H);
  writeInk(
    c3,
    "Newton's third law: every action has an equal opposite reaction.",
    120,
    160,
    "italic 27px Georgia",
    "#1e3a5f",
  );
  writeInk(
    c3,
    "H2 + Cl2 -> 2HCl   (this is a synthesis reaction)",
    120,
    320,
    "italic 27px Georgia",
    "#1e3a5f",
  );
  writeInk(
    c3,
    "The mitochondria is the powerhouse of the cell.",
    120,
    480,
    "italic 27px Georgia",
    "#1e3a5f",
  );
  save("sample-unlabeled.png", unlabeled);

  const diagram = createCanvas(PAGE_W, PAGE_H);
  const c4 = diagram.getContext("2d");
  linedPaper(c4, PAGE_W, PAGE_H);
  writeInk(c4, "8.", 40, 140, "italic 28px Georgia", "#1a365d");
  drawTriangleDiagram(c4, 220, 180);
  save("sample-diagram.png", diagram);

  const crossed = createCanvas(PAGE_W, PAGE_H);
  const c5 = crossed.getContext("2d");
  linedPaper(c5, PAGE_W, PAGE_H);
  writeInk(c5, "9.", 40, 140, "italic 28px Georgia", "#1a365d");
  writeInk(
    c5,
    "The capital of France is London.",
    120,
    140,
    "italic 28px Georgia",
    "#1a365d",
  );
  strikeThrough(c5, 110, 108, 620, 44);
  writeInk(c5, "10.", 40, 290, "italic 28px Georgia", "#1a365d");
  writeInk(
    c5,
    "The capital of France is Paris.",
    120,
    290,
    "italic 28px Georgia",
    "#1a365d",
  );
  save("sample-crossed-out.png", crossed);

  const blank = createCanvas(PAGE_W, PAGE_H);
  const c6 = blank.getContext("2d");
  linedPaper(c6, PAGE_W, PAGE_H);
  save("sample-blank.png", blank);

  const notPaper = createCanvas(PAGE_W, PAGE_H);
  const cCat = notPaper.getContext("2d");
  cCat.fillStyle = "#87ceeb";
  cCat.fillRect(0, 0, PAGE_W, PAGE_H);
  cCat.fillStyle = "#f5722d";
  cCat.beginPath();
  cCat.ellipse(PAGE_W / 2, PAGE_H / 2 + 40, 280, 220, 0, 0, Math.PI * 2);
  cCat.fill();
  cCat.beginPath();
  cCat.moveTo(PAGE_W / 2 - 180, PAGE_H / 2 - 80);
  cCat.lineTo(PAGE_W / 2 - 80, PAGE_H / 2 - 260);
  cCat.lineTo(PAGE_W / 2 - 20, PAGE_H / 2 - 40);
  cCat.closePath();
  cCat.fill();
  cCat.beginPath();
  cCat.moveTo(PAGE_W / 2 + 180, PAGE_H / 2 - 80);
  cCat.lineTo(PAGE_W / 2 + 80, PAGE_H / 2 - 260);
  cCat.lineTo(PAGE_W / 2 + 20, PAGE_H / 2 - 40);
  cCat.closePath();
  cCat.fill();
  cCat.fillStyle = "#1a1a1a";
  cCat.beginPath();
  cCat.arc(PAGE_W / 2 - 80, PAGE_H / 2 + 20, 28, 0, Math.PI * 2);
  cCat.arc(PAGE_W / 2 + 80, PAGE_H / 2 + 20, 28, 0, Math.PI * 2);
  cCat.fill();
  save("sample-not-a-paper.png", notPaper);

  const large = createCanvas(3000, 4000);
  const c7 = large.getContext("2d");
  linedPaper(c7, 3000, 4000);
  writeInk(c7, "1.", 80, 220, "italic 56px Georgia", "#1a365d");
  writeInk(
    c7,
    "Potential energy = mgh = 2 * 10 * 5 = 100 J",
    220,
    220,
    "italic 56px Georgia",
    "#1a365d",
  );
  writeInk(c7, "2.", 80, 520, "italic 56px Georgia", "#1a365d");
  writeInk(
    c7,
    "Water is a polar molecule because of its bent shape.",
    220,
    520,
    "italic 56px Georgia",
    "#1a365d",
  );
  save("sample-large.png", large);

  const skewed = createCanvas(PAGE_W, PAGE_H);
  const c8 = skewed.getContext("2d");
  c8.fillStyle = "#6b7280";
  c8.fillRect(0, 0, PAGE_W, PAGE_H);
  c8.save();
  c8.translate(PAGE_W / 2 + 20, PAGE_H / 2 - 10);
  c8.rotate(-12 * (Math.PI / 180));
  c8.translate(-PAGE_W / 2, -PAGE_H / 2);
  linedPaper(c8, PAGE_W, PAGE_H);
  writeInk(c8, "11.", 40, 200, "italic 28px Georgia", "#1a365d");
  writeInk(
    c8,
    "Velocity is the rate of change of displacement.",
    120,
    200,
    "italic 28px Georgia",
    "#1a365d",
  );
  writeInk(c8, "12.", 40, 380, "italic 28px Georgia", "#1a365d");
  writeInk(
    c8,
    "An isotope has the same protons but different neutrons.",
    120,
    380,
    "italic 28px Georgia",
    "#1a365d",
  );
  c8.restore();
  save("sample-skewed.png", skewed);

  return ASSETS_DIR;
}

function wrapLines(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
  return cy;
}

function printedPaper(ctx: SKRSContext2D, width: number, height: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, width - 72, height - 72);
}

type PaperLine =
  | { kind: "title"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "section"; text: string }
  | { kind: "instruction"; text: string }
  | { kind: "body"; text: string }
  | { kind: "gap"; size: number };

function drawPrintedPage(lines: PaperLine[], name: string) {
  const canvas = createCanvas(PAGE_W, PAGE_H);
  const ctx = canvas.getContext("2d");
  printedPaper(ctx, PAGE_W, PAGE_H);

  let y = 96;
  const left = 72;
  const maxWidth = PAGE_W - 144;

  for (const line of lines) {
    if (line.kind === "gap") {
      y += line.size;
      continue;
    }
    if (line.kind === "title") {
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 34px Georgia";
      ctx.fillText(line.text, left, y);
      y += 44;
      continue;
    }
    if (line.kind === "meta") {
      ctx.fillStyle = "#4b4b4b";
      ctx.font = "20px Georgia";
      y = wrapLines(ctx, line.text, left, y, maxWidth, 28);
      y += 8;
      continue;
    }
    if (line.kind === "section") {
      y += 12;
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 24px Georgia";
      ctx.fillText(line.text, left, y);
      y += 36;
      continue;
    }
    if (line.kind === "instruction") {
      ctx.fillStyle = "#4b4b4b";
      ctx.font = "italic 20px Georgia";
      y = wrapLines(ctx, line.text, left, y, maxWidth, 28);
      y += 10;
      continue;
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "22px Georgia";
    y = wrapLines(ctx, line.text, left, y, maxWidth, 32);
    y += 14;
  }

  save(name, canvas);
}

/**
 * Printed question-paper fixtures for Phase 2.
 *
 * Hand count (do not extract headers/instructions):
 * Page 1: Q1, Q2, Q5, Q6, Q8(a)(i), Q8(a)(ii), Q11(a)  → 7
 * Page 2: Q11(b), Section C Q1, Q3                     → 3
 * Total: 10
 */
export function generatePhase2Fixtures() {
  mkdirSync(ASSETS_DIR, { recursive: true });

  drawPrintedPage(
    [
      { kind: "title", text: "MID-TERM EXAMINATION" },
      { kind: "meta", text: "Class 10  Science    Time allowed: 2 hours    Maximum Marks: 80" },
      { kind: "gap", size: 8 },
      { kind: "section", text: "SECTION A — Physics" },
      { kind: "instruction", text: "Answer ALL questions." },
      {
        kind: "body",
        text: "1. Define velocity. [2 marks]",
      },
      {
        kind: "body",
        text: "2. State Ohm's law.",
      },
      { kind: "section", text: "SECTION B — Chemistry" },
      {
        kind: "instruction",
        text: "Answer any 3 of the following.",
      },
      {
        kind: "instruction",
        text: "Answer either Question 5 or Question 6.",
      },
      {
        kind: "body",
        text: "5. Describe the structure of an atom. [5 marks]",
      },
      {
        kind: "body",
        text: "6. Describe the structure of a molecule. [5 marks]",
      },
      {
        kind: "body",
        text: "8. Explain covalent bonding.",
      },
      {
        kind: "body",
        text: "(a) (i) Define a covalent bond. [2 marks]",
      },
      {
        kind: "body",
        text: "(a) (ii) Give one example of a covalent compound. [2 marks]",
      },
      { kind: "section", text: "SECTION C — Biology" },
      {
        kind: "body",
        text: "11. Explain photosynthesis in green plants.",
      },
      {
        kind: "body",
        text: "(a) Write the word equation for photosynthesis. [3 marks]",
      },
    ],
    "sample-qp-page1.png",
  );

  drawPrintedPage(
    [
      { kind: "meta", text: "Science Paper 1  —  continued" },
      { kind: "gap", size: 16 },
      {
        kind: "body",
        text: "(b) List two factors that affect the rate of photosynthesis. [2 marks]",
      },
      { kind: "gap", size: 12 },
      { kind: "section", text: "SECTION C — Biology (continued)" },
      { kind: "instruction", text: "Answer ALL questions." },
      {
        kind: "body",
        text: "1. Name the organelle known as the powerhouse of the cell. [1 mark]",
      },
      {
        kind: "body",
        text: "3. What is osmosis?",
      },
    ],
    "sample-qp-page2.png",
  );

  drawPrintedPage(
    [
      { kind: "title", text: "INSTRUCTIONS ONLY" },
      { kind: "section", text: "SECTION B: Answer any 3 of the following" },
      {
        kind: "instruction",
        text: "Answer ALL questions. Time allowed: 2 hours. Maximum Marks: 80.",
      },
      {
        kind: "instruction",
        text: "Write your answers in the answer booklet provided. Do not write on this paper.",
      },
    ],
    "sample-qp-instructions-only.png",
  );

  return ASSETS_DIR;
}

if (process.argv[1] && process.argv[1].includes("generate-test-assets")) {
  generatePhase1Fixtures();
  generatePhase2Fixtures();
  console.log("Wrote Phase 1 and Phase 2 fixtures to", ASSETS_DIR);
}
