// Resource bounds for browser-local PDF processing. Every stage of the local
// pipeline must respect these so a large or malformed document cannot freeze
// the visitor's browser. Mirrors of hosted limits are noted where they must
// stay in sync with worker/src/index.ts and COST_GUARDRAILS.md.

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PAGE_COUNT = 200;
export const MAX_EXTRACTED_CHARS = 500_000;

export const MAX_CHUNKS = 400;
export const CHUNK_TARGET_CHARS = 1_100;
export const CHUNK_MAX_CHARS = 1_400;
export const CHUNK_OVERLAP_CHARS = 150;
export const MIN_CHUNK_CHARS = 40;

export const EMBED_BATCH_SIZE = 8;
export const LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export const EXTRACTION_TIMEOUT_MS = 60_000;
export const MODEL_LOAD_TIMEOUT_MS = 120_000;
export const EMBEDDING_TIMEOUT_MS = 240_000;
export const SEARCH_TIMEOUT_MS = 150_000;
export const PROCESS_HARD_LIMIT_MS = 6 * 60_000;

// A page needs this much text to count as extractable; below the ratio the
// document is treated as scanned or image-only.
export const SCANNED_MIN_CHARS_PER_PAGE = 20;
export const SCANNED_MIN_TEXT_PAGE_RATIO = 0.2;
export const MIN_TOTAL_EXTRACTED_CHARS = 200;

// Hosted synthesis bounds — must match worker/src/index.ts.
export const MAX_LOCAL_EXCERPTS = 5;
export const MAX_LOCAL_EXCERPT_CHARS = 800;
