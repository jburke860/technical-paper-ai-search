import type { SearchResult } from "@/app/types";

export type LocalDocumentMeta = {
  id: string;
  fileName: string;
  pageCount: number;
  chunkCount: number;
  characterCount: number;
  embedded: boolean;
  truncated: boolean;
  persisted: boolean;
  addedAt: string;
};

export type LocalChunk = {
  id: string;
  page: number;
  text: string;
};

export type LocalProcessingStage =
  | "validating"
  | "loading-parser"
  | "extracting"
  | "chunking"
  | "loading-model"
  | "embedding"
  | "indexing";

export type LocalProgress = {
  stage: LocalProcessingStage;
  completed: number;
  total: number;
  detail?: string;
};

export type LocalErrorCode =
  | "FILE_TOO_LARGE"
  | "NOT_A_PDF"
  | "ENCRYPTED_PDF"
  | "MALFORMED_PDF"
  | "TOO_MANY_PAGES"
  | "NO_EXTRACTABLE_TEXT"
  | "NO_DOCUMENT"
  | "LOCAL_DOCUMENT_LIMIT"
  | "PROCESSING_TIMEOUT"
  | "PROCESSING_CANCELLED"
  | "WORKER_FAILURE";

export type LocalDocumentError = {
  code: LocalErrorCode;
  message: string;
};

export type WorkerRequest =
  | { type: "process"; requestId: string; fileName: string; bytes: ArrayBuffer; persist: boolean }
  | { type: "search"; requestId: string; question: string; k: number }
  | { type: "restore"; requestId: string }
  | { type: "setPersist"; requestId: string; persist: boolean }
  | { type: "remove"; requestId: string; docId: string | null }
  | { type: "cancel" };

export type RestoredDocument = {
  meta: LocalDocumentMeta;
  pdfBytes: ArrayBuffer;
};

export type WorkerResponse =
  | { type: "progress"; requestId: string; progress: LocalProgress }
  | { type: "processed"; requestId: string; meta: LocalDocumentMeta; metas: LocalDocumentMeta[] }
  | { type: "results"; requestId: string; results: SearchResult[]; embedded: boolean }
  | { type: "restored"; requestId: string; docs: RestoredDocument[] }
  | { type: "persistence"; requestId: string; metas: LocalDocumentMeta[] }
  | { type: "removed"; requestId: string; metas: LocalDocumentMeta[] }
  | { type: "error"; requestId: string; error: LocalDocumentError };
