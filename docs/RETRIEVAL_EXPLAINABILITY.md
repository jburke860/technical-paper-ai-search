# Retrieval Explainability

The hosted demo explains ranking with values produced by the retrieval pipeline.
It does not estimate answer confidence, factuality, or relevance probability.

## Candidate ranking

Each question creates two independently ordered candidate lists:

1. **Semantic retrieval** — Cloudflare Vectorize orders passages by the score
   returned for the BGE-small query embedding.
2. **Keyword retrieval** — the bundled BM25 index orders passages using `k1 =
   1.5` and `b = 0.75`.

The Worker combines those ordinal ranks using reciprocal-rank fusion (RRF):

```text
semantic contribution = semantic rank exists ? 1 / (60 + semantic rank) : 0
keyword contribution  = keyword rank exists  ? 1 / (60 + keyword rank)  : 0
RRF score             = semantic contribution + keyword contribution
```

For example, a passage ranked first semantically and second by BM25 receives:

```text
1 / (60 + 1) + 1 / (60 + 2) = 0.03252247
```

Candidates are sorted by that score. Near-duplicate passages on the same paper
page are then removed, and `final_rank` is assigned to the remaining response
order. The UI renders the response array in that order.

## Explanation fields

Every hosted result contains:

- final displayed rank;
- semantic rank, raw provider score, and RRF contribution;
- keyword rank, raw BM25 score, and RRF contribution;
- whether semantic retrieval, keyword retrieval, or both found the passage;
- normalized query unigrams and adjacent bigrams that occur exactly in the
  retrieved passage.

The matched concepts are deterministic lexical overlaps, not concepts invented
by a language model. A semantically retrieved passage can legitimately have no
exact matched concepts.

## Interpretation limits

- Vector and BM25 raw scores are not directly comparable.
- RRF uses ranks rather than attempting to calibrate those raw score scales.
- RRF score magnitude is not a probability or confidence percentage.
- A high rank does not prove that an answer is correct; visitors should inspect
  the cited passage and original page.
- The interface intentionally does not show an answer-confidence gauge or
  knowledge graph because neither is supported by the current evaluation.
