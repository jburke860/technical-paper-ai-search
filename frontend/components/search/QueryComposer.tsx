import { ArrowIcon, CheckIcon, SearchIcon, SettingsIcon } from "@/components/icons";

type QueryComposerProps = {
  question: string;
  examples: string[];
  sourceCount: number;
  showDetails: boolean;
  available: boolean;
  busy: boolean;
  onQuestionChange: (question: string) => void;
  onSourceCountChange: (count: number) => void;
  onShowDetailsChange: (show: boolean) => void;
  onSubmit: () => void;
};

export function QueryComposer({
  question,
  examples,
  sourceCount,
  showDetails,
  available,
  busy,
  onQuestionChange,
  onSourceCountChange,
  onShowDetailsChange,
  onSubmit,
}: QueryComposerProps) {
  return (
    <>
      <section className="query-card" aria-labelledby="query-heading">
        <div className="query-label">
          <span><SearchIcon /></span>
          <label id="query-heading" htmlFor="research-question">Research question</label>
          <small>{question.length}/500</small>
        </div>
        <textarea
          id="research-question"
          value={question}
          maxLength={500}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSubmit();
          }}
          placeholder="Ask a question about the library…"
        />
        <div className="query-actions">
          <p><CheckIcon /> Hybrid retrieval with page-level citations</p>
          <button
            className="primary-button ask-button"
            disabled={busy || !question.trim() || !available}
            onClick={onSubmit}
          >
            {busy ? "Researching…" : "Ask the library"} <ArrowIcon />
          </button>
        </div>
        <details className="retrieval-settings">
          <summary><SettingsIcon /> Retrieval settings</summary>
          <div className="settings-row">
            <label>
              Supporting sources
              <select value={sourceCount} onChange={(event) => onSourceCountChange(Number(event.target.value))}>
                <option value={3}>3 sources</option>
                <option value={5}>5 sources</option>
              </select>
            </label>
            <label className="toggle-label">
              <input type="checkbox" checked={showDetails} onChange={(event) => onShowDetailsChange(event.target.checked)} />
              <span /> Show retrieval details
            </label>
            <p><strong>Hybrid · RRF</strong><span>Semantic and keyword ranks are fused deterministically.</span></p>
          </div>
        </details>
      </section>

      <div className="example-questions" aria-label="Example questions">
        <span>Try an example</span>
        {examples.map((example) => (
          <button key={example} onClick={() => onQuestionChange(example)} disabled={busy}>{example}</button>
        ))}
      </div>
    </>
  );
}
