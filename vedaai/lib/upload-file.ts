export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/**
 * Hard cap on rasterized pages per extract request.
 * Vercel serverless bodies are typically ~4.5MB. Clean 2048px JPEG rasters of
 * `sample-clean.png` stay under that even at 20 pages (~3.14MB). A photo-scan
 * analogue (same raster + noise, JPEG q=0.85) crosses 4.5MB at 5 pages
 * (3 pages = 3.57MB). Assignment papers are printed/PDF-like and 2–4 pages
 * in the Figma reference, so 8 pages is enough for the demo without chunked
 * extract requests. See `scripts/measure-payload.ts`.
 */
export const MAX_EXTRACT_PAGES = 8;

export function pageCountLimitMessage(maxPages = MAX_EXTRACT_PAGES): string {
  return `Please upload a paper with no more than ${maxPages} pages`;
}

export type UploadKind = "pdf" | "image";

export type SelectedUpload = {
  file: File;
  pageCount: number;
  sizeBytes: number;
  kind: UploadKind;
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i <= head.length - 4; i += 1) {
    if (
      head[i] === 0x25 &&
      head[i + 1] === 0x50 &&
      head[i + 2] === 0x44 &&
      head[i + 3] === 0x46
    ) {
      return true;
    }
  }
  return false;
}

function extensionKind(name: string): UploadKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg")
  ) {
    return "image";
  }
  return null;
}

function mimeKind(type: string): UploadKind | null {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png" || type === "image/jpeg") return "image";
  return null;
}

/**
 * Prefer magic bytes, then filename extension, then File.type.
 * MIME is last because some browsers leave it empty or set octet-stream.
 */
export function sniffUploadKind(bytes: Uint8Array, file: File): UploadKind | null {
  if (looksLikePdf(bytes)) return "pdf";
  if (startsWith(bytes, PNG_MAGIC) || startsWith(bytes, JPEG_MAGIC)) {
    return "image";
  }
  return extensionKind(file.name) ?? mimeKind(file.type);
}

export function requirePositivePageCount(pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("Couldn't read this file");
  }
  return pageCount;
}

export function formatSizeMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)}MB`;
  if (mb >= 1) {
    const rounded = Math.round(mb * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}MB` : `${rounded.toFixed(1)}MB`;
  }
  if (mb >= 0.1) return `${mb.toFixed(1)}MB`;
  return `${Math.max(mb, 0.01).toFixed(2)}MB`;
}

export function formatFileMeta(sizeBytes: number, pageCount: number): string {
  const pagesLabel = pageCount === 1 ? "1 Page" : `${pageCount} Pages`;
  return `${formatSizeMb(sizeBytes)} • ${pagesLabel}`;
}

export function validateUploadFile(
  file: File,
): { ok: true } | { ok: false; message: string } {
  const name = file.name.toLowerCase();
  const allowedType =
    file.type === "application/pdf" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    name.endsWith(".pdf") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg");

  if (!allowedType) {
    return { ok: false, message: "Use a PDF, PNG, or JPG file." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: "File must be 10MB or smaller." };
  }

  return { ok: true };
}

export function validatePageCount(
  pageCount: number,
): { ok: true } | { ok: false; message: string } {
  if (pageCount > MAX_EXTRACT_PAGES) {
    return { ok: false, message: pageCountLimitMessage() };
  }
  return { ok: true };
}
