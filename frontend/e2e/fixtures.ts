import type { Page } from "@playwright/test";

export const PAPER = {
  id: "autonomous-systems-and-ai",
  filename: "Autonomous-System-and-AI-content.pdf",
  title: "Autonomous Systems and Artificial Intelligence",
  authors: ["A. Researcher", "B. Engineer"],
  year: 2023,
  topics: ["autonomy", "safety"],
  source_url: null,
  pdf_url: "/pdfs/Autonomous-System-and-AI-content.pdf",
  include: true,
};

function explanation(rank: number, foundBy: "both" | "semantic" | "keyword") {
  const semanticRank = foundBy === "keyword" ? null : rank;
  const keywordRank = foundBy === "semantic" ? null : rank + 1;
  const semanticContribution = semanticRank === null ? 0 : 1 / (60 + semanticRank);
  const keywordContribution = keywordRank === null ? 0 : 1 / (60 + keywordRank);
  return {
    final_rank: rank,
    rrf_constant: 60,
    found_by: foundBy,
    semantic: { rank: semanticRank, score: semanticRank === null ? null : 0.9, contribution: semanticContribution },
    keyword: { rank: keywordRank, score: keywordRank === null ? null : 2.1, contribution: keywordContribution },
    matched_concepts: ["autonomy", "safety"],
  };
}

export function makeSource(rank: number, overrides: Record<string, unknown> = {}) {
  const foundBy = rank === 1 ? "both" as const : "keyword" as const;
  const explanationValue = explanation(rank, foundBy);
  return {
    id: `autonomous-systems-and-ai-p00${rank}-c0${rank}`,
    paper_id: PAPER.id,
    document: PAPER.filename,
    title: PAPER.title,
    authors: PAPER.authors,
    year: PAPER.year,
    page: rank + 1,
    section: `${rank}. Section`,
    pdf_url: PAPER.pdf_url,
    source_url: null,
    snippet: `Passage ${rank} covers fault detection budgets for the flight platform hardware.`,
    distance: null,
    vector_score: explanationValue.semantic.score,
    bm25_score: explanationValue.keyword.score,
    hybrid_score: explanationValue.semantic.contribution + explanationValue.keyword.contribution,
    vector_rank: explanationValue.semantic.rank,
    keyword_rank: explanationValue.keyword.rank,
    rrf_score: explanationValue.semantic.contribution + explanationValue.keyword.contribution,
    retrieval_explanation: explanationValue,
    ...overrides,
  };
}

export const SOURCES = [makeSource(1), makeSource(2), makeSource(3)];

export function statusPayload(overrides: Record<string, unknown> = {}, quotaOverrides: Record<string, unknown> = {}) {
  return {
    status: "available",
    runtime: "cloudflare-worker",
    corpus: { paperCount: 3, chunkCount: 262 },
    models: { embedding: "bge-small", generation: "llama" },
    quota: {
      available: true,
      code: "AVAILABLE",
      limit: 200,
      consumed: 5,
      remaining: 195,
      resetsAt: "2099-01-01T00:00:00.000Z",
      ...quotaOverrides,
    },
    ...overrides,
  };
}

export function answerStreamBody(deltas: string[], options: { done?: boolean; error?: string } = {}) {
  const events: unknown[] = [
    { type: "sources", question: "test", sources: SOURCES },
    { type: "stage", stage: "synthesizing" },
    ...deltas.map((delta) => ({ type: "delta", delta })),
  ];
  if (options.error) events.push({ type: "error", message: options.error });
  else if (options.done !== false) events.push({ type: "done" });
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export async function mockStatusAndPapers(
  page: Page,
  status: Record<string, unknown> = statusPayload(),
): Promise<void> {
  await page.route("**/api/status", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(status) }),
  );
  await page.route("**/api/papers", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ papers: [PAPER], count: 1 }) }),
  );
}

export async function mockAnswerStream(
  page: Page,
  body: string,
  options: { status?: number; remaining?: string } = {},
): Promise<void> {
  await page.route("**/api/answer/stream", (route) =>
    route.fulfill({
      status: options.status ?? 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Demo-Remaining": options.remaining ?? "194",
      },
      body,
    }),
  );
}
