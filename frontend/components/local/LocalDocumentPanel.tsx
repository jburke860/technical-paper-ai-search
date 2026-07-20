"use client";

import { useRef } from "react";
import { CloseIcon, FileIcon, RefreshIcon } from "@/components/icons";
import { MAX_FILE_BYTES, MAX_PAGE_COUNT } from "@/lib/local-documents/limits";
import type { LocalDocumentMeta, LocalProgress } from "@/lib/local-documents/types";

export type LocalPhase = "idle" | "processing" | "ready" | "error";

type LocalDocumentPanelProps = {
  phase: LocalPhase;
  meta: LocalDocumentMeta | null;
  progress: LocalProgress | null;
  error: string;
  persistedAvailable: boolean;
  hostedSynthesisEnabled: boolean;
  hostedAvailable: boolean;
  busy: boolean;
  onAddFile: (file: File) => void;
  onRestore: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onPersistChange: (persist: boolean) => void;
  onHostedSynthesisChange: (enabled: boolean) => void;
  onReset: () => void;
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
  phase,
  meta,
  progress,
  error,
  persistedAvailable,
  hostedSynthesisEnabled,
  hostedAvailable,
  busy,
  onAddFile,
  onRestore,
  onCancel,
  onRemove,
  onPersistChange,
  onHostedSynthesisChange,
  onReset,
}: LocalDocumentPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);

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
          <h2 id="local-doc-heading">Search your own PDF</h2>
        </div>
        {phase === "ready" && meta && (
          <button className="secondary-button" onClick={onRemove} disabled={busy}>
            <CloseIcon /> Remove document
          </button>
        )}
      </div>

      {phase === "idle" && (
        <div className="local-doc-empty">
          <p className="local-doc-lede">
            Your PDF is parsed, chunked, and indexed inside this browser tab.
            It is never uploaded or stored on any server.
          </p>
          <div className="local-doc-actions">
            <label className="primary-button local-file-button">
              Add a local PDF
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => handleFiles(event.target.files)}
              />
            </label>
            {persistedAvailable && (
              <button className="secondary-button" onClick={onRestore}>
                <RefreshIcon /> Restore saved document
              </button>
            )}
          </div>
          <ul className="local-doc-limits">
            <li>Up to {Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB and {MAX_PAGE_COUNT} pages</li>
            <li>Text-based PDFs only — scanned documents need OCR, which is not supported</li>
            <li>The embedding model (~25 MB) is downloaded once from a public CDN; your document is not part of that request</li>
          </ul>
        </div>
      )}

      {phase === "processing" && (
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

      {phase === "error" && (
        <div className="message error-message local-doc-error" role="alert">
          <div><strong>This document could not be indexed</strong><span>{error}</span></div>
          <button onClick={onReset}><RefreshIcon /> Try another file</button>
        </div>
      )}

      {phase === "ready" && meta && (
        <div className="local-doc-ready">
          <div className="local-doc-meta">
            <FileIcon />
            <div>
              <strong>{meta.fileName}</strong>
              <small>
                {meta.pageCount} pages · {meta.chunkCount} passages ·{" "}
                {meta.embedded ? "hybrid semantic + keyword search" : "keyword search only"}
                {meta.truncated ? " · long document truncated at the passage limit" : ""}
              </small>
              {!meta.embedded && (
                <small className="local-doc-warning">
                  The embedding model could not be loaded, so search uses keyword ranking only.
                </small>
              )}
            </div>
          </div>

          <div className="local-doc-toggles">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={meta.persisted}
                onChange={(event) => onPersistChange(event.target.checked)}
                disabled={busy}
              />
              <span /> Keep this document in this browser
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={hostedSynthesisEnabled}
                onChange={(event) => onHostedSynthesisChange(event.target.checked)}
                disabled={busy || !hostedAvailable}
              />
              <span /> Generate answers with the hosted model
            </label>
          </div>

          <p className="local-doc-privacy">
            {hostedSynthesisEnabled
              ? "Answers send only the few retrieved excerpts (never the file) to the quota-limited hosted model."
              : "Fully local: searches run in this tab and nothing about this document leaves your browser."}
            {!hostedAvailable && " Hosted synthesis is currently unavailable, so local search continues on its own."}
          </p>
        </div>
      )}
    </section>
  );
}
