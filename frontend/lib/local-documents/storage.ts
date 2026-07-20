// Opt-in IndexedDB persistence for the visitor's local document. Everything
// stored here stays in the visitor's browser profile; nothing is transmitted.

import type { LocalChunk, LocalDocumentMeta } from "./types";

const DB_NAME = "technical-paper-local-docs-v1";
const STORE = "documents";
const DOCUMENT_KEY = "current";
const META_KEY = "current-meta";

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

export async function savePersistedDocument(document: PersistedDocument): Promise<void> {
  await withStore("readwrite", (store) => {
    store.put(document, DOCUMENT_KEY);
    store.put(document.meta, META_KEY);
  });
}

export async function readPersistedDocument(): Promise<PersistedDocument | null> {
  const value = await withStore<PersistedDocument>("readonly", (store) => store.get(DOCUMENT_KEY));
  return value ?? null;
}

export async function readPersistedMeta(): Promise<LocalDocumentMeta | null> {
  try {
    const value = await withStore<LocalDocumentMeta>("readonly", (store) => store.get(META_KEY));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function clearPersistedDocument(): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(DOCUMENT_KEY);
    store.delete(META_KEY);
  });
}
