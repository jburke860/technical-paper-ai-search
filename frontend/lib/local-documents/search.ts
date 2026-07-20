// Local hybrid retrieval over a visitor document. This mirrors the hosted
// Worker pipeline (worker/src/retrieval.ts): BM25 keyword ranking, semantic
// ranking, reciprocal-rank fusion with the same constant, same-page overlap
// deduplication, and the same reproducible retrieval explanation.

import type { SearchResult } from "@/app/types";
import type { LocalChunk, LocalDocumentMeta } from "./types";

const TOKEN_PATTERN = /[a-zA-Z0-9_+-]+/g;
const RRF_CONSTANT = 60;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const CANDIDATE_COUNT = 20;
const EXPLANATION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for",
  "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "to",
  "what", "when", "where", "which", "why", "with",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_PATTERN) ?? []).filter(Boolean);
}

export type LexicalIndex = {
  documentCount: number;
  averageDocumentLength: number;
  documentLengths: number[];
  postings: Map<string, Array<[number, number]>>;
};

export function buildLexicalIndex(chunks: LocalChunk[]): LexicalIndex {
  const documentLengths: number[] = [];
  const postings = new Map<string, Array<[number, number]>>();

  chunks.forEach((chunk, index) => {
    const tokens = tokenize(chunk.text);
    documentLengths.push(tokens.length);
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const [term, frequency] of frequencies) {
      const list = postings.get(term);
      if (list) list.push([index, frequency]);
      else postings.set(term, [[index, frequency]]);
    }
  });

  const totalLength = documentLengths.reduce((sum, length) => sum + length, 0);
  return {
    documentCount: chunks.length,
    averageDocumentLength: documentLengths.length ? totalLength / documentLengths.length : 0,
    documentLengths,
    postings,
  };
}

export type RankedCandidate = { index: number; score: number };

export function bm25Rank(
  index: LexicalIndex,
  question: string,
  limit = CANDIDATE_COUNT,
): RankedCandidate[] {
  const scores = new Map<number, number>();
  const queryTerms = new Set(tokenize(question));

  for (const term of queryTerms) {
    const termPostings = index.postings.get(term);
    if (!termPostings) continue;
    const documentFrequency = termPostings.length;
    const inverseDocumentFrequency = Math.log(
      1 + (index.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );
    for (const [documentIndex, termFrequency] of termPostings) {
      const documentLength = index.documentLengths[documentIndex];
      const denominator =
        termFrequency +
        BM25_K1 * (1 - BM25_B + BM25_B * (documentLength / index.averageDocumentLength));
      const score =
        inverseDocumentFrequency * ((termFrequency * (BM25_K1 + 1)) / denominator);
      scores.set(documentIndex, (scores.get(documentIndex) ?? 0) + score);
    }
  }

  return [...scores.entries()]
    .map(([candidateIndex, score]) => ({ index: candidateIndex, score }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit);
}

export function semanticRank(
  queryVector: Float32Array,
  embeddings: Float32Array[],
  limit = CANDIDATE_COUNT,
): RankedCandidate[] {
  // Vectors are L2-normalized at embedding time, so dot product is cosine.
  const scores = embeddings.map((embedding, index) => {
    let dot = 0;
    for (let i = 0; i < queryVector.length; i += 1) dot += queryVector[i] * embedding[i];
    return { index, score: dot };
  });
  return scores
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit);
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function matchedConcepts(question: string, text: string): string[] {
  const query = tokenize(question).filter(
    (term) => term.length > 2 && !EXPLANATION_STOP_WORDS.has(term),
  );
  const passage = tokenize(text);
  const passageTerms = new Set(passage);
  const passageText = ` ${passage.join(" ")} `;
  const concepts: string[] = [];

  for (let index = 0; index < query.length - 1; index += 1) {
    const phrase = `${query[index]} ${query[index + 1]}`;
    if (passageText.includes(` ${phrase} `) && !concepts.includes(phrase)) {
      concepts.push(phrase);
    }
  }
  for (const term of query) {
    if (passageTerms.has(term) && !concepts.some((concept) => concept.includes(term))) {
      concepts.push(term);
    }
  }
  return concepts.slice(0, 6);
}

export function fuseLocalResults(
  question: string,
  chunks: LocalChunk[],
  chunkMetas: LocalDocumentMeta[],
  semanticCandidates: RankedCandidate[] | null,
  keywordCandidates: RankedCandidate[],
  resultCount: number,
): SearchResult[] {
  const candidates = new Map<
    number,
    {
      chunk: LocalChunk;
      meta: LocalDocumentMeta;
      vectorRank: number | null;
      keywordRank: number | null;
      vectorScore: number | null;
      bm25Score: number | null;
      rrfScore: number;
    }
  >();

  (semanticCandidates ?? []).forEach((candidate, rankIndex) => {
    candidates.set(candidate.index, {
      chunk: chunks[candidate.index],
      meta: chunkMetas[candidate.index],
      vectorRank: rankIndex + 1,
      keywordRank: null,
      vectorScore: candidate.score,
      bm25Score: null,
      rrfScore: 1 / (RRF_CONSTANT + rankIndex + 1),
    });
  });

  keywordCandidates.forEach((candidate, rankIndex) => {
    const existing = candidates.get(candidate.index);
    if (existing) {
      existing.keywordRank = rankIndex + 1;
      existing.bm25Score = candidate.score;
      existing.rrfScore += 1 / (RRF_CONSTANT + rankIndex + 1);
    } else {
      candidates.set(candidate.index, {
        chunk: chunks[candidate.index],
        meta: chunkMetas[candidate.index],
        vectorRank: null,
        keywordRank: rankIndex + 1,
        vectorScore: null,
        bm25Score: candidate.score,
        rrfScore: 1 / (RRF_CONSTANT + rankIndex + 1),
      });
    }
  });

  const ranked = [...candidates.values()].sort(
    (left, right) =>
      right.rrfScore - left.rrfScore || left.chunk.id.localeCompare(right.chunk.id),
  );
  const deduplicated: typeof ranked = [];
  for (const candidate of ranked) {
    const duplicate = deduplicated.some(
      (existing) =>
        existing.meta.id === candidate.meta.id &&
        existing.chunk.page === candidate.chunk.page &&
        tokenJaccard(existing.chunk.text, candidate.chunk.text) >= 0.72,
    );
    if (!duplicate) deduplicated.push(candidate);
    if (deduplicated.length >= resultCount) break;
  }

  return deduplicated.map((candidate, index) => {
    const semanticContribution = candidate.vectorRank === null
      ? 0
      : 1 / (RRF_CONSTANT + candidate.vectorRank);
    const keywordContribution = candidate.keywordRank === null
      ? 0
      : 1 / (RRF_CONSTANT + candidate.keywordRank);
    const meta = candidate.meta;
    return {
      id: candidate.chunk.id,
      paper_id: meta.id,
      document: meta.fileName,
      title: meta.fileName,
      authors: ["Private local document"],
      year: new Date(meta.addedAt).getFullYear(),
      page: candidate.chunk.page,
      section: "Local passage",
      pdf_url: "",
      source_url: null,
      snippet: candidate.chunk.text,
      vector_score: candidate.vectorScore,
      bm25_score: candidate.bm25Score,
      hybrid_score: candidate.rrfScore,
      vector_rank: candidate.vectorRank,
      keyword_rank: candidate.keywordRank,
      rrf_score: candidate.rrfScore,
      retrieval_explanation: {
        final_rank: index + 1,
        rrf_constant: RRF_CONSTANT,
        found_by: candidate.vectorRank !== null && candidate.keywordRank !== null
          ? "both" as const
          : candidate.vectorRank !== null ? "semantic" as const : "keyword" as const,
        semantic: {
          rank: candidate.vectorRank,
          score: candidate.vectorScore,
          contribution: semanticContribution,
        },
        keyword: {
          rank: candidate.keywordRank,
          score: candidate.bm25Score,
          contribution: keywordContribution,
        },
        matched_concepts: matchedConcepts(question, candidate.chunk.text),
      },
    };
  });
}
