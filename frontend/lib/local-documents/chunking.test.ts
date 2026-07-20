import { describe, expect, it } from "vitest";
import { chunkPages } from "./chunking";
import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  MAX_CHUNKS,
  MIN_CHUNK_CHARS,
} from "./limits";

const SENTENCE = "Spacecraft autonomy requires explicit models of every subsystem state. ";

describe("chunkPages", () => {
  it("keeps a short page as its own passage", () => {
    // Regression: pages shorter than the overlap window must still produce a chunk.
    const short = "Spacecraft thermal control keeps the radiator margin inside its allowed band.";
    expect(short.length).toBeLessThan(CHUNK_OVERLAP_CHARS);
    const { chunks, truncated } = chunkPages("doc", [{ page: 1, text: short }]);

    expect(truncated).toBe(false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page).toBe(1);
    expect(chunks[0].text).toContain("radiator margin");
  });

  it("drops empty and near-empty pages without failing", () => {
    const { chunks } = chunkPages("doc", [
      { page: 1, text: "" },
      { page: 2, text: "   \n \t " },
      { page: 3, text: "tiny" },
      { page: 4, text: SENTENCE.repeat(3) },
    ]);
    expect(chunks.every((chunk) => chunk.page === 4)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("bounds every passage and overlaps consecutive passages on long pages", () => {
    const { chunks } = chunkPages("doc", [{ page: 1, text: SENTENCE.repeat(120) }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS);
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
    for (let index = 1; index < chunks.length; index += 1) {
      const previousTail = chunks[index - 1].text.slice(-40);
      expect(chunks[index].text).toContain(previousTail.slice(0, 20));
    }
  });

  it("hard-splits a single run-on sentence longer than a chunk", () => {
    const runOn = "x".repeat(CHUNK_MAX_CHARS * 3);
    const { chunks } = chunkPages("doc", [{ page: 1, text: runOn }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= CHUNK_MAX_CHARS)).toBe(true);
  });

  it("stops at the chunk cap and reports truncation", () => {
    const pages = Array.from({ length: 600 }, (_, index) => ({
      page: index + 1,
      text: SENTENCE.repeat(30),
    }));
    const { chunks, truncated } = chunkPages("doc", pages);

    expect(truncated).toBe(true);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(chunks.length).toBe(MAX_CHUNKS);
  });

  it("assigns stable unique ids with ascending pages", () => {
    const { chunks } = chunkPages("doc", [
      { page: 1, text: SENTENCE.repeat(5) },
      { page: 2, text: SENTENCE.repeat(5) },
    ]);
    const ids = chunks.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("doc-p"))).toBe(true);
    const pages = chunks.map((chunk) => chunk.page);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });
});
