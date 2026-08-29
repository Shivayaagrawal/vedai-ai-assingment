"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import type { SelectedUpload } from "../lib/upload-file";
import { FileDropzone } from "./FileDropzone";
import { UploadHero } from "./UploadHero";

type UploadPanelProps = {
  onStartMapping: (
    questionPaper: SelectedUpload,
    answerSheet: SelectedUpload,
  ) => void;
};

export function UploadPanel({ onStartMapping }: UploadPanelProps) {
  const [questionPaper, setQuestionPaper] = useState<SelectedUpload | null>(
    null,
  );
  const [answerSheet, setAnswerSheet] = useState<SelectedUpload | null>(null);

  const ready = questionPaper !== null && answerSheet !== null;

  function startMapping() {
    if (!questionPaper || !answerSheet) return;
    onStartMapping(questionPaper, answerSheet);
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-8 py-10">
      <UploadHero />

      <div className="mt-10 flex w-full gap-6">
        <FileDropzone
          labelLead="Upload"
          labelAccent="Question Paper"
          value={questionPaper}
          onChange={setQuestionPaper}
        />
        <FileDropzone
          labelLead="Upload"
          labelAccent="Answer Sheet"
          value={answerSheet}
          onChange={setAnswerSheet}
        />
      </div>

      <button
        type="button"
        disabled={!ready}
        onClick={startMapping}
        className={`mt-10 flex w-[320px] items-center justify-center gap-2 rounded-pill py-3 text-body font-medium ${
          ready
            ? "bg-ink text-surface"
            : "bg-surface-active text-muted"
        }`}
      >
        Start Mapping
        <ArrowRight size={18} strokeWidth={1.75} />
      </button>
      <p className="mt-3 text-center text-caption text-muted">
        Once both files are uploaded, you&apos;ll be able to map answers with
        questions.
      </p>
    </section>
  );
}
