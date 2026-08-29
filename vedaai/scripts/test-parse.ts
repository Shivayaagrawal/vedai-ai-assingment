import { parseAnswersJson, parseQuestionsJson, questionIdFromParts } from "../lib/gemini";

const SAMPLE_BOX = {
  x: 0.1,
  y: 0.2,
  width: 0.5,
  height: 0.1,
};

const VALID_ITEM = {
  detectedQuestionNumber: "4",
  text: "F = ma",
  boundingBox: SAMPLE_BOX,
  confidence: 0.8,
  isCrossedOut: false,
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function runParseTests() {
  const prose = parseAnswersJson(
    `Here is the JSON:\n${JSON.stringify([VALID_ITEM])}\nHope this helps!`,
    1,
  );
  assert(prose.length === 1, "prose wrapper should still parse the array");
  assert(prose[0].detectedQuestionNumber === "4", "prose: question number");

  const fenced = parseAnswersJson(
    "```json\n" + JSON.stringify([VALID_ITEM]) + "\n```",
    1,
  );
  assert(fenced.length === 1, "fenced JSON should parse");

  const empty = parseAnswersJson("[]", 1);
  assert(empty.length === 0, "empty array should return []");

  const garbage = parseAnswersJson("sorry I cannot help with that", 1);
  assert(garbage.length === 0, "non-JSON should return [] not throw");

  const noNumber = parseAnswersJson(
    JSON.stringify([
      {
        ...VALID_ITEM,
        detectedQuestionNumber: null,
      },
    ]),
    1,
  );
  assert(
    noNumber[0].detectedQuestionNumber === null,
    "null question number must stay null",
  );

  const diagram = parseAnswersJson(
    JSON.stringify([
      {
        detectedQuestionNumber: "8",
        text: "",
        boundingBox: SAMPLE_BOX,
        confidence: 0.7,
        isCrossedOut: false,
      },
    ]),
    1,
  );
  assert(diagram[0].text === "", "diagram-only text should be empty string");
  assert(diagram[0].regions.length === 1, "diagram-only must keep a region");

  const crossed = parseAnswersJson(
    JSON.stringify([
      {
        ...VALID_ITEM,
        isCrossedOut: true,
      },
    ]),
    1,
  );
  assert(crossed[0].isCrossedOut === true, "isCrossedOut must not be dropped");

  console.log("[test-parse] all parser edge cases passed");
}

function runQuestionParseTests() {
  const valid = {
    displayNumber: "11",
    subPart: "a",
    section: "Section C",
    text: "Write the word equation for photosynthesis.",
    maxMarks: 3,
    isAlternativeOf: null,
  };

  const prose = parseQuestionsJson(
    `Here is the JSON:\n${JSON.stringify([valid])}\nHope this helps!`,
    1,
  );
  assert(prose.length === 1, "questions: prose wrapper should still parse");
  assert(prose[0].displayNumber === "11", "questions: displayNumber");
  assert(prose[0].subPart === "a", "questions: subPart");
  assert(prose[0].maxMarks === 3, "questions: maxMarks");
  assert(prose[0].id === "section-c-11-a", "questions: slug id");

  const fenced = parseQuestionsJson(
    "```json\n" + JSON.stringify([valid]) + "\n```",
    2,
  );
  assert(fenced.length === 1, "questions: fenced JSON should parse");
  assert(fenced[0].page === 2, "questions: page comes from caller");

  const empty = parseQuestionsJson("[]", 1);
  assert(empty.length === 0, "questions: empty array should return []");

  const garbage = parseQuestionsJson("sorry I cannot help with that", 1);
  assert(garbage.length === 0, "questions: non-JSON should return [] not throw");

  const noMarks = parseQuestionsJson(
    JSON.stringify([
      {
        displayNumber: "2",
        subPart: null,
        section: "Section A",
        text: "State Ohm's law.",
        maxMarks: null,
      },
    ]),
    1,
  );
  assert(noMarks[0].maxMarks === undefined, "questions: null maxMarks omitted");

  const continuation = parseQuestionsJson(
    JSON.stringify([
      {
        displayNumber: null,
        subPart: "b",
        section: null,
        text: "List two factors that affect the rate of photosynthesis.",
        maxMarks: 2,
      },
    ]),
    2,
  );
  assert(continuation.length === 1, "questions: continuation sub-part without number kept");
  assert(continuation[0].subPart === "b", "questions: continuation subPart");
  assert(continuation[0].page === 2, "questions: continuation page");
  assert(continuation[0].maxMarks === 2, "questions: continuation maxMarks");

  const stringNull = parseQuestionsJson(
    JSON.stringify([
      {
        displayNumber: "null",
        subPart: "b",
        text: "Calculate the heat required to raise the temperature of water.",
        maxMarks: 3,
      },
    ]),
    2,
  );
  assert(stringNull.length === 1, "questions: string 'null' displayNumber kept as continuation");
  assert(stringNull[0].subPart === "b", "questions: string-null subPart");
  assert(
    stringNull[0].displayNumber === "(b)",
    "questions: string 'null' becomes continuation placeholder",
  );

  assert(
    questionIdFromParts("Section A", "1", undefined) !==
      questionIdFromParts("Section C", "1", undefined),
    "duplicate numbering across sections must not collide",
  );

  console.log("[test-parse] question parser edge cases passed");
}

runParseTests();
runQuestionParseTests();
