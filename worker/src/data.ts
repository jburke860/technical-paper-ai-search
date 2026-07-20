import corpusJson from "./generated/corpus.json";
import bm25Json from "./generated/bm25.json";
import papersJson from "./generated/papers.json";
import manifestJson from "./generated/manifest.json";
import type { Bm25Data, CorpusChunk, Manifest, Paper } from "./types";

export const corpus = corpusJson as unknown as CorpusChunk[];
export const bm25Data = bm25Json as unknown as Bm25Data;
export const papers = papersJson as unknown as Paper[];
export const manifest = manifestJson as unknown as Manifest;

export const chunksById = new Map(corpus.map((chunk) => [chunk.id, chunk]));

// Vectorize limits vector ids to 64 bytes, shorter than some chunk ids, so
// vectors are stored under the chunk's sha256 content hash (exactly 64 hex
// chars, uniqueness enforced by evaluation/check_corpus_quality.py).
export const chunksByContentHash = new Map(
  corpus.map((chunk) => [chunk.content_hash, chunk]),
);
