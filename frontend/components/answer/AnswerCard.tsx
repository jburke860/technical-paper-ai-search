import { Fragment, useState } from "react";
import { CopyIcon, RefreshIcon, SparkIcon } from "@/components/icons";
import type { SearchResult, WorkflowStage } from "@/app/types";

type AnswerCardProps = {
  answer: string;
  sources: SearchResult[];
  stage: WorkflowStage;
  onCitation: (source: SearchResult) => void;
  onRetry: () => void;
};

function CitedAnswer({ answer, sources, onCitation }: Pick<AnswerCardProps, "answer" | "sources" | "onCitation">) {
  return answer.split(/(\[Source \d+\])/g).map((part, index) => {
    const match = part.match(/^\[Source (\d+)\]$/);
    if (!match) return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
    const source = sources[Number(match[1]) - 1];
    if (!source) return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
    return <button className="inline-citation" key={`${part}-${index}`} onClick={() => onCitation(source)} aria-label={`Open Source ${match[1]}: ${source.title}`}>{match[1]}</button>;
  });
}

export function AnswerCard({ answer, sources, stage, onCitation, onRetry }: AnswerCardProps) {
  const [copied, setCopied] = useState(false);
  const loadingLabel = stage === "retrieving" ? "Finding the strongest passages…" : "Synthesizing a grounded answer…";

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer);
    } catch {
      return; // Clipboard denied by the browser; keep the button state honest.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className={`answer-card ${stage ? "is-streaming" : ""}`} aria-live="polite" aria-busy={Boolean(stage)}>
      <div className="section-heading answer-heading">
        <div><p className="eyebrow"><SparkIcon /> Synthesized answer</p><h2>Answer from the library</h2></div>
        <div className="answer-actions">
          {answer && <button onClick={copyAnswer}><CopyIcon /> {copied ? "Copied" : "Copy"}</button>}
          {!stage && answer && <button onClick={onRetry}><RefreshIcon /> Retry</button>}
        </div>
      </div>
      {stage && !answer && (
        <div className="answer-loading">
          <span className="loading-orbit"><i /><i /><i /></span>
          <p>{loadingLabel}<small>Retrieval and generation can take a few seconds.</small></p>
        </div>
      )}
      {answer && <p className="answer-copy"><CitedAnswer answer={answer} sources={sources} onCitation={onCitation} /><span className={stage ? "stream-cursor" : ""} /></p>}
      {sources.length > 0 && <footer><span>{sources.length} supporting sources</span><span>Inline citations open exact evidence</span></footer>}
    </section>
  );
}
