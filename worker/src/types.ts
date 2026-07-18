export type CorpusChunk = {
  id: string;
  paper_id: string;
  document: string;
  title: string;
  authors: string[];
  year: number;
  page: number;
  section: string;
  pdf_url: string;
  source_url: string | null;
  topics: string[];
  text: string;
  token_estimate: number;
  content_hash: string;
};

export type Paper = {
  id: string;
  filename: string;
  title: string;
  authors: string[];
  year: number;
  topics: string[];
  source_url: string | null;
  pdf_url: string;
  include: boolean;
};

export type Bm25Data = {
  documentCount: number;
  averageDocumentLength: number;
  documentLengths: number[];
  k1: number;
  b: number;
  postings: Record<string, Array<[number, number]>>;
};

export type Manifest = {
  schemaVersion: number;
  paperCount: number;
  chunkCount: number;
  corpusSha256: string;
};

export type SearchResult = {
  id: string;
  paper_id: string;
  document: string;
  title: string;
  authors: string[];
  year: number;
  page: number;
  section: string;
  pdf_url: string;
  source_url: string | null;
  snippet: string;
  distance: null;
  vector_score: number | null;
  bm25_score: number | null;
  hybrid_score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
  rrf_score: number;
};

export interface Env {
  AI: Ai;
  VECTOR_INDEX: VectorizeIndex;
  DB: D1Database;
  ALLOWED_ORIGIN: string;
}

export type EmbeddingOutput = {
  shape: number[];
  data: number[][];
  pooling?: string;
};

export type GenerationOutput = {
  response?: string;
  usage?: Record<string, number>;
};
