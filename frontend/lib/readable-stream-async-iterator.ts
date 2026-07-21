// Release Safari does not yet implement async iteration on ReadableStream,
// but PDF.js relies on it (`for await (const chunk of streamTextContent())`),
// which crashed local-document indexing for every Safari visitor. Import this
// module before pdfjs-dist in any context that loads it.

type StreamPrototype = ReadableStream & {
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

if (!(ReadableStream.prototype as StreamPrototype)[Symbol.asyncIterator]) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value(this: ReadableStream): AsyncIterator<unknown> {
      const reader = this.getReader();
      return {
        next: () => reader.read() as Promise<IteratorResult<unknown>>,
        return: async (value?: unknown) => {
          await reader.cancel();
          reader.releaseLock();
          return { done: true, value };
        },
      };
    },
  });
}

export {};
