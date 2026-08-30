import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listGeminiApiKeys, requireGeminiApiKeys } from "./gemini-keys";

describe("listGeminiApiKeys", () => {
  it("reads numbered keys in order and skips blanks", () => {
    assert.deepEqual(
      listGeminiApiKeys({
        GEMINI_API_KEY: " one ",
        GEMINI_API_KEY_2: "",
        GEMINI_API_KEY_3: "two",
        GEMINI_API_KEY_4: "three",
      }),
      ["one", "two", "three"],
    );
  });

  it("dedupes repeats", () => {
    assert.deepEqual(
      listGeminiApiKeys({
        GEMINI_API_KEY: "a",
        GEMINI_API_KEY_2: "a",
        GEMINI_API_KEYS: "a, b",
      }),
      ["a", "b"],
    );
  });

  it("reads Vercel vedaa_0 / vedaa1 aliases", () => {
    assert.deepEqual(
      listGeminiApiKeys({
        vedaa_0: " first ",
        vedaa1: "second",
        vedaa_2: "third",
      }),
      ["first", "second", "third"],
    );
  });

  it("throws when none are set", () => {
    assert.throws(() => requireGeminiApiKeys({}), /GEMINI_API_KEY is not set/);
  });
});
