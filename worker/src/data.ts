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
