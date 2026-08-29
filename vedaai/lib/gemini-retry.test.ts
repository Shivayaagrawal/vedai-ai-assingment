import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GeminiRateLimitError,
  backoffMsForAttempt,
  isGeminiRateLimitError,
  withRateLimitRetry,
} from "./gemini-retry";

describe("backoffMsForAttempt", () => {
  it("uses 20s then 40s", () => {
    assert.equal(backoffMsForAttempt(1), 20_000);
    assert.equal(backoffMsForAttempt(2), 40_000);
    assert.equal(backoffMsForAttempt(3), 40_000);
  });
});

describe("withRateLimitRetry", () => {
  it("returns on first success without sleeping", async () => {
    const sleeps: number[] = [];
    const result = await withRateLimitRetry(async () => "ok", {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(result, "ok");
    assert.deepEqual(sleeps, []);
  });

  it("waits then succeeds after a 429", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRateLimitRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new GeminiRateLimitError();
        return "recovered";
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    assert.equal(result, "recovered");
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [20_000]);
  });

  it("does not retry non-429 errors", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await assert.rejects(
      () =>
        withRateLimitRetry(
          async () => {
            calls += 1;
            throw new Error("timeout");
          },
          {
            sleep: async (ms) => {
              sleeps.push(ms);
            },
          },
        ),
      /timeout/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("throws GeminiRateLimitError after maxAttempts", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await assert.rejects(
      () =>
        withRateLimitRetry(
          async () => {
            calls += 1;
            throw new Error("429 RESOURCE_EXHAUSTED");
          },
          {
            maxAttempts: 3,
            sleep: async (ms) => {
              sleeps.push(ms);
            },
          },
        ),
      (error: unknown) => isGeminiRateLimitError(error),
    );
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [20_000, 40_000]);
  });

  it("detects RESOURCE_EXHAUSTED strings", () => {
    assert.equal(
      isGeminiRateLimitError(new Error("429 Too Many Requests RESOURCE_EXHAUSTED")),
      true,
    );
    assert.equal(isGeminiRateLimitError(new Error("timeout")), false);
  });
});
