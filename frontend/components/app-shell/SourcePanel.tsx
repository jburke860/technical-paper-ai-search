"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { CloseIcon, CopyIcon, ExternalIcon, FileIcon } from "@/components/icons";
import type { SearchResult } from "@/app/types";
import { RetrievalExplanation } from "@/components/sources/RetrievalExplanation";

type SourcePanelProps = {
  source: SearchResult | null;
  sourceCount: number;
  open: boolean;
  viewerOpen: boolean;
  onClose: () => void;
  onOpenViewer: () => void;
};

const PdfViewer = dynamic(() => import("@/components/documents/PdfViewer"), {
  ssr: false,
  loading: () => <div className="viewer-module-loading">Loading document viewer…</div>,
});

export function SourcePanel({ source, sourceCount, open, viewerOpen, onClose, onOpenViewer }: SourcePanelProps) {
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
            {viewerOpen ? (
              <PdfViewer key={`${source.id}-${source.page}`} url={source.pdf_url} initialPage={source.page} title={source.title} snippet={source.snippet} highlightBoxes={source.highlight_boxes} />
            ) : (
              <button className="document-preview" onClick={onOpenViewer} aria-label={`View page ${source.page} of ${source.title}`}>
                <div className="preview-paper" aria-hidden="true">
                  <span className="preview-kicker">{source.section}</span>
                  <strong>{source.title}</strong>
                  <i /> <i /> <i className="short" />
                  <mark>{source.snippet.slice(0, 180)}</mark>
                  <i /> <i className="short" />
                </div>
                <span className="preview-cta">View cited page {source.page}</span>
              </button>
            )}
            <div className="source-meta">
              <span className="source-number">01</span>
              <p className="eyebrow">Page {source.page}</p>
              <h3>{source.title}</h3>
              <p>{source.authors.slice(0, 3).join(", ")}{source.authors.length > 3 ? " et al." : ""} · {source.year}</p>
            </div>
            <p className="source-snippet">{source.snippet}</p>
            <RetrievalExplanation source={source} />
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
