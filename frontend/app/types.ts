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
  vector_score: number | null;
  bm25_score: number | null;
  hybrid_score: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  rrf_score: number;
};

export type QuotaStatus = {
  available: boolean;
  code: "AVAILABLE" | "DEMO_DISABLED" | "DAILY_DEMO_LIMIT_REACHED";
  limit: number;
  consumed: number;
  remaining: number;
  resetsAt: string;
};

export type StatusResponse = {
  status: "available" | "unavailable";
  corpus: {
    paperCount: number;
    chunkCount: number;
  };
  models: {
    embedding: string;
    generation: string;
  };
  quota: QuotaStatus;
};

export type HistoryEntry = {
  id: string;
  question: string;
  answer: string;
  sources: SearchResult[];
  createdAt: string;
};

export type WorkflowStage = "retrieving" | "synthesizing" | null;

export type AnswerStreamEvent =
  | { type: "sources"; question: string; sources: SearchResult[] }
  | { type: "stage"; stage: "synthesizing" }
  | { type: "delta"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };
