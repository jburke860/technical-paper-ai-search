"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DownloadIcon, ExternalIcon, LeftIcon, MinusIcon, PlusIcon, RightIcon } from "@/components/icons";

type HighlightBox = { x: number; y: number; width: number; height: number };

type PdfViewerProps = {
  url: string;
  initialPage: number;
  title: string;
  snippet: string;
  highlightBoxes?: HighlightBox[];
};

export default function PdfViewer({ url, initialPage, title, snippet, highlightBoxes = [] }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageCount, setPageCount] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ url });
      loadedDocument = await task.promise;
      if (cancelled) {
        await loadedDocument.loadingTask.destroy();
        return;
      }
      setDocument(loadedDocument);
      setPageCount(loadedDocument.numPages);
      setPage(Math.min(Math.max(initialPage, 1), loadedDocument.numPages));
    }).catch(() => {
      if (!cancelled) {
        setError("This PDF could not be loaded. The source link remains available.");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      if (loadedDocument) void loadedDocument.loadingTask.destroy();
    };
  }, [initialPage, url]);

  useEffect(() => {
    if (!document || !canvasRef.current || containerWidth <= 0) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    void document.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const scale = Math.max(.35, ((containerWidth - 20) / baseViewport.width) * zoom);
      const viewport = pdfPage.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      setLoading(true);
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      return renderTask.promise;
    }).then(() => {
      if (!cancelled) setLoading(false);
    }).catch((caught: unknown) => {
      if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
        setError("This page could not be rendered. Open the original PDF to continue.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [containerWidth, document, page, zoom]);

  return (
    <section className="pdf-viewer" aria-label={`PDF viewer for ${title}`}>
      <div className="pdf-toolbar">
        <div className="page-controls">
          <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} aria-label="Previous page"><LeftIcon /></button>
          <span><strong>{page}</strong> / {pageCount || "—"}</span>
          <button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={!pageCount || page >= pageCount} aria-label="Next page"><RightIcon /></button>
        </div>
        <div className="zoom-controls">
          <button onClick={() => setZoom((current) => Math.max(.65, current - .15))} disabled={zoom <= .65} aria-label="Zoom out"><MinusIcon /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((current) => Math.min(1.75, current + .15))} disabled={zoom >= 1.75} aria-label="Zoom in"><PlusIcon /></button>
        </div>
        <div className="file-controls">
          <a href={url} target="_blank" rel="noreferrer" aria-label="Open original PDF"><ExternalIcon /></a>
          <a href={url} download aria-label="Download PDF"><DownloadIcon /></a>
        </div>
      </div>

      <div
        className="pdf-canvas-shell"
        ref={containerRef}
        tabIndex={0}
        role="region"
        aria-label={`Page ${page} of ${title}`}
      >
        {loading && !error && <div className="pdf-loading"><span /><p>Rendering cited page…</p></div>}
        {error ? <div className="pdf-error"><strong>Preview unavailable</strong><p>{error}</p><a href={url} target="_blank" rel="noreferrer">Open original PDF</a></div> : (
          <div className="pdf-page">
            <canvas ref={canvasRef} />
            {highlightBoxes.map((box, index) => (
              <mark key={index} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />
            ))}
          </div>
        )}
      </div>

      <div className="passage-evidence">
        <p>{highlightBoxes.length ? "Highlighted supporting passage" : "Supporting passage · text extraction"}</p>
        <blockquote>{snippet}</blockquote>
        {!highlightBoxes.length && <small>Position data is unavailable for this extraction, so the cited excerpt is shown below the exact page.</small>}
      </div>
    </section>
  );
}
