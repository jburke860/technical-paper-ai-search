import { bm25Data, chunksById, corpus } from "./data";
import type { CorpusChunk, SearchResult } from "./types";

const TOKEN_PATTERN = /[a-zA-Z0-9_+-]+/g;
const RRF_CONSTANT = 60;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_PATTERN) ?? []).filter(Boolean);
}

export function bm25Search(question: string, limit = 20): Array<{
  index: number;
  score: number;
}> {
  const scores = new Map<number, number>();
  const queryTerms = new Set(tokenize(question));
  const { documentCount, averageDocumentLength, documentLengths, k1, b, postings } =
    bm25Data;

  for (const term of queryTerms) {
    const termPostings = postings[term];
    if (!termPostings) continue;
    const documentFrequency = termPostings.length;
    const inverseDocumentFrequency = Math.log(
      1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );

    for (const [documentIndex, termFrequency] of termPostings) {
      const documentLength = documentLengths[documentIndex];
      const denominator =
        termFrequency +
        k1 * (1 - b + b * (documentLength / averageDocumentLength));
      const score =
        inverseDocumentFrequency *
        ((termFrequency * (k1 + 1)) / denominator);
      scores.set(documentIndex, (scores.get(documentIndex) ?? 0) + score);
    }
  }

  return [...scores.entries()]
    .map(([index, score]) => ({ index, score }))
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

type VectorCandidate = { id: string; score: number };

export function fuseResults(
  vectorCandidates: VectorCandidate[],
  keywordCandidates: ReturnType<typeof bm25Search>,
  resultCount: number,
): SearchResult[] {
  const candidates = new Map<
    string,
    {
      chunk: CorpusChunk;
      vectorRank: number | null;
      keywordRank: number | null;
      vectorScore: number | null;
      bm25Score: number | null;
      rrfScore: number;
    }
  >();

  vectorCandidates.forEach((candidate, index) => {
    const chunk = chunksById.get(candidate.id);
    if (!chunk) return;
    candidates.set(candidate.id, {
      chunk,
      vectorRank: index + 1,
      keywordRank: null,
      vectorScore: candidate.score,
      bm25Score: null,
      rrfScore: 1 / (RRF_CONSTANT + index + 1),
    });
  });

  keywordCandidates.forEach((candidate, index) => {
    const chunk = corpus[candidate.index];
    const existing = candidates.get(chunk.id);
    if (existing) {
      existing.keywordRank = index + 1;
      existing.bm25Score = candidate.score;
      existing.rrfScore += 1 / (RRF_CONSTANT + index + 1);
    } else {
      candidates.set(chunk.id, {
        chunk,
        vectorRank: null,
        keywordRank: index + 1,
        vectorScore: null,
        bm25Score: candidate.score,
        rrfScore: 1 / (RRF_CONSTANT + index + 1),
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
        existing.chunk.paper_id === candidate.chunk.paper_id &&
        existing.chunk.page === candidate.chunk.page &&
        tokenJaccard(existing.chunk.text, candidate.chunk.text) >= 0.72,
    );
    if (!duplicate) deduplicated.push(candidate);
    if (deduplicated.length >= resultCount) break;
  }

  return deduplicated.map((candidate) => ({
    id: candidate.chunk.id,
    paper_id: candidate.chunk.paper_id,
    document: candidate.chunk.document,
    title: candidate.chunk.title,
    authors: candidate.chunk.authors,
    year: candidate.chunk.year,
    page: candidate.chunk.page,
    section: candidate.chunk.section,
    pdf_url: candidate.chunk.pdf_url,
    source_url: candidate.chunk.source_url,
    snippet: candidate.chunk.text,
    distance: null,
    vector_score: candidate.vectorScore,
    bm25_score: candidate.bm25Score,
    hybrid_score: candidate.rrfScore,
    vector_rank: candidate.vectorRank,
    keyword_rank: candidate.keywordRank,
    rrf_score: candidate.rrfScore,
  }));
}
