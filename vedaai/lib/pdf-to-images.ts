import type { ExtractPageInput } from "./types";
import type { SelectedUpload, UploadKind } from "./upload-file";
import { requirePositivePageCount, sniffUploadKind } from "./upload-file";

const PDF_WORKER_SRC = "/pdf.worker.min.mjs";
const MAX_RENDER_EDGE_PX = 2048;

/**
 * PDF.js getTextContent does `for await (const value of readableStream)`.
 * Safari / WebKit often has ReadableStream but no async iterator, which
 * throws: undefined is not a function (near '...value of readableStream...').
 */
export function ensureReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === "undefined") return;
  const proto = ReadableStream.prototype as ReadableStream<unknown> & {
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  if (typeof proto[Symbol.asyncIterator] === "function") return;
  proto[Symbol.asyncIterator] = async function* readableStreamAsyncIterator(
    this: ReadableStream<unknown>,
  ) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

function pdfDocumentOptions(data: Uint8Array) {
  return {
    data,
    // Full bytes are already in memory — don't open a network/stream path.
    disableStream: true,
    disableRange: true,
  };
}

async function loadPdfjs() {
  ensureReadableStreamAsyncIterator();
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  return pdfjs;
}

function asUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function textItemsFromPdfJs(
  items: unknown[],
  pageHeight: number,
): { text: string; y: number }[] {
  if (!(pageHeight > 0)) return [];
  const out: { text: string; y: number }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as {
      str?: string;
      transform?: number[];
      height?: number;
    };
    const text = typeof item.str === "string" ? item.str.trim() : "";
    if (!text) continue;
    const transform = item.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    const yBottom = transform[5];
    const height = typeof item.height === "number" ? item.height : 0;
    const yFromTop = (pageHeight - yBottom - height) / pageHeight;
    out.push({ text, y: clamp01(yFromTop) });
  }
  return out;
}

export async function getPdfPageCount(
  data: ArrayBuffer | Uint8Array,
): Promise<number> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument(pdfDocumentOptions(asUint8Array(data)));
  const pdf = await loadingTask.promise;
  return requirePositivePageCount(pdf.numPages);
}

export async function inspectUpload(file: File): Promise<{
  kind: UploadKind;
  pageCount: number;
}> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffUploadKind(bytes, file);
  if (!kind) {
    throw new Error("Couldn't read this file");
  }
  if (kind === "image") {
    return { kind, pageCount: 1 };
  }
  return {
    kind,
    pageCount: await getPdfPageCount(bytes),
  };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Couldn't read this file"));
    };
    reader.onerror = () => reject(new Error("Couldn't read this file"));
    reader.readAsDataURL(file);
  });
}

export type PageProgressFn = (current: number, total: number) => void;

export async function pdfFileToPageImages(
  file: File,
  onPage?: PageProgressFn,
): Promise<ExtractPageInput[]> {
  if (typeof document === "undefined") {
    throw new Error("PDF rasterization is browser-only.");
  }

  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument(pdfDocumentOptions(bytes)).promise;
  const pages: ExtractPageInput[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onPage?.(pageNumber, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const maxEdge = Math.max(base.width, base.height);
    const scale =
      maxEdge > MAX_RENDER_EDGE_PX ? MAX_RENDER_EDGE_PX / maxEdge : 1;
    const viewport = page.getViewport({ scale: Math.max(scale, 0.5) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) {
      throw new Error("Couldn't read this file");
    }
    await page.render({ canvasContext, viewport, canvas }).promise;
    let textItems: { text: string; y: number }[] = [];
    try {
      const textContent = await page.getTextContent();
      textItems = textItemsFromPdfJs(
        textContent.items as unknown[],
        viewport.height,
      );
    } catch (error) {
      // Page images are enough to extract; printed-text stitching is optional.
      console.warn(
        "[pdf] getTextContent failed; continuing without text items",
        error instanceof Error ? error.message : error,
      );
    }
    pages.push({
      pageNumber,
      imageBase64: canvas.toDataURL("image/jpeg", 0.85),
      ...(textItems.length > 0 ? { textItems } : {}),
    });
  }

  return pages;
}

export async function pagesFromUpload(
  upload: SelectedUpload,
  onPage?: PageProgressFn,
): Promise<ExtractPageInput[]> {
  if (upload.kind === "image") {
    onPage?.(1, 1);
    return [
      {
        pageNumber: 1,
        imageBase64: await fileToDataUrl(upload.file),
      },
    ];
  }
  return pdfFileToPageImages(upload.file, onPage);
}
