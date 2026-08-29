# Cursor Build Prompt — VedaAI Assessment Extraction & Answer Mapping

## Setup — do this before Phase 0

1. Create your project folder and drop in the `.cursor/rules/` folder and
   `/design-reference/` folder from this bundle at the project root:
   ```
   your-project/
     .cursor/rules/
       design-tokens.mdc
       figma-fidelity.mdc
       project-conventions.mdc
     design-reference/
       01-upload-empty.png
       02-upload-filled.png
       03-processing-extracting.png
       04-results-desktop-top.png
       05-results-desktop-scrolled.png
       06-mobile-questions-tab.png
       07-mobile-answersheet-tab.png
   ```
2. Open the project in Cursor. The `.mdc` rules auto-load; Cursor will read
   the screenshots when a component task references them (or when you
   `@`-mention the file path in chat).
3. Work phase by phase, testing before moving on — don't paste the whole
   plan in at once.

---

## Phase 0 — Project scaffold

```
Create a new Next.js 14 project (App Router, TypeScript, Tailwind CSS, no src/ directory).

Set up this folder structure:

/app
  /page.tsx
  /api/extract-questions/route.ts
  /api/extract-answers/route.ts
  /api/grade/route.ts
/lib
  /gemini.ts
  /pdf-to-images.ts
  /matching.ts
  /types.ts
/components
  /Sidebar.tsx
  /TopBar.tsx
  /UploadPanel.tsx
  /ProcessingScreen.tsx
  /QuestionList.tsx
  /QuestionCard.tsx
  /AnswerSheetViewer.tsx
  /HighlightOverlay.tsx
  /MobileTabSwitcher.tsx
  /GradingSummary.tsx

Install: pdfjs-dist, @google/generative-ai, lucide-react

Do not set up a database or auth. State lives in React state on the client.

Before writing any component, read .cursor/rules/design-tokens.mdc and
.cursor/rules/figma-fidelity.mdc — they define the exact colors, spacing,
and per-screen specs you must follow, referencing images in /design-reference.

Add the design tokens as CSS variables in globals.css and extend
tailwind.config.ts per the mapping shown in design-tokens.mdc.

Define these TypeScript types in /lib/types.ts:

type Question = {
  id: string;
  displayNumber: string;   // e.g. "11", with subPart "a" separately
  subPart?: string;        // e.g. "a" — rendered as "a." next to the shared number badge
  section?: string;
  text: string;
  page: number;
  maxMarks?: number;
  isAlternativeOf?: string; // id of paired OR-question, if applicable
};

type AnswerRegion = {
  page: number;
  x: number; y: number; width: number; height: number; // normalized 0-1
};

type Answer = {
  id: string;
  detectedQuestionNumber: string | null;
  text: string;
  regions: AnswerRegion[];
  confidence: number;
  isCrossedOut?: boolean;
};

type MappingStatus = "matched" | "unanswered" | "unmatched" | "low-confidence" | "not-attempted-choice";

type MappedResult = {
  question: Question;
  answer: Answer | null;
  status: MappingStatus;
  matchConfidence: number;
};

type GradeResult = {
  questionId: string;
  score: number | null;
  maxScore: number | null;
  verdict: "correct" | "partially-correct" | "incorrect" | "not-gradable";
  feedback: string;
};
```

---

## Phase 1 — Gemini client + bbox extraction test (before any UI)

```
In /lib/gemini.ts, wrap @google/generative-ai using model "gemini-2.0-flash"
(fallback "gemini-1.5-flash"). Read API key from process.env.GEMINI_API_KEY.

Export extractAnswersFromPage(imageBase64: string, pageNumber: number): Promise<Answer[]>.
Prompt:

"You are analyzing a page from a student's handwritten exam answer sheet.
Identify every distinct answer block on this page. For each, return:
- detectedQuestionNumber: the number/label the student wrote (e.g. '4', '11(a)'),
  or null if none visible
- text: best-effort transcription (empty string if the answer is a diagram
  with no text, but still return the region)
- boundingBox: {x, y, width, height} as fractions (0-1) of the image's width/height
- confidence: 0-1
- isCrossedOut: true if struck through

Return ONLY a JSON array, no markdown fences, no extra text."

Add robust parsing: strip ```json fences, try/catch, log raw text on failure,
return [] on unrecoverable parse failure.

Create /scripts/test-bbox.ts:
1. Load a sample handwriting image from /test-assets/sample-answer-page.png
2. Call extractAnswersFromPage
3. Draw returned boxes onto the image (node-canvas, or just log raw JSON if
   canvas setup is too heavy)
4. Save annotated output to /test-assets/output-with-boxes.png

Do not build UI yet.
```

**Stop. Run this against 2-3 real handwriting samples. Only proceed if the boxes are visually close.** If not, try asking for pixel coordinates against a stated resolution instead of normalized floats.

---

## Phase 2 — Question extraction

```
In /lib/gemini.ts add extractQuestionsFromPage(imageBase64: string, pageNumber: number): Promise<Question[]>.

Prompt:
"Extract every question and labeled sub-part as a SEPARATE entry, in exact
printed order. '11. Explain X. (a)... (b)...' becomes two entries: 11(a) and
11(b), each with displayNumber '11' and subPart 'a'/'b'. Include section name
if sections exist. If a question offers a choice ('Answer either Q5 or Q6'),
set isAlternativeOf on both entries to the other's number. Extract maxMarks
if printed (e.g. '[5 marks]').

Return ONLY a JSON array, no markdown, no extra text."

Same parsing robustness as Phase 1. Generate a stable id client-side by
slugifying section + displayNumber + subPart.
```

---

## Phase 3 — API routes

```
Create /app/api/extract-questions/route.ts: accepts base64 page images,
calls extractQuestionsFromPage in parallel via Promise.all, flattens/orders
results, returns JSON. try/catch, 500 + clear message on failure.

Create /app/api/extract-answers/route.ts: same pattern for extractAnswersFromPage.
Assign stable ids like page{n}-answer{index}.

Set maxDuration appropriately for Gemini response time; handle timeouts with
a clear retryable error rather than hanging.
```

---

## Phase 4 — Mapping logic

```
In /lib/matching.ts implement mapAnswersToQuestions(questions, answers).

1. normalizeNumber(raw): lowercase, strip spaces/parens/dots — "11 (a)",
   "11a", "Q11a", "11.a" all normalize to "11a".
2. Match by normalized detectedQuestionNumber. confidence > 0.5 -> "matched".
   0.2-0.5 -> "low-confidence" (still attach the answer, just flagged).
3. isAlternativeOf pairs where NEITHER side has an answer -> both get
   "not-attempted-choice" instead of "unanswered".
4. Remaining unmatched questions -> "unanswered", answer = null.
5. Remaining unclaimed answers -> collect as unmatchedAnswers[], don't force-fit.
6. Positional fallback: for null-labeled unmatched answers + remaining
   unanswered questions, pair Nth-to-Nth in printed order, mark
   "low-confidence" with matchConfidence 0.3. Never override an existing
   higher-confidence match this way.

Return { results: MappedResult[], unmatchedAnswers: Answer[] }.
```

---

## Phase 5 — Grading

```
Add gradeAnswers(pairs) in /lib/gemini.ts. Batch ALL pairs into ONE Gemini
call (not one per question). Send {questionId, questionText, maxMarks,
answerText}[], ask for {questionId, score, maxScore, verdict, feedback}[]
back. Prompt: "No official marking scheme is provided — grade on general
correctness/completeness. Default maxMarks to 10 if null. If answerText is
empty (diagram-only), verdict = 'not-gradable' with feedback noting a
diagram was detected but not evaluated."

Create /app/api/grade/route.ts. Triggered by an explicit "Grade all answers"
action in the UI, not run automatically.
```

---

## Phase 6 — Upload screen UI

```
Reference: design-reference/01-upload-empty.png and 02-upload-filled.png.
Read design-tokens.mdc's "Upload screen" section before starting.

Build Sidebar.tsx: white full-height panel, "VedaAI" logo top-left, the
"AI Teacher's Toolkit" pill button (ink background, orange gradient border,
sparkle icon), nav items (Home, My Classroom, Assignments, Exams active,
My Library) with the active-state pill background, school info card pinned
to the bottom. Use lucide-react icons matching each nav item's icon shown
in the screenshot.

Build TopBar.tsx: back arrow, clipboard icon + "Exams" label, right cluster
of help/bell(with unread dot)/sparkles/avatar+name+chevron.

Build UploadPanel.tsx:
- Centered heading "Upload" (ink) + "Question Paper & Answer Sheets" (orange,
  underlined, sitting on the soft peach highlight background) — exactly as
  in 01-upload-empty.png.
- Centered decorative illustration (a placeholder circular avatar image with
  the orange ring is fine — this is decorative, not functional).
- Two dashed dropzones side by side using react-dropzone or plain HTML5
  drag events, "Upload Question Paper" / "Upload Answer Sheet" labels with
  the second word in orange, upload icon, "Max 10MB" caption.
- On file select, replace dropzone content with a file card matching
  02-upload-filled.png exactly: red PDF icon, bold filename, "{size}MB • {N} Pages"
  caption, circular × remove button top-right.
- "Start Mapping" pill button: disabled/muted style when either file is
  missing, enabled ink-background style with arrow icon once both are
  present. Helper caption underneath always visible.

Wire page count/size display using pdf-to-images.ts (page count from
pdfjs-dist's page count, size from File.size).
```

---

## Phase 7 — Processing screen UI

```
Reference: design-reference/03-processing-extracting.png.

Build ProcessingScreen.tsx: sidebar collapses to an icon-only rail (~72px,
icons only, no labels) during this screen — mirror the collapsed nav shown
in the reference. Centered content: large orange sparkle/star icon, bold
"Extracting..." text, muted "This may take a while" subcaption.

Keep this minimal — no heavy multi-step progress bar, matching the
reference's calm single-message style. If you want to show which pipeline
stage is running (converting pages / extracting questions / extracting
answers / mapping), swap the single line of text as each stage completes
rather than adding a stepper UI element not shown in the design.

Wire this to run: PDF->image conversion -> extract-questions call ->
extract-answers call -> mapAnswersToQuestions -> transition to results screen.
On any step failing, show an inline retry affordance rather than a blank error.
```

---

## Phase 8 — Results screen UI (desktop)

```
Reference: design-reference/04-results-desktop-top.png and 05-results-desktop-scrolled.png.

Build QuestionList.tsx + QuestionCard.tsx:
- Header "Extracted Questions (from question paper)" + "Expand All" pill
  button top-right.
- Each QuestionCard: numbered ink-circle badge on the left (for sub-parts
  like 11(a)/11(b), render the shared number "11" once with "a."/"b." next
  to it — see 05-results-desktop-scrolled.png exactly), question text,
  a score badge pill on the right (success/warning/error color per
  design-tokens.mdc depending on grade), chevron toggle.
- Selected/expanded card gets the orange outline border and reveals an
  "AI Feedback" panel (bold label + muted background box + feedback text)
  exactly as shown for question 2 in 04-results-desktop-top.png.
- Unanswered questions: no score badge, instead a neutral "Not answered"
  label/badge (not shown in reference — use tokens to stay consistent,
  and flag this as an inferred addition).
- "Not attempted (choice)" questions: similar neutral treatment with a
  distinct label, also flagged as inferred.

Build AnswerSheetViewer.tsx + HighlightOverlay.tsx:
- Dark header bar labeled "Answer Sheet", zoom controls "− 100% +" left side,
  page nav "‹ Page N of M ›" right side, matching the reference bar exactly.
- Render the current page's image full width below the bar.
- HighlightOverlay: absolutely-positioned box(es) scaled from normalized
  bbox coordinates to the image's actual rendered size (compute scale factor
  from natural image size to displayed size — recompute on resize). Style:
  green border + faint green fill + small green pill tag in the top-left
  corner showing the question number (e.g. "Q2") — match
  04-results-desktop-top.png's Q2 highlight treatment exactly.
- Clicking a QuestionCard scrolls/pages the viewer to the answer's page and
  activates its highlight(s). If the answer has multiple regions (multi-page),
  highlight all of them and show a small "continues on page N" label.
- If status is "unanswered", show a placeholder message in the viewer
  ("No answer found for this question") instead of an empty highlight.

Add an unmatched-answers section (below or beside the question list) for
Answer entries not claimed by any question — each clickable to highlight its
region, labeled "Unmatched answer (detected as Q__ or unlabeled)". This
state isn't shown in the reference screenshots — style it consistently with
the existing card/badge tokens and flag it as an inferred addition.

Build GradingSummary.tsx: total score, counts by verdict, "Grade all answers"
button wired to Phase 5's API route. Place it consistent with the overall
panel style — not shown explicitly in the reference, so keep it visually
minimal and flag as inferred placement.
```

---

## Phase 9 — Mobile layout

```
Reference: design-reference/06-mobile-questions-tab.png and 07-mobile-answersheet-tab.png.

Build MobileTabSwitcher.tsx: pill-shaped segmented control with "Questions"
/ "Answer Sheet" labels, ink background on the active tab, transparent/light
on the inactive tab — both labels always visible, not a dropdown.

At a mobile breakpoint (e.g. below md), replace the two-pane desktop layout
with: simplified top bar (back arrow, VedaAI wordmark+icon, bell, avatar,
hamburger menu replacing the sidebar), the MobileTabSwitcher, and conditional
rendering of either QuestionList or AnswerSheetViewer based on the active tab
— reusing the same components built in Phase 8, not separate mobile-only
components, so behavior (highlighting, grading) stays consistent across
breakpoints.
```

---

## Phase 10 — Edge case hardening

```
Add handling for:
1. Corrupted/unreadable file upload -> clear error, no crash
2. Gemini timeout/rate-limit -> specific user-facing message
   ("Rate limit reached, please wait and retry" vs generic error)
3. Zero questions or zero answers extracted -> explanatory empty state
4. Multiple separate image files instead of one PDF -> allow reordering
   thumbnails before processing (page order matters)
5. Very long question/answer text -> truncate with "show more", don't break layout

Do not add new features in this pass — only defensive handling of the above.
```

---

## Phase 11 — Deploy

```
Add .env.local.example with GEMINI_API_KEY=your_key_here.
Add README.md: setup steps, env vars, one-paragraph architecture overview,
and known limitations (mislabeled-answer detection, rubric-less grading,
nested sub-sub-parts, degraded scan quality, GradingSummary/unmatched-answers
placement being inferred rather than spec'd — list whichever you didn't
fully implement).
Confirm no server-only code runs client-side, confirm API route maxDuration
values, then deploy to Vercel with the env var set in project settings.
```

---

## Getting the API key

**Gemini API (free tier)**
1. https://aistudio.google.com/apikey — sign in, create key, copy it.
2. `.env.local` locally: `GEMINI_API_KEY=...`; also add it in Vercel →
   Project Settings → Environment Variables before deploying.
3. Check current free-tier limits at
   https://ai.google.dev/gemini-api/docs/pricing before you start — Flash
   models generally have the most generous free quota. Build in retry/backoff
   so a rate-limit hit during testing doesn't surface as a bug during a demo.

No other paid API is required.

## Optional: Figma Dev Mode MCP for exact values later

The tokens in `design-tokens.mdc` were eyeballed from screenshots and are
close but not pixel-perfect. If you want to tighten them later: enable Figma
Dev Mode → MCP Server on the file, connect it in Cursor Settings → MCP, then
ask Cursor to run its `get_variable_defs`/`get_code` tools against specific
frames and merge exact values back into `design-tokens.mdc`. This is a nice-
to-have polish pass, not a blocker — the screenshot-derived tokens are good
enough to build the full app end-to-end.
