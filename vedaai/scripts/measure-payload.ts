import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { generatePhase1Fixtures } from "./generate-test-assets";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = resolve(ROOT, "test-assets/sample-clean.png");
const MAX_RENDER_EDGE_PX = 2048;
/** Browser `canvas.toDataURL("image/jpeg", 0.85)` uses 0–1. napi-rs uses 0–100. */
const BROWSER_JPEG_QUALITY = 0.85;
const NAPI_JPEG_QUALITY = 85;
const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;
const PAGE_COUNTS = [1, 3, 5, 8, 12, 20] as const;

function fmtMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

async function rasterizeFixtureToJpegDataUrl(
  forceMaxEdge: boolean,
  photoNoise: boolean,
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  jpegBytes: number;
  label: string;
}> {
  if (!existsSync(FIXTURE)) {
    generatePhase1Fixtures();
  }

  const image = await loadImage(FIXTURE);
  const sourceMax = Math.max(image.width, image.height);
  const scale = forceMaxEdge
    ? MAX_RENDER_EDGE_PX / sourceMax
    : sourceMax > MAX_RENDER_EDGE_PX
      ? MAX_RENDER_EDGE_PX / sourceMax
      : 1;
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  if (photoNoise) {
    // Synthetic fixtures compress to ~20KB; camera scans of lined paper do not.
    // Overlay high-entropy pixels so JPEG size approximates a phone photo.
    const pixels = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 48;
      pixels.data[i] = Math.max(0, Math.min(255, pixels.data[i] + n));
      pixels.data[i + 1] = Math.max(0, Math.min(255, pixels.data[i + 1] + n));
      pixels.data[i + 2] = Math.max(0, Math.min(255, pixels.data[i + 2] + n));
    }
    ctx.putImageData(pixels, 0, 0);
  }
  const jpeg = canvas.toBuffer("image/jpeg", NAPI_JPEG_QUALITY);
  const sizeLabel = forceMaxEdge
    ? `max edge ${MAX_RENDER_EDGE_PX}`
    : "native fixture size";
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    width,
    height,
    jpegBytes: jpeg.length,
    label: photoNoise
      ? `photo-scan analogue (${sizeLabel}, noise overlay)`
      : `clean fixture (${sizeLabel})`,
  };
}

function extractBodyBytes(pageCount: number, dataUrl: string): number {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    imageBase64: dataUrl,
  }));
  return Buffer.byteLength(JSON.stringify({ pages }), "utf8");
}

function firstCrossing(sizes: { pages: number; bytes: number }[]): number | null {
  for (const row of sizes) {
    if (row.bytes > VERCEL_BODY_LIMIT_BYTES) return row.pages;
  }
  return null;
}

function reportVariant(
  page: Awaited<ReturnType<typeof rasterizeFixtureToJpegDataUrl>>,
) {
  const sizes = PAGE_COUNTS.map((pages) => ({
    pages,
    bytes: extractBodyBytes(pages, page.dataUrl),
  }));

  console.log(`--- ${page.label} ---`);
  console.log(
    `Raster: ${page.width}x${page.height}, JPEG q=${BROWSER_JPEG_QUALITY} (napi ${NAPI_JPEG_QUALITY})`,
  );
  console.log(
    `Binary JPEG: ${fmtMb(page.jpegBytes)} | data URL: ${fmtMb(Buffer.byteLength(page.dataUrl, "utf8"))}`,
  );
  console.log("Single extract request (questions OR answers):");
  for (const row of sizes) {
    const over = row.bytes > VERCEL_BODY_LIMIT_BYTES;
    console.log(
      `  ${String(row.pages).padStart(2)} pages  ${fmtMb(row.bytes).padStart(8)}  ${over ? "OVER LIMIT" : "ok"}`,
    );
  }
  console.log("Parallel questions + answers (both bodies in flight):");
  for (const row of sizes) {
    const combined = row.bytes * 2;
    const overEach = row.bytes > VERCEL_BODY_LIMIT_BYTES;
    console.log(
      `  ${String(row.pages).padStart(2)} pages  each ${fmtMb(row.bytes).padStart(8)}  both ${fmtMb(combined).padStart(8)}  ${
        overEach ? "each OVER 4.5MB" : "each under 4.5MB (two independent requests)"
      }`,
    );
  }
  const crossing = firstCrossing(sizes);
  if (crossing === null) {
    console.log(
      `Crossing: none of 1–${PAGE_COUNTS[PAGE_COUNTS.length - 1]} pages exceeded ${fmtMb(VERCEL_BODY_LIMIT_BYTES)} for a single body.`,
    );
  } else {
    const lastOk = [...sizes]
      .reverse()
      .find((row) => row.bytes <= VERCEL_BODY_LIMIT_BYTES);
    console.log(
      `Crossing: single body exceeds ${fmtMb(VERCEL_BODY_LIMIT_BYTES)} at ${crossing} pages.` +
        (lastOk
          ? ` Last measured count still under: ${lastOk.pages} (${fmtMb(lastOk.bytes)}).`
          : ""),
    );
  }
  console.log("");
}

async function main() {
  console.log("Fixture:", FIXTURE);
  console.log(
    `Vercel serverless body limit (typical): ${fmtMb(VERCEL_BODY_LIMIT_BYTES)}`,
  );
  console.log("");
  reportVariant(await rasterizeFixtureToJpegDataUrl(false, false));
  reportVariant(await rasterizeFixtureToJpegDataUrl(true, false));
  reportVariant(await rasterizeFixtureToJpegDataUrl(true, true));
}

void main();
