// Dedicated Web Worker for browser-local PDF processing. The selected file is
// validated, parsed with PDF.js, chunked, and embedded entirely inside this
// worker; the document never leaves the visitor's browser. PDF.js runs in
// "fake worker" mode here because this scope is already off the main thread.

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { chunkPages, type PageText } from "./chunking";
import {
  EMBED_BATCH_SIZE,
  EMBEDDING_TIMEOUT_MS,
  EXTRACTION_TIMEOUT_MS,
  LOCAL_EMBEDDING_MODEL,
  MAX_EXTRACTED_CHARS,
  MAX_FILE_BYTES,
  MAX_PAGE_COUNT,
  MIN_TOTAL_EXTRACTED_CHARS,
  MODEL_LOAD_TIMEOUT_MS,
  SCANNED_MIN_CHARS_PER_PAGE,
  SCANNED_MIN_TEXT_PAGE_RATIO,
} from "./limits";
import {
  bm25Rank,
  buildLexicalIndex,
  fuseLocalResults,
  semanticRank,
  type LexicalIndex,
} from "./search";
import {
  clearPersistedDocument,
  readPersistedDocument,
  savePersistedDocument,
} from "./storage";
import type {
  LocalChunk,
  LocalDocumentError,
  LocalDocumentMeta,
  LocalProgress,
  WorkerRequest,
  WorkerResponse,
} from "./types";

type DocumentState = {
  meta: LocalDocumentMeta;
  chunks: LocalChunk[];
  embeddings: Float32Array[] | null;
  lexical: LexicalIndex;
  pdfBytes: ArrayBuffer;
};

let state: DocumentState | null = null;
let extractor: FeatureExtractionPipeline | null = null;
let modelUnavailable = false;
let cancelled = false;

class LocalPipelineError extends Error {
  code: LocalDocumentError["code"];

  constructor(code: LocalDocumentError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  (globalThis as unknown as {
    postMessage: (value: unknown, transfer?: Transferable[]) => void;
  }).postMessage(message, transfer);
}

function progress(requestId: string, value: LocalProgress): void {
  post({ type: "progress", requestId, progress: value });
}

function assertNotCancelled(): void {
  if (cancelled) {
    throw new LocalPipelineError("PROCESSING_CANCELLED", "Processing was cancelled.");
  }
}

function assertBeforeDeadline(deadline: number, stage: string): void {
  if (Date.now() > deadline) {
    throw new LocalPipelineError(
      "PROCESSING_TIMEOUT",
      `The ${stage} step exceeded its time limit. The document may be too complex for in-browser processing.`,
    );
  }
}

function looksLikePdf(bytes: ArrayBuffer): boolean {
  const header = new Uint8Array(bytes.slice(0, 1024));
  const text = new TextDecoder("ascii", { fatal: false }).decode(header);
  return text.includes("%PDF-");
}

async function extractPages(
  requestId: string,
  bytes: ArrayBuffer,
): Promise<{ pages: PageText[]; pageCount: number; characterCount: number }> {
  progress(requestId, { stage: "loading-parser", completed: 0, total: 1 });
  const pdfjs = await import("pdfjs-dist");
  // Registers globalThis.pdfjsWorker so PDF.js parses on this thread instead
  // of spawning a nested worker (unsupported in some browsers).
  await import("pdfjs-dist/build/pdf.worker.min.mjs");

  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes.slice(0)),
    verbosity: 0,
  });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      throw new LocalPipelineError(
        "ENCRYPTED_PDF",
        "This PDF is password protected. Remove the password and try again.",
      );
    }
    throw new LocalPipelineError(
      "MALFORMED_PDF",
      "This file could not be read as a PDF document.",
    );
  }

  try {
    if (document.numPages > MAX_PAGE_COUNT) {
      throw new LocalPipelineError(
        "TOO_MANY_PAGES",
        `This document has ${document.numPages} pages. The local mode supports up to ${MAX_PAGE_COUNT}.`,
      );
    }

    const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
    const pages: PageText[] = [];
    let characterCount = 0;
    let truncatedByCharacterCap = false;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      assertNotCancelled();
      assertBeforeDeadline(deadline, "text extraction");
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join(" ");
      page.cleanup();

      const available = MAX_EXTRACTED_CHARS - characterCount;
      const bounded = text.slice(0, Math.max(0, available));
      characterCount += bounded.length;
      pages.push({ page: pageNumber, text: bounded });
      progress(requestId, { stage: "extracting", completed: pageNumber, total: document.numPages });
      if (characterCount >= MAX_EXTRACTED_CHARS) {
        truncatedByCharacterCap = true;
        break;
      }
    }

    const textPages = pages.filter(
      (page) => page.text.replace(/\s+/g, "").length >= SCANNED_MIN_CHARS_PER_PAGE,
    ).length;
    if (
      characterCount < MIN_TOTAL_EXTRACTED_CHARS ||
      textPages / pages.length < SCANNED_MIN_TEXT_PAGE_RATIO
    ) {
      throw new LocalPipelineError(
        "NO_EXTRACTABLE_TEXT",
        "No selectable text was found. This PDF appears to be scanned or image-only, and OCR is not currently supported.",
      );
    }

    return {
      pages,
      pageCount: document.numPages,
      characterCount: truncatedByCharacterCap ? MAX_EXTRACTED_CHARS : characterCount,
    };
  } finally {
    await task.destroy();
  }
}

async function loadExtractor(requestId: string): Promise<FeatureExtractionPipeline | null> {
  if (extractor) return extractor;
  if (modelUnavailable) return null;

  progress(requestId, { stage: "loading-model", completed: 0, total: 100 });
  try {
    const transformers = await import("@huggingface/transformers");
    transformers.env.allowLocalModels = false;
    const loading = transformers.pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL, {
      dtype: "q8",
      progress_callback: (event) => {
        if (
          typeof event === "object" && event !== null &&
          "status" in event && event.status === "progress" &&
          "progress" in event && typeof event.progress === "number"
        ) {
          progress(requestId, {
            stage: "loading-model",
            completed: Math.min(99, Math.round(event.progress)),
            total: 100,
          });
        }
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Embedding model load timed out.")),
        MODEL_LOAD_TIMEOUT_MS,
      );
    });
    extractor = await Promise.race([loading, timeout]);
    progress(requestId, { stage: "loading-model", completed: 100, total: 100 });
    return extractor;
  } catch (error) {
    console.warn("Local embedding model unavailable; falling back to keyword search.", error);
    modelUnavailable = true;
    return null;
  }
}

async function embedTexts(
  requestId: string | null,
  pipeline: FeatureExtractionPipeline,
  texts: string[],
): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  const deadline = Date.now() + EMBEDDING_TIMEOUT_MS;

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    assertNotCancelled();
    assertBeforeDeadline(deadline, "embedding");
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const output = await pipeline(batch, { pooling: "mean", normalize: true });
    const [rows, dimensions] = output.dims;
    const data = output.data as Float32Array;
    for (let row = 0; row < rows; row += 1) {
      vectors.push(new Float32Array(data.slice(row * dimensions, (row + 1) * dimensions)));
    }
    output.dispose?.();
    if (requestId) {
      progress(requestId, {
        stage: "embedding",
        completed: Math.min(texts.length, start + batch.length),
        total: texts.length,
      });
    }
  }
  return vectors;
}

async function handleProcess(
  requestId: string,
  fileName: string,
  bytes: ArrayBuffer,
  persist: boolean,
): Promise<void> {
  cancelled = false;
  progress(requestId, { stage: "validating", completed: 0, total: 1 });
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new LocalPipelineError(
      "FILE_TOO_LARGE",
      `PDFs up to ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB are supported.`,
    );
  }
  if (!looksLikePdf(bytes)) {
    throw new LocalPipelineError("NOT_A_PDF", "Only PDF files are supported.");
  }

  const { pages, pageCount, characterCount } = await extractPages(requestId, bytes);

  assertNotCancelled();
  progress(requestId, { stage: "chunking", completed: 0, total: 1 });
  const documentId = `local-${crypto.randomUUID().slice(0, 8)}`;
  const { chunks, truncated } = chunkPages(documentId, pages);
  if (chunks.length === 0) {
    throw new LocalPipelineError(
      "NO_EXTRACTABLE_TEXT",
      "The extracted text was too fragmented to build searchable passages.",
    );
  }
  progress(requestId, { stage: "chunking", completed: 1, total: 1 });

  const pipeline = await loadExtractor(requestId);
  assertNotCancelled();
  let embeddings: Float32Array[] | null = null;
  if (pipeline) {
    embeddings = await embedTexts(requestId, pipeline, chunks.map((chunk) => chunk.text));
  }

  assertNotCancelled();
  progress(requestId, { stage: "indexing", completed: 0, total: 1 });
  const lexical = buildLexicalIndex(chunks);
  const meta: LocalDocumentMeta = {
    id: documentId,
    fileName,
    pageCount,
    chunkCount: chunks.length,
    characterCount,
    embedded: embeddings !== null,
    truncated,
    persisted: false,
    addedAt: new Date().toISOString(),
  };
  state = { meta, chunks, embeddings, lexical, pdfBytes: bytes };

  if (persist) {
    try {
      await savePersistedDocument({ meta: { ...meta, persisted: true }, chunks, embeddings, pdfBytes: bytes });
      state.meta = { ...meta, persisted: true };
    } catch {
      // Persistence is optional; the in-memory index still works.
    }
  }
  progress(requestId, { stage: "indexing", completed: 1, total: 1 });
  post({ type: "processed", requestId, meta: state.meta });
}

async function handleSearch(requestId: string, question: string, k: number): Promise<void> {
  if (!state) {
    throw new LocalPipelineError("NO_DOCUMENT", "No local document is indexed.");
  }
  cancelled = false;

  let semanticCandidates: ReturnType<typeof semanticRank> | null = null;
  if (state.embeddings) {
    // A restored document has stored passage vectors but the model may not be
    // loaded yet; the query itself still needs a local embedding.
    const pipeline = await loadExtractor(requestId);
    if (pipeline) {
      const [queryVector] = await embedTexts(null, pipeline, [question]);
      semanticCandidates = semanticRank(queryVector, state.embeddings);
    }
  }

  const results = fuseLocalResults(
    question,
    state.meta,
    state.chunks,
    semanticCandidates,
    bm25Rank(state.lexical, question),
    k,
  );
  post({ type: "results", requestId, results, embedded: semanticCandidates !== null });
}

async function handleRestore(requestId: string): Promise<void> {
  const persisted = await readPersistedDocument();
  if (!persisted) {
    post({ type: "restored", requestId, meta: null, pdfBytes: null });
    return;
  }
  state = {
    meta: { ...persisted.meta, persisted: true },
    chunks: persisted.chunks,
    embeddings: persisted.embeddings,
    lexical: buildLexicalIndex(persisted.chunks),
    pdfBytes: persisted.pdfBytes,
  };
  // Cloned (not transferred) so the worker keeps its copy for persistence.
  post({ type: "restored", requestId, meta: state.meta, pdfBytes: persisted.pdfBytes });
}

async function handleSetPersist(requestId: string, persist: boolean): Promise<void> {
  if (!state) {
    throw new LocalPipelineError("NO_DOCUMENT", "No local document is indexed.");
  }
  if (persist) {
    const meta = { ...state.meta, persisted: true };
    await savePersistedDocument({
      meta,
      chunks: state.chunks,
      embeddings: state.embeddings,
      pdfBytes: state.pdfBytes,
    });
    state.meta = meta;
  } else {
    await clearPersistedDocument();
    state.meta = { ...state.meta, persisted: false };
  }
  post({ type: "persistence", requestId, meta: state.meta });
}

async function handleRemove(requestId: string): Promise<void> {
  state = null;
  try {
    await clearPersistedDocument();
  } catch {
    // The store may be unavailable; in-memory state is already gone.
  }
  post({ type: "removed", requestId });
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  const { requestId } = message;
  void (async () => {
    try {
      if (message.type === "process") {
        await handleProcess(requestId, message.fileName, message.bytes, message.persist);
      } else if (message.type === "search") {
        await handleSearch(requestId, message.question, message.k);
      } else if (message.type === "restore") {
        await handleRestore(requestId);
      } else if (message.type === "setPersist") {
        await handleSetPersist(requestId, message.persist);
      } else if (message.type === "remove") {
        await handleRemove(requestId);
      }
    } catch (error) {
      const known = error instanceof LocalPipelineError;
      post({
        type: "error",
        requestId,
        error: {
          code: known ? error.code : "WORKER_FAILURE",
          message: known
            ? error.message
            : "Local document processing failed unexpectedly.",
        },
      });
    }
  })();
});
