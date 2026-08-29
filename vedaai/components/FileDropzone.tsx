"use client";

import { CloudUpload, X } from "lucide-react";
import { useRef, useState } from "react";
import { inspectUpload } from "../lib/pdf-to-images";
import {
  formatFileMeta,
  validatePageCount,
  validateUploadFile,
  type SelectedUpload,
} from "../lib/upload-file";

type FileDropzoneProps = {
  labelLead: string;
  labelAccent: string;
  value: SelectedUpload | null;
  onChange: (next: SelectedUpload | null) => void;
};

export function FileDropzone({
  labelLead,
  labelAccent,
  value,
  onChange,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadGeneration = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function acceptFile(file: File) {
    const generation = ++loadGeneration.current;
    setError(null);

    const validated = validateUploadFile(file);
    if (!validated.ok) {
      onChange(null);
      setError(validated.message);
      return;
    }

    setReading(true);
    try {
      const inspected = await inspectUpload(file);
      if (generation !== loadGeneration.current) return;
      const pagesOk = validatePageCount(inspected.pageCount);
      if (!pagesOk.ok) {
        onChange(null);
        setError(pagesOk.message);
        return;
      }
      onChange({
        file,
        pageCount: inspected.pageCount,
        sizeBytes: file.size,
        kind: inspected.kind,
      });
      setError(null);
    } catch {
      if (generation !== loadGeneration.current) return;
      onChange(null);
      setError("Couldn't read this file");
    } finally {
      if (generation === loadGeneration.current) {
        setReading(false);
      }
    }
  }

  function removeFile() {
    loadGeneration.current += 1;
    setReading(false);
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void acceptFile(file);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        onClick={() => {
          if (!value) inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void acceptFile(file);
        }}
        className={`rounded-md border border-dashed border-border-dashed bg-surface px-6 py-8 ${
          dragging ? "bg-surface-muted" : ""
        } ${value ? "" : "cursor-pointer"}`}
      >
        <input
          ref={inputRef}
          type="file"
          data-slot={labelAccent === "Question Paper" ? "question-paper" : "answer-sheet"}
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={onInputChange}
        />

        {value ? (
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-error-text text-caption font-semibold text-surface">
              {value.kind === "pdf" ? "PDF" : "IMG"}
            </div>
            <div className="min-w-0 pr-8">
              <p className="truncate text-body font-semibold text-ink">
                {value.file.name}
              </p>
              <p className="mt-1 text-body-small text-muted">
                {formatFileMeta(value.sizeBytes, value.pageCount)}
              </p>
            </div>
            <button
              type="button"
              data-remove={
                labelAccent === "Question Paper" ? "question-paper" : "answer-sheet"
              }
              aria-label={`Remove ${value.file.name}`}
              onClick={(event) => {
                event.stopPropagation();
                removeFile();
              }}
              className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-surface-active text-ink"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <CloudUpload size={28} strokeWidth={1.5} className="text-muted" />
            <p className="mt-4 text-body">
              {labelLead}{" "}
              <span className="font-semibold text-primary">{labelAccent}</span>
            </p>
            <p className="mt-2 text-body-small text-muted">
              {reading ? "Reading file…" : "Max 10MB"}
            </p>
          </div>
        )}
      </div>
      {error ? (
        <p className="mt-2 text-caption text-error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
