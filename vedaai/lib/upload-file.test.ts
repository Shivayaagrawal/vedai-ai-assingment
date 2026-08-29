import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EXTRACT_PAGES,
  MAX_UPLOAD_BYTES,
  formatFileMeta,
  pageCountLimitMessage,
  requirePositivePageCount,
  sniffUploadKind,
  validatePageCount,
  validateUploadFile,
} from "./upload-file";

function fakeFile(name: string, type: string, size: number): File {
  const bytes = new Uint8Array(Math.min(size, 8));
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateUploadFile", () => {
  it("accepts pdf, png, and jpg under 10MB", () => {
    assert.equal(validateUploadFile(fakeFile("a.pdf", "application/pdf", 100)).ok, true);
    assert.equal(validateUploadFile(fakeFile("a.png", "image/png", 100)).ok, true);
    assert.equal(validateUploadFile(fakeFile("a.jpg", "image/jpeg", 100)).ok, true);
  });

  it("rejects oversize files", () => {
    const result = validateUploadFile(
      fakeFile("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /10MB/);
  });

  it("rejects disallowed types", () => {
    const result = validateUploadFile(
      fakeFile("essay.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 100),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /PDF/);
  });
});

describe("validatePageCount", () => {
  it("accepts page counts at the extract cap", () => {
    assert.equal(validatePageCount(1).ok, true);
    assert.equal(validatePageCount(MAX_EXTRACT_PAGES).ok, true);
  });

  it("rejects more pages than the rasterized payload cap", () => {
    const result = validatePageCount(MAX_EXTRACT_PAGES + 1);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, pageCountLimitMessage());
    }
  });
});

describe("formatFileMeta", () => {
  it("uses MB and page count", () => {
    assert.equal(formatFileMeta(2 * 1024 * 1024, 2), "2MB • 2 Pages");
    assert.equal(formatFileMeta(512 * 1024, 1), "0.5MB • 1 Page");
  });
});

describe("requirePositivePageCount", () => {
  it("rejects 0 or non-integer page counts instead of accepting the file", () => {
    assert.throws(() => requirePositivePageCount(0), /Couldn't read this file/);
    assert.throws(() => requirePositivePageCount(-1), /Couldn't read this file/);
    assert.throws(() => requirePositivePageCount(1.5), /Couldn't read this file/);
    assert.equal(requirePositivePageCount(1), 1);
    assert.equal(requirePositivePageCount(2), 2);
  });
});

describe("sniffUploadKind", () => {
  it("prefers magic bytes over a lying extension or empty MIME", () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    assert.equal(
      sniffUploadKind(pdfBytes, fakeFile("scan.png", "", 6)),
      "pdf",
    );
    assert.equal(
      sniffUploadKind(pngBytes, fakeFile("notes.pdf", "application/pdf", 6)),
      "image",
    );
    assert.equal(
      sniffUploadKind(jpegBytes, fakeFile("photo.jpg", "", 4)),
      "image",
    );
  });

  it("falls back to extension, then MIME, when magic is unknown", () => {
    const opaque = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    assert.equal(
      sniffUploadKind(opaque, fakeFile("paper.PDF", "", 4)),
      "pdf",
    );
    assert.equal(
      sniffUploadKind(opaque, fakeFile("scan.JPG", "", 4)),
      "image",
    );
    assert.equal(
      sniffUploadKind(opaque, fakeFile("unnamed", "application/pdf", 4)),
      "pdf",
    );
    assert.equal(
      sniffUploadKind(opaque, fakeFile("unnamed", "image/png", 4)),
      "image",
    );
    assert.equal(sniffUploadKind(opaque, fakeFile("unnamed", "", 4)), null);
  });
});
