"use client";

import { useRef } from "react";
import { CloseIcon, FileIcon, RefreshIcon } from "@/components/icons";
import { MAX_FILE_BYTES, MAX_LOCAL_DOCUMENTS, MAX_PAGE_COUNT } from "@/lib/local-documents/limits";
import type { LocalDocumentMeta, LocalProgress } from "@/lib/local-documents/types";

type LocalDocumentPanelProps = {
  docs: LocalDocumentMeta[];
  busy: boolean;
  searchBusy: boolean;
  progress: LocalProgress | null;
  error: string;
  persistedAvailable: boolean;
  persistEnabled: boolean;
  hostedSynthesisEnabled: boolean;
  hostedAvailable: boolean;
  onAddFile: (file: File) => void;
  onRestore: () => void;
  onCancel: () => void;
  onRemoveDoc: (docId: string) => void;
  onPersistChange: (persist: boolean) => void;
  onHostedSynthesisChange: (enabled: boolean) => void;
  onDismissError: () => void;
};

const STAGE_LABELS: Record<LocalProgress["stage"], string> = {
  "validating": "Validating the file",
  "loading-parser": "Loading the PDF engine",
  "extracting": "Extracting text",
  "chunking": "Building searchable passages",
  "loading-model": "Loading the embedding model",
  "embedding": "Embedding passages",
  "indexing": "Finalizing the local index",
};

function progressLabel(progress: LocalProgress): string {
  const base = STAGE_LABELS[progress.stage];
  if (progress.stage === "extracting") return `${base} · page ${progress.completed} of ${progress.total}`;
  if (progress.stage === "embedding") return `${base} · ${progress.completed} of ${progress.total}`;
  if (progress.stage === "loading-model") return `${base} · ${progress.completed}%`;
  return base;
}

export function LocalDocumentPanel({
  docs,
  busy,
  searchBusy,
  progress,
  error,
  persistedAvailable,
  persistEnabled,
  hostedSynthesisEnabled,
  hostedAvailable,
  onAddFile,
  onRestore,
  onCancel,
  onRemoveDoc,
  onPersistChange,
  onHostedSynthesisChange,
  onDismissError,
}: LocalDocumentPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canAdd = !busy && docs.length < MAX_LOCAL_DOCUMENTS;

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onAddFile(file);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <section className="local-doc-panel" aria-labelledby="local-doc-heading">
      <div className="local-doc-heading">
        <div>
          <p className="eyebrow"><FileIcon /> Private document mode</p>
          <h2 id="local-doc-heading">Search your own PDFs</h2>
        </div>
        {docs.length > 0 && (
          <span className="local-doc-count">{docs.length} of {MAX_LOCAL_DOCUMENTS} documents</span>
        )}
      </div>

      {docs.length === 0 && !busy && (
        <p className="local-doc-lede">
          Your PDFs are parsed, chunked, and indexed inside this browser tab.
          It is never uploaded or stored on any server.
        </p>
      )}

      {docs.length > 0 && (
        <ul className="local-doc-list">
          {docs.map((doc) => (
            <li key={doc.id} className="local-doc-meta">
              <FileIcon />
              <div>
                <strong>{doc.fileName}</strong>
                <small>
                  {doc.pageCount} pages · {doc.chunkCount} passages ·{" "}
                  {doc.embedded ? "hybrid semantic + keyword search" : "keyword search only"}
                  {doc.truncated ? " · truncated at the passage limit" : ""}
                </small>
              </div>
              <button
                className="icon-button"
                onClick={() => onRemoveDoc(doc.id)}
                disabled={busy || searchBusy}
                aria-label={`Remove ${doc.fileName}`}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <div className="local-doc-progress" role="status" aria-live="polite">
          <p>{progress ? progressLabel(progress) : "Preparing…"}</p>
          <progress
            max={progress?.total || 1}
            value={progress?.completed ?? 0}
            aria-label={progress ? STAGE_LABELS[progress.stage] : "Processing"}
          />
          <button className="secondary-button" onClick={onCancel}>Cancel processing</button>
        </div>
      )}

      {error && !busy && (
        <div className="message error-message local-doc-error" role="alert">
          <div><strong>This document could not be indexed</strong><span>{error}</span></div>
          <button onClick={onDismissError}><RefreshIcon /> Try another file</button>
        </div>
      )}

      {!busy && (
        <div className="local-doc-actions">
          {canAdd && (
            <label className="primary-button local-file-button">
              Add a local PDF
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => handleFiles(event.target.files)}
              />
            </label>
          )}
          {persistedAvailable && docs.length === 0 && (
            <button className="secondary-button" onClick={onRestore}>
              <RefreshIcon /> Restore saved documents
            </button>
          )}
        </div>
      )}

      {docs.length === 0 && !busy && (
        <ul className="local-doc-limits">
          <li>Up to {MAX_LOCAL_DOCUMENTS} documents, each {Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB and {MAX_PAGE_COUNT} pages max</li>
          <li>Text-based PDFs only — scanned documents need OCR, which is not supported</li>
          <li>The embedding model (~25 MB) is downloaded once from a public CDN; your documents are not part of that request</li>
          <li>Answers use the hosted model by default (one daily question each, sending only retrieved excerpts) — switch it off after upload for fully local search</li>
        </ul>
      )}

      {docs.length > 0 && !busy && (
        <div className="local-doc-ready">
          <div className="local-doc-toggles">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={persistEnabled}
                onChange={(event) => onPersistChange(event.target.checked)}
                disabled={searchBusy}
              />
              <span /> Keep these documents in this browser
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={hostedSynthesisEnabled}
                onChange={(event) => onHostedSynthesisChange(event.target.checked)}
                disabled={searchBusy || !hostedAvailable}
              />
              <span /> Generate answers with the hosted model (uses daily questions)
            </label>
          </div>
          <p className="local-doc-privacy">
            {hostedSynthesisEnabled
              ? "Each answer sends only the few retrieved excerpts (never the files) to the quota-limited hosted model and uses one daily question."
              : "Fully local: searches run in this tab and nothing about these documents leaves your browser."}
            {!hostedAvailable && " Hosted synthesis is currently unavailable, so local search continues on its own."}
          </p>
        </div>
      )}
    </section>
  );
}
