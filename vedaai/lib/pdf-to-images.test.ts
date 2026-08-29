import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureReadableStreamAsyncIterator } from "./pdf-to-images";

describe("ensureReadableStreamAsyncIterator", () => {
  it("lets for-await consume a ReadableStream when asyncIterator was missing", async () => {
    const proto = ReadableStream.prototype as ReadableStream<unknown> & {
      [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
    };
    const original = proto[Symbol.asyncIterator];
    delete proto[Symbol.asyncIterator];

    try {
      ensureReadableStreamAsyncIterator();
      const stream = new ReadableStream<number>({
        start(controller) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
      });
      const values: number[] = [];
      for await (const value of stream as AsyncIterable<number>) {
        values.push(value);
      }
      assert.deepEqual(values, [1, 2]);
    } finally {
      if (original) proto[Symbol.asyncIterator] = original;
    }
  });
});
