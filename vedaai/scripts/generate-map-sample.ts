import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import type { ExtractedMapItem } from "../lib/map-questions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MAP_SAMPLE_PNG = resolve(ROOT, "test-assets/map-answer-sample.png");

const W = 900;
const H = 700;

/** Ground truth for the synthetic write-on-map PNG (not two documents). */
export const MAP_SAMPLE_TRUTH: ExtractedMapItem[] = [
  { markerNumber: 1, x: 0.48, y: 0.22, page: 1, studentLabel: "Delhi" },
  { markerNumber: 2, x: 0.28, y: 0.48, page: 1, studentLabel: "Mumbai" },
  { markerNumber: 3, x: 0.55, y: 0.42, page: 1, studentLabel: null },
  { markerNumber: 4, x: 0.72, y: 0.38, page: 1, studentLabel: "Kolkata" },
  { markerNumber: 5, x: 0.5, y: 0.58, page: 1, studentLabel: "Paris" },
  { markerNumber: 6, x: 0.52, y: 0.78, page: 1, studentLabel: "Chennai" },
];

export function writeMapSamplePng(dest = MAP_SAMPLE_PNG): string {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cfe8f7";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e8d9b8";
  ctx.beginPath();
  ctx.moveTo(W * 0.45, H * 0.08);
  ctx.lineTo(W * 0.82, H * 0.32);
  ctx.lineTo(W * 0.7, H * 0.88);
  ctx.lineTo(W * 0.38, H * 0.9);
  ctx.lineTo(W * 0.18, H * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5a4a32";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("Outline map — write names on the numbered points", 24, 36);

  for (const item of MAP_SAMPLE_TRUTH) {
    const cx = item.x * W;
    const cy = item.y * H;
    ctx.beginPath();
    ctx.fillStyle = "#1a1a1a";
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(item.markerNumber ?? "?"), cx, cy);
    if (item.studentLabel) {
      ctx.fillStyle = "#1e4b8a";
      ctx.font = "italic 18px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(item.studentLabel, cx + 16, cy - 8);
    }
  }

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, canvas.toBuffer("image/png"));
  return dest;
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const dest = writeMapSamplePng();
  console.log(`[map-sample] wrote ${dest}`);
}
