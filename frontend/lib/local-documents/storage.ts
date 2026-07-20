// Opt-in IndexedDB persistence for the visitor's local documents. Everything
// stored here stays in the visitor's browser profile; nothing is transmitted.

import type { LocalChunk, LocalDocumentMeta } from "./types";

const DB_NAME = "technical-paper-local-docs-v2";
const STORE = "documents";
const DOCUMENTS_KEY = "docs";
const METAS_KEY = "metas";

export type PersistedDocument = {
  meta: LocalDocumentMeta;
  chunks: LocalChunk[];
  embeddings: Float32Array[] | null;
  pdfBytes: ArrayBuffer;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB failure"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB aborted"));
    });
  } finally {
    database.close();
  }
}

export async function savePersistedDocuments(documents: PersistedDocument[]): Promise<void> {
  await withStore("readwrite", (store) => {
    store.put(documents, DOCUMENTS_KEY);
    store.put(documents.map((document) => document.meta), METAS_KEY);
  });
}

export async function readPersistedDocuments(): Promise<PersistedDocument[]> {
  const value = await withStore<PersistedDocument[]>("readonly", (store) => store.get(DOCUMENTS_KEY));
  return value ?? [];
}

export async function readPersistedMetas(): Promise<LocalDocumentMeta[]> {
  try {
    const value = await withStore<LocalDocumentMeta[]>("readonly", (store) => store.get(METAS_KEY));
    return value ?? [];
  } catch {
    return [];
  }
}

export async function clearPersistedDocuments(): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(DOCUMENTS_KEY);
    store.delete(METAS_KEY);
  });
}
