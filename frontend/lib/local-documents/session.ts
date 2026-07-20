// Main-thread client for the local-document Web Worker. All heavy work
// (PDF parsing, chunking, embedding, search) happens inside the worker; this
// wrapper only correlates request/response messages and enforces hard
// timeouts so a stuck worker can never freeze the interface.

import type { SearchResult } from "@/app/types";
import { PROCESS_HARD_LIMIT_MS, SEARCH_TIMEOUT_MS } from "./limits";
import type {
  LocalDocumentError,
  LocalDocumentMeta,
  LocalProgress,
  RestoredDocument,
  WorkerRequest,
  WorkerResponse,
} from "./types";

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (error: LocalDocumentError) => void;
  timer: number;
};

export type LocalSearchOutcome = {
  results: SearchResult[];
  embedded: boolean;
};

const CANCEL_GRACE_MS = 3_000;

export class LocalDocumentSession {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  onProgress: ((progress: LocalProgress) => void) | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        this.onProgress?.(message.progress);
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      window.clearTimeout(pending.timer);
      if (message.type === "error") pending.reject(message.error);
      else pending.resolve(message);
    });
    worker.addEventListener("error", () => {
      this.failAll({ code: "WORKER_FAILURE", message: "The local processing worker crashed." });
      this.terminate();
    });
    this.worker = worker;
    return worker;
  }

  private failAll(error: LocalDocumentError): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request(
    message: Exclude<WorkerRequest, { type: "cancel" }>,
    timeoutMs: number,
    transfer?: Transferable[],
  ): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(message.requestId);
        this.terminate();
        reject({
          code: "PROCESSING_TIMEOUT",
          message: "Local processing took too long and was stopped to keep the page responsive.",
        } satisfies LocalDocumentError);
      }, timeoutMs);
      this.pending.set(message.requestId, { resolve, reject, timer });
      worker.postMessage(message, transfer ?? []);
    });
  }

  async process(file: File): Promise<{ meta: LocalDocumentMeta; metas: LocalDocumentMeta[] }> {
    const bytes = await file.arrayBuffer();
    const response = await this.request(
      {
        type: "process",
        requestId: crypto.randomUUID(),
        fileName: file.name,
        bytes,
        persist: false,
      },
      PROCESS_HARD_LIMIT_MS,
      [bytes],
    );
    if (response.type !== "processed") throw new Error("Unexpected worker response.");
    return { meta: response.meta, metas: response.metas };
  }

  async search(question: string, k: number): Promise<LocalSearchOutcome> {
    const response = await this.request(
      { type: "search", requestId: crypto.randomUUID(), question, k },
      SEARCH_TIMEOUT_MS,
    );
    if (response.type !== "results") throw new Error("Unexpected worker response.");
    return { results: response.results, embedded: response.embedded };
  }

  async restore(): Promise<RestoredDocument[]> {
    const response = await this.request(
      { type: "restore", requestId: crypto.randomUUID() },
      PROCESS_HARD_LIMIT_MS,
    );
    if (response.type !== "restored") throw new Error("Unexpected worker response.");
    return response.docs;
  }

  async setPersist(persist: boolean): Promise<LocalDocumentMeta[]> {
    const response = await this.request(
      { type: "setPersist", requestId: crypto.randomUUID(), persist },
      SEARCH_TIMEOUT_MS,
    );
    if (response.type !== "persistence") throw new Error("Unexpected worker response.");
    return response.metas;
  }

  async remove(docId: string | null): Promise<LocalDocumentMeta[]> {
    const response = await this.request(
      { type: "remove", requestId: crypto.randomUUID(), docId },
      SEARCH_TIMEOUT_MS,
    );
    if (response.type !== "removed") throw new Error("Unexpected worker response.");
    return response.metas;
  }

  // Cooperative cancel first; if the worker does not acknowledge by rejecting
  // the pending request within the grace period, it is terminated outright.
  cancel(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
    window.setTimeout(() => {
      if (this.pending.size > 0) {
        this.failAll({ code: "PROCESSING_CANCELLED", message: "Processing was cancelled." });
        this.terminate();
      }
    }, CANCEL_GRACE_MS);
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  dispose(): void {
    this.failAll({ code: "PROCESSING_CANCELLED", message: "The session was closed." });
    this.terminate();
  }
}
