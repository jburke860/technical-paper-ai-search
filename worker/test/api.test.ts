import { describe, expect, it, vi } from "vitest";
import { fetchHandler } from "../src/index";
import type { Env } from "../src/types";

const MATCH_ID = "deep-space-autonomy-modeling-p001-1-introduction-c04";

function createEnv(): Env {
  const run = vi.fn(async (model: string) => {
    if (model.includes("bge-small")) {
      return { shape: [1, 384], data: [Array(384).fill(0.25)], pooling: "cls" };
    }
    return {
      response: "Functional-level autonomy addresses bounded subsystem tasks [Source 1].",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    };
  });
  const query = vi.fn(async () => ({
    count: 1,
    matches: [{ id: MATCH_ID, score: 0.95 }],
  }));

  return {
    AI: { run } as unknown as Ai,
    VECTOR_INDEX: { query } as unknown as VectorizeIndex,
    DB: {} as D1Database,
    ALLOWED_ORIGIN: "https://portfolio.example",
  };
}

function post(path: string, body: unknown, origin?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request(`https://demo.example${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("hosted Worker API", () => {
  it("reports real corpus and model status without inference", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      new Request("https://demo.example/api/status"),
      env,
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(payload.corpus.paperCount).toBe(3);
    expect(payload.corpus.chunkCount).toBe(262);
    expect(payload.models.embedding).toBe("@cf/baai/bge-small-en-v1.5");
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("returns only included paper metadata", async () => {
    const response = await fetchHandler(
      new Request("https://demo.example/api/papers"),
      createEnv(),
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(payload.count).toBe(3);
    expect(payload.papers.every((paper: Record<string, unknown>) => paper.include)).toBe(true);
  });

  it("runs embedding, Vectorize, BM25, and RRF for search", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      post("/api/search", {
        question: "How does functional-level autonomy differ from system-level autonomy?",
        n_results: 5,
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0].paper_id).toBe("deep-space-autonomy-modeling");
    expect(payload.results[0].rrf_score).toBeGreaterThan(0);
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    expect(env.VECTOR_INDEX.query).toHaveBeenCalledTimes(1);
  });

  it("returns a grounded answer with structured sources", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      post("/api/answer", {
        question: "How does functional-level autonomy differ from system-level autonomy?",
      }),
      env,
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(payload.answer).toContain("[Source 1]");
    expect(payload.sources[0].pdf_url).toContain("/pdfs/");
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid requests before inference", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      post("/api/search", { question: "", n_results: 500 }),
      env,
    );

    expect(response.status).toBe(422);
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(env.VECTOR_INDEX.query).not.toHaveBeenCalled();
  });

  it("rejects unapproved cross-origin requests", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      post("/api/search", { question: "Explain autonomy." }, "https://attacker.example"),
      env,
    );

    expect(response.status).toBe(403);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("returns a stable 503 contract when hosted inference fails", async () => {
    const env = createEnv();
    vi.mocked(env.AI.run).mockRejectedValueOnce(new Error("unavailable"));
    const response = await fetchHandler(
      post("/api/search", { question: "Explain autonomy." }),
      env,
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("HOSTED_INFERENCE_UNAVAILABLE");
  });
});
