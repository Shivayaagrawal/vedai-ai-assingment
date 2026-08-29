"use client";

import { useEffect, useRef, useState } from "react";
import {
  runExtractPipeline,
  type MappingSession,
  type PipelineCache,
} from "../lib/pipeline";
import type { SelectedUpload } from "../lib/upload-file";
import { buildExtractEmptyDemoSession, buildResultsDemoSession } from "../lib/results-demo-session";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { ProcessingScreen } from "./ProcessingScreen";
import { ResultsScreen } from "./ResultsScreen";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { UploadPanel } from "./UploadPanel";

type View = "upload" | "processing" | "results";

export function ExamUploadPage() {
  const [view, setView] = useState<View>("upload");
  const [collapsed, setCollapsed] = useState(false);
  const [progressMessage, setProgressMessage] = useState(
    "Opening your files…",
  );
  const [error, setError] = useState<{
    rateLimited: boolean;
    message: string;
  } | null>(null);
  const [session, setSession] = useState<MappingSession | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const filesRef = useRef<{
    questionPaper: SelectedUpload;
    answerSheet: SelectedUpload;
  } | null>(null);
  const cacheRef = useRef<PipelineCache>({});
  const runIdRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo) setDemoMode(true);
    if (demo === "processing") {
      setView("processing");
      setCollapsed(true);
      setProgressMessage("Detecting questions on 2 pages…");
      return;
    }
    if (demo === "results") {
      setSession(buildResultsDemoSession());
      setView("results");
      setCollapsed(false);
      return;
    }
    if (demo === "empty-questions") {
      setSession(buildExtractEmptyDemoSession("questions"));
      setView("results");
      setCollapsed(false);
      return;
    }
    if (demo === "empty-answers") {
      setSession(buildExtractEmptyDemoSession("answers"));
      setView("results");
      setCollapsed(false);
      return;
    }
    if (demo === "empty-both") {
      setSession(buildExtractEmptyDemoSession("both"));
      setView("results");
      setCollapsed(false);
    }
  }, []);

  async function runPipeline() {
    const files = filesRef.current;
    if (!files) {
      inFlightRef.current = false;
      return;
    }
    const runId = runIdRef.current;
    inFlightRef.current = true;
    setError(null);
    setView("processing");
    setCollapsed(true);

    const result = await runExtractPipeline(
      files.questionPaper,
      files.answerSheet,
      cacheRef.current,
      (progress) => {
        if (runIdRef.current !== runId) return;
        setProgressMessage(progress.message);
      },
    );

    if (runIdRef.current !== runId) {
      return;
    }

    cacheRef.current = result.ok ? {} : result.cache;
    inFlightRef.current = false;

    if (result.ok) {
      setSession(result.session);
      setView("results");
      setCollapsed(false);
      return;
    }

    setError({
      rateLimited: result.rateLimited,
      message: result.message,
    });
  }

  function startMapping(
    questionPaper: SelectedUpload,
    answerSheet: SelectedUpload,
  ) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    filesRef.current = { questionPaper, answerSheet };
    cacheRef.current = {};
    runIdRef.current += 1;
    void runPipeline();
  }

  function retry() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    runIdRef.current += 1;
    void runPipeline();
  }

  function goToUpload() {
    runIdRef.current += 1;
    inFlightRef.current = false;
    filesRef.current = null;
    cacheRef.current = {};
    setView("upload");
    setCollapsed(false);
    setError(null);
    setSession(null);
    setMenuOpen(false);
    setUploadKey((value) => value + 1);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar
        collapsed={view === "processing" ? true : collapsed}
        onToggleCollapsed={() => {
          if (view === "processing") return;
          setCollapsed((open) => !open);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onBack={view === "upload" ? undefined : goToUpload}
          onOpenMenu={() => setMenuOpen(true)}
        />
        <main
          className={`flex-1 bg-background ${
            view === "results" ? "overflow-hidden" : "overflow-auto"
          }`}
        >
          {view === "upload" ? (
            <UploadPanel key={uploadKey} onStartMapping={startMapping} />
          ) : null}
          {view === "processing" ? (
            <ProcessingScreen
              message={progressMessage}
              error={error}
              onRetry={retry}
            />
          ) : null}
          {view === "results" && session ? (
            <ResultsScreen
              session={session}
              onTryDifferentFile={goToUpload}
              autoGrade={!demoMode}
            />
          ) : null}
        </main>
      </div>
      <MobileNavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
