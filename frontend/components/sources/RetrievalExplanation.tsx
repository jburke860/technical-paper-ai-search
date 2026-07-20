import type { SearchResult } from "@/app/types";

type RetrievalExplanationProps = {
  source: SearchResult;
};

function contribution(value: number): string {
  return value.toFixed(5);
}

export function RetrievalExplanation({ source }: RetrievalExplanationProps) {
  const explanation = source.retrieval_explanation;
  if (!explanation) return null;
  const foundBy = explanation.found_by === "both"
    ? "Found independently by both retrievers"
    : `Found by ${explanation.found_by} retrieval`;

  return (
    <details className="why-source">
      <summary>
        <span><i>?</i><strong>Why this source?</strong></span>
        <small>Rank #{explanation.final_rank}</small>
      </summary>
      <div className="explanation-body">
        <p className="retriever-agreement"><span className={explanation.found_by} />{foundBy}</p>
        <div className="rank-contributions">
          <div>
            <span>Semantic</span>
            <strong>{explanation.semantic.rank === null ? "Not found" : `Rank #${explanation.semantic.rank}`}</strong>
            <small>{contribution(explanation.semantic.contribution)} RRF contribution</small>
          </div>
          <b>+</b>
          <div>
            <span>Keyword</span>
            <strong>{explanation.keyword.rank === null ? "Not found" : `Rank #${explanation.keyword.rank}`}</strong>
            <small>{contribution(explanation.keyword.contribution)} RRF contribution</small>
          </div>
          <b>=</b>
          <div className="combined-rank">
            <span>Combined</span>
            <strong>{contribution(source.rrf_score)}</strong>
            <small>Final RRF score</small>
          </div>
        </div>
        <div className="matched-concepts">
          <p>Query concepts present in this passage</p>
          {explanation.matched_concepts.length ? (
            <div>{explanation.matched_concepts.map((concept) => <span key={concept}>{concept}</span>)}</div>
          ) : <small>No exact query terms; this result was retrieved semantically.</small>}
        </div>
        <p className="formula-note">
          Each contribution is <code>1 / ({explanation.rrf_constant} + rank)</code>. Scores order sources; they are not confidence probabilities.
        </p>
      </div>
    </details>
  );
}
