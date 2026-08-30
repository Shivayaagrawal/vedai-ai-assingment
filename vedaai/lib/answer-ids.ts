import type { Answer } from "./types";

export function assignAnswerIds(answers: Answer[]): Answer[] {
  const counts = new Map<number, number>();
  return answers.map((answer) => {
    const page = answer.regions[0]?.page ?? 0;
    const next = (counts.get(page) ?? 0) + 1;
    counts.set(page, next);
    return { ...answer, id: `page${page}-answer${next}` };
  });
}
