export type Question = {
  id: string;
  displayNumber: string;
  subPart?: string;
  section?: string;
  text: string;
  page: number;
  maxMarks?: number;
  isAlternativeOf?: string;
  /** Set when a bare continuation could not be attached to exactly one parent. */
  needsReview?: boolean;
};

export type AnswerRegion = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Answer = {
  id: string;
  detectedQuestionNumber: string | null;
  text: string;
  regions: AnswerRegion[];
  confidence: number;
  isCrossedOut?: boolean;
};

export type MappingStatus =
  | "matched"
  | "unanswered"
  | "unmatched"
  | "low-confidence"
  | "not-attempted-choice";

export type MappedResult = {
  question: Question;
  answer: Answer | null;
  status: MappingStatus;
  matchConfidence: number;
  flagged?: "crossed-out";
};

export type GradeResult = {
  questionId: string;
  score: number | null;
  maxScore: number | null;
  verdict: "correct" | "partially-correct" | "incorrect" | "not-gradable";
  feedback: string;
};

export type GradePair = {
  questionId: string;
  questionText: string;
  maxMarks: number | null;
  answerText: string;
  matchConfidence: number;
  flagged?: "crossed-out";
  regions?: AnswerRegion[];
};

export type SkippedGrade = {
  questionId: string;
  reason: string;
};

export type GradeVerdict = GradeResult["verdict"];

/** Embedded PDF text with normalized y (0 = top of page). Used for split completeness. */
export type PageTextItem = {
  text: string;
  y: number;
};

export type ExtractPageInput = {
  pageNumber: number;
  imageBase64: string;
  textItems?: PageTextItem[];
};

export type ExtractWarning = {
  page: number;
  message: string;
};
