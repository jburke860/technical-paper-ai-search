import { describe, expect, it } from "vitest";
import {
  bm25Rank,
  buildLexicalIndex,
  fuseLocalResults,
  semanticRank,
  tokenize,
} from "./search";
import type { LocalChunk, LocalDocumentMeta } from "./types";

const META: LocalDocumentMeta = {
  id: "local-test",
  fileName: "sample.pdf",
  pageCount: 3,
  chunkCount: 3,
  characterCount: 300,
  embedded: true,
  truncated: false,
  persisted: false,
  addedAt: "2026-07-20T00:00:00.000Z",
};

const CHUNKS: LocalChunk[] = [
  { id: "local-test-p001-c000", page: 1, text: "Thermal control keeps the radiator margin inside its allowed band." },
  { id: "local-test-p002-c001", page: 2, text: "Star trackers feed the attitude estimator that stabilizes the platform." },
  { id: "local-test-p003-c002", page: 3, text: "Battery management balances charge cycles against eclipse duration." },
];

function vector(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("tokenize", () => {
  it("lowercases and keeps technical tokens", () => {
    expect(tokenize("BM25+RRF ranking, v2_final!")).toEqual(["bm25+rrf", "ranking", "v2_final"]);
  });
});

describe("bm25Rank", () => {
  it("ranks the passage containing the query terms first", () => {
    const index = buildLexicalIndex(CHUNKS);
    const ranked = bm25Rank(index, "radiator margin thermal");
    expect(ranked[0].index).toBe(0);
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("returns nothing for vocabulary absent from the document", () => {
    const index = buildLexicalIndex(CHUNKS);
    expect(bm25Rank(index, "quantum cryptography blockchain")).toHaveLength(0);
  });
});

describe("semanticRank", () => {
  it("orders passages by dot product against the query vector", () => {
    const ranked = semanticRank(vector([1, 0]), [vector([0.1, 0.9]), vector([0.95, 0.05]), vector([0.5, 0.5])]);
    expect(ranked.map((candidate) => candidate.index)).toEqual([1, 2, 0]);
  });
});

describe("fuseLocalResults", () => {
  it("reproduces the hosted RRF calculation and explanation", () => {
    const index = buildLexicalIndex(CHUNKS);
    const keyword = bm25Rank(index, "radiator margin");
    const semantic = [
      { index: 0, score: 0.9 },
      { index: 1, score: 0.5 },
    ];
    const results = fuseLocalResults("radiator margin", META, CHUNKS, semantic, keyword, 5);

    expect(results.length).toBeGreaterThan(0);
    results.forEach((result, position) => {
      const explanation = result.retrieval_explanation!;
      expect(explanation.final_rank).toBe(position + 1);
      expect(explanation.rrf_constant).toBe(60);
      expect(explanation.semantic.contribution + explanation.keyword.contribution)
        .toBeCloseTo(result.rrf_score, 10);
      expect(["both", "semantic", "keyword"]).toContain(explanation.found_by);
    });
    const top = results[0];
    expect(top.page).toBe(1);
    expect(top.retrieval_explanation!.found_by).toBe("both");
    expect(top.rrf_score).toBeCloseTo(1 / 61 + 1 / 61, 10);
    expect(top.retrieval_explanation!.matched_concepts).toContain("radiator margin");
  });

  it("labels keyword-only results when no embeddings are available", () => {
    const index = buildLexicalIndex(CHUNKS);
    const results = fuseLocalResults(
      "radiator margin",
      META,
      CHUNKS,
      null,
      bm25Rank(index, "radiator margin"),
      5,
    );
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.retrieval_explanation!.found_by).toBe("keyword");
      expect(result.vector_rank).toBeNull();
    }
  });

  it("deduplicates near-identical passages from the same page", () => {
    const nearDuplicates: LocalChunk[] = [
      { id: "a", page: 1, text: "The radiator margin analysis constrains the peak power budget of the onboard computer." },
      { id: "b", page: 1, text: "The radiator margin analysis constrains the peak power budget of the onboard computer today." },
      { id: "c", page: 2, text: "Star trackers feed the attitude estimator continuously." },
    ];
    const index = buildLexicalIndex(nearDuplicates);
    const results = fuseLocalResults(
      "radiator margin power",
      META,
      nearDuplicates,
      null,
      bm25Rank(index, "radiator margin power"),
      5,
    );
    const pageOneResults = results.filter((result) => result.page === 1);
    expect(pageOneResults).toHaveLength(1);
  });

  it("respects the requested result count", () => {
    const many: LocalChunk[] = Array.from({ length: 10 }, (_, index) => ({
      id: `chunk-${index}`,
      page: index + 1,
      text: `Passage ${index} discusses the radiator margin in a distinct unrelated context number ${index}.`,
    }));
    const index = buildLexicalIndex(many);
    const results = fuseLocalResults(
      "radiator margin",
      META,
      many,
      null,
      bm25Rank(index, "radiator margin"),
      3,
    );
    expect(results).toHaveLength(3);
  });
});
