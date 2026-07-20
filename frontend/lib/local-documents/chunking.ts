import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
  MAX_CHUNKS,
  MIN_CHUNK_CHARS,
} from "./limits";
import type { LocalChunk } from "./types";

export type PageText = {
  page: number;
  text: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitSegments(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9("[])/);
  const segments: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= CHUNK_MAX_CHARS) {
      segments.push(sentence);
      continue;
    }
    // A single run-on sentence longer than a whole chunk gets hard-split.
    for (let start = 0; start < sentence.length; start += CHUNK_TARGET_CHARS) {
      segments.push(sentence.slice(start, start + CHUNK_TARGET_CHARS));
    }
  }
  return segments;
}

export function chunkPages(
  documentId: string,
  pages: PageText[],
): { chunks: LocalChunk[]; truncated: boolean } {
  const chunks: LocalChunk[] = [];
  let truncated = false;

  for (const { page, text } of pages) {
    const normalized = normalizeWhitespace(text);
    if (normalized.length < MIN_CHUNK_CHARS) continue;

    let current = "";
    // True while `current` holds only overlap text already emitted in the
    // previous chunk, so a trailing remainder is not duplicated as its own chunk.
    let bareOverlap = false;
    const flush = () => {
      const passage = current.trim();
      current = "";
      if (passage.length < MIN_CHUNK_CHARS) return;
      if (chunks.length >= MAX_CHUNKS) {
        truncated = true;
        return;
      }
      chunks.push({
        id: `${documentId}-p${String(page).padStart(3, "0")}-c${String(chunks.length).padStart(3, "0")}`,
        page,
        text: passage,
      });
    };

    for (const segment of splitSegments(normalized)) {
      if (chunks.length >= MAX_CHUNKS) {
        truncated = true;
        break;
      }
      if (current.length + segment.length + 1 > CHUNK_MAX_CHARS && current) {
        const overlap = current.slice(-CHUNK_OVERLAP_CHARS);
        flush();
        current = `${overlap} ${segment}`.trim();
      } else {
        current = current ? `${current} ${segment}` : segment;
      }
      bareOverlap = false;
      if (current.length >= CHUNK_TARGET_CHARS) {
        const overlap = current.slice(-CHUNK_OVERLAP_CHARS);
        flush();
        current = overlap;
        bareOverlap = true;
      }
    }
    if (!bareOverlap) flush();
    if (truncated) break;
  }

  return { chunks, truncated };
}
