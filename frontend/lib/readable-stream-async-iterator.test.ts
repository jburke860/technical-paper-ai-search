import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulates release Safari, where ReadableStream has no async iterator, and
// verifies the polyfill restores `for await` support for PDF.js.

const NativeIterator = Object.getOwnPropertyDescriptor(
  ReadableStream.prototype,
  Symbol.asyncIterator,
);

function makeStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("readable-stream-async-iterator polyfill", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("restores for-await iteration when the native iterator is missing", async () => {
    delete (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator];
    expect(
      (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator],
    ).toBeUndefined();
    try {
      await import("./readable-stream-async-iterator");
      const collected: string[] = [];
      for await (const chunk of makeStream(["a", "b", "c"]) as unknown as AsyncIterable<string>) {
        collected.push(chunk);
      }
      expect(collected).toEqual(["a", "b", "c"]);
    } finally {
      if (NativeIterator) {
        Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, NativeIterator);
      }
    }
  });

  it("releases the reader lock when iteration stops early", async () => {
    delete (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator];
    try {
      await import("./readable-stream-async-iterator");
      const stream = makeStream(["a", "b", "c"]);
      for await (const chunk of stream as unknown as AsyncIterable<string>) {
        expect(chunk).toBe("a");
        break;
      }
      // A released lock means a new reader can be acquired without throwing.
      expect(() => stream.getReader()).not.toThrow();
    } finally {
      if (NativeIterator) {
        Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, NativeIterator);
      }
    }
  });

  it("leaves a native implementation untouched", async () => {
    if (!NativeIterator) return;
    Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, NativeIterator);
    await import("./readable-stream-async-iterator");
    expect(
      Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator)?.value,
    ).toBe(NativeIterator.value);
  });
});
