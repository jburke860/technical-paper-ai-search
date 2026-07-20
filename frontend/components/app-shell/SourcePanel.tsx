"use client";

import { useState } from "react";
import { CloseIcon, CopyIcon, ExternalIcon, FileIcon } from "@/components/icons";
import type { SearchResult } from "@/app/types";

type SourcePanelProps = {
  source: SearchResult | null;
  sourceCount: number;
  open: boolean;
  onClose: () => void;
};

export function SourcePanel({ source, sourceCount, open, onClose }: SourcePanelProps) {
  const [copiedSourceId, setCopiedSourceId] = useState<string | null>(null);
  const copied = copiedSourceId === source?.id;

  async function copyCitation() {
    if (!source) return;
    const authors = source.authors.join(", ");
    await navigator.clipboard.writeText(`${authors} (${source.year}). ${source.title}. p. ${source.page}.`);
    setCopiedSourceId(source.id);
    window.setTimeout(() => setCopiedSourceId(null), 1600);
  }

  return (
    <>
      <button
        className={`drawer-scrim source-scrim ${open ? "is-open" : ""}`}
        onClick={onClose}
        aria-label="Close sources"
        tabIndex={open ? 0 : -1}
      />
      <aside id="sources" className={`source-panel ${open ? "is-open" : ""}`} aria-label="Selected source">
        <div className="source-panel-heading">
          <div><p className="eyebrow">Source preview</p><h2>{sourceCount ? `${sourceCount} retrieved` : "No source selected"}</h2></div>
          <button className="icon-button source-close" onClick={onClose} aria-label="Close sources"><CloseIcon /></button>
        </div>

        {source ? (
          <div className="source-detail">
            <div className="document-preview" aria-hidden="true">
              <div className="preview-paper">
                <span className="preview-kicker">{source.section}</span>
                <strong>{source.title}</strong>
                <i /> <i /> <i className="short" />
                <mark>{source.snippet.slice(0, 180)}</mark>
                <i /> <i className="short" />
              </div>
            </div>
            <div className="source-meta">
              <span className="source-number">01</span>
              <p className="eyebrow">Page {source.page}</p>
              <h3>{source.title}</h3>
              <p>{source.authors.slice(0, 3).join(", ")}{source.authors.length > 3 ? " et al." : ""} · {source.year}</p>
            </div>
            <p className="source-snippet">{source.snippet}</p>
            <div className="source-actions">
              <button className="secondary-button" onClick={copyCitation}><CopyIcon /> {copied ? "Copied" : "Copy citation"}</button>
              <a className="secondary-button" href={source.source_url ?? source.pdf_url} target="_blank" rel="noreferrer">Open source <ExternalIcon /></a>
            </div>
          </div>
        ) : (
          <div className="source-empty">
            <span><FileIcon /></span>
            <h3>Sources stay verifiable</h3>
            <p>Run a search to inspect the exact paper, section, and page behind each result.</p>
          </div>
        )}
      </aside>
    </>
  );
}
