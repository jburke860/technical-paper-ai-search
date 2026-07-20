import { ArrowIcon } from "@/components/icons";
import type { SearchResult } from "@/app/types";

type ResultListProps = {
  results: SearchResult[];
  selectedSource: SearchResult | null;
  showDetails: boolean;
  onSelect: (source: SearchResult) => void;
};

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

export function ResultList({ results, selectedSource, showDetails, onSelect }: ResultListProps) {
  return (
    <div className="result-list">
      {results.map((result, index) => (
        <button className={`result-card ${selectedSource?.id === result.id ? "is-selected" : ""}`} key={result.id} onClick={() => onSelect(result)}>
          <span className="result-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="result-body">
            <span className="result-meta">{result.section} · Page {result.page}</span>
            <strong>{result.title}</strong>
            <span>{result.snippet}</span>
            {showDetails && (
              <span className="retrieval-details">
                <i>Final rank {result.retrieval_explanation?.final_rank ?? index + 1}</i>
                <i>Semantic rank {result.retrieval_explanation?.semantic.rank ?? result.vector_rank ?? "—"}</i>
                <i>Keyword rank {result.retrieval_explanation?.keyword.rank ?? result.keyword_rank ?? "—"}</i>
                <i>RRF {score(result.rrf_score)}</i>
                {result.retrieval_explanation?.found_by === "both" && <i>Found by both</i>}
              </span>
            )}
          </span>
          <ArrowIcon />
        </button>
      ))}
    </div>
  );
}
