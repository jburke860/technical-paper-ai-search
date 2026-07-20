import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHandler } from "../src/index";
import type { Env } from "../src/types";
import { createMockD1 } from "./mock-d1";

const MATCH_ID = "deep-space-autonomy-modeling-p001-1-introduction-c04";

type EnvOptions = {
  db?: D1Database;
  enabled?: string;
  limit?: string;
};

function createEnv(options: EnvOptions = {}): Env {
  const run = vi.fn(async (model: string, input?: { stream?: boolean }) => {
    if (model.includes("bge-small")) {
      return { shape: [1, 384], data: [Array(384).fill(0.25)], pooling: "cls" };
    }
    if (input?.stream) {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"response":"Functional-level autonomy "}\n\n'));
          controller.enqueue(encoder.encode('data: {"response":"addresses bounded tasks [Source 1]."}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
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

  const quota = createMockD1();
  return {
    AI: { run } as unknown as Ai,
    VECTOR_INDEX: { query } as unknown as VectorizeIndex,
    DB: options.db ?? quota.db,
    ALLOWED_ORIGIN: "https://portfolio.example",
    DEMO_ENABLED: options.enabled ?? "true",
    DAILY_DEMO_LIMIT: options.limit ?? "200",
  };
}

function post(path: string, body: unknown, origin?: string, cookie?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  if (cookie) headers.set("Cookie", cookie);
  return new Request(`https://demo.example${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("Set-Cookie");
  expect(value).toContain("demo_session=");
  return value!.split(";", 1)[0];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(payload.status).toBe("available");
    expect(payload.quota.remaining).toBe(200);
    expect(response.headers.get("X-Demo-Remaining")).toBe("200");
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("returns only included paper metadata", async () => {
    const response = await fetchHandler(
      new Request("https://demo.example/api/papers"),
      createEnv({ enabled: "false" }),
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(payload.count).toBe(3);
    expect(payload.papers.every((paper: Record<string, unknown>) => paper.include)).toBe(true);
  });

  it("fails the status check closed when D1 is unavailable", async () => {
    const quota = createMockD1({ fail: true });
    const env = createEnv({ db: quota.db });
    const response = await fetchHandler(
      new Request("https://demo.example/api/status"),
      env,
    );
    const payload = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(503);
    expect(payload.code).toBe("QUOTA_CHECK_UNAVAILABLE");
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(env.VECTOR_INDEX.query).not.toHaveBeenCalled();
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
    payload.results.forEach((result: Record<string, any>, index: number) => {
      const explanation = result.retrieval_explanation;
      expect(explanation.final_rank).toBe(index + 1);
      expect(explanation.rrf_constant).toBe(60);
      expect(explanation.semantic.contribution + explanation.keyword.contribution)
        .toBeCloseTo(result.rrf_score, 10);
      expect(["both", "semantic", "keyword"]).toContain(explanation.found_by);
    });
    expect(payload.results[0].retrieval_explanation.matched_concepts.length).toBeGreaterThan(0);
    expect(response.headers.get("X-Demo-Remaining")).toBe("199");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
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

  it("streams sources before grounded answer tokens", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      post("/api/answer/stream", {
        question: "How does functional-level autonomy differ from system-level autonomy?",
      }),
      env,
    );
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(lines[0].type).toBe("sources");
    expect(lines[0].sources[0].paper_id).toBe("deep-space-autonomy-modeling");
    expect(lines.filter((event) => event.type === "delta").map((event) => event.delta).join(""))
      .toContain("[Source 1]");
    expect(lines.at(-1).type).toBe("done");
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });

  it("blocks the streaming route before any hosted compute", async () => {
    const env = createEnv({ enabled: "false" });
    const response = await fetchHandler(
      post("/api/answer/stream", { question: "Explain autonomy." }),
      env,
    );

    expect(response.status).toBe(503);
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(env.VECTOR_INDEX.query).not.toHaveBeenCalled();
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
    expect(response.headers.get("X-Demo-Remaining")).toBe("199");
  });

  it("fails closed before AI when either kill switch is off", async () => {
    const environmentOff = createEnv({ enabled: "false" });
    const envResponse = await fetchHandler(
      post("/api/search", { question: "Explain autonomy." }),
      environmentOff,
    );

    const control = createMockD1({ controlEnabled: false });
    const databaseOff = createEnv({ db: control.db });
    const dbResponse = await fetchHandler(
      post("/api/search", { question: "Explain autonomy." }),
      databaseOff,
    );

    expect(envResponse.status).toBe(503);
    expect((await envResponse.json() as Record<string, any>).code).toBe("DEMO_DISABLED");
    expect(dbResponse.status).toBe(503);
    expect((await dbResponse.json() as Record<string, any>).code).toBe("DEMO_DISABLED");
    expect(environmentOff.AI.run).not.toHaveBeenCalled();
    expect(databaseOff.AI.run).not.toHaveBeenCalled();
    expect(databaseOff.VECTOR_INDEX.query).not.toHaveBeenCalled();
  });

  it("stops all inference at the persisted global daily limit", async () => {
    const quota = createMockD1();
    const env = createEnv({ db: quota.db, limit: "2" });

    const first = await fetchHandler(post("/api/search", { question: "First question" }), env);
    const cookie = sessionCookie(first);
    const second = await fetchHandler(
      post("/api/search", { question: "Second question" }, undefined, cookie),
      env,
    );
    const blocked = await fetchHandler(
      post("/api/search", { question: "Third question" }, undefined, cookie),
      env,
    );
    const payload = (await blocked.json()) as Record<string, any>;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(blocked.status).toBe(503);
    expect(payload.code).toBe("DAILY_DEMO_LIMIT_REACHED");
    expect(payload.resetsAt).toMatch(/T00:00:00\.000Z$/);
    expect(env.AI.run).toHaveBeenCalledTimes(2);
    expect(env.VECTOR_INDEX.query).toHaveBeenCalledTimes(2);
    expect(quota.state.global.get(today())?.consumed).toBe(2);
  });

  it("keeps the global counter across Worker restarts", async () => {
    const quota = createMockD1();
    const firstWorker = createEnv({ db: quota.db, limit: "1" });
    const first = await fetchHandler(
      post("/api/search", { question: "Use the final slot" }),
      firstWorker,
    );
    const restartedWorker = createEnv({ db: quota.db, limit: "1" });
    const blocked = await fetchHandler(
      post("/api/search", { question: "Try after restart" }),
      restartedWorker,
    );

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(503);
    expect(restartedWorker.AI.run).not.toHaveBeenCalled();
    expect(restartedWorker.VECTOR_INDEX.query).not.toHaveBeenCalled();
  });

  it("fails closed when D1 is unavailable or the configured cap is unsafe", async () => {
    const quota = createMockD1({ fail: true });
    const unavailable = createEnv({ db: quota.db });
    const invalid = createEnv({ limit: "201" });

    const unavailableResponse = await fetchHandler(
      post("/api/answer", { question: "Explain autonomy." }),
      unavailable,
    );
    const invalidResponse = await fetchHandler(
      post("/api/answer", { question: "Explain autonomy." }),
      invalid,
    );

    expect((await unavailableResponse.json() as Record<string, any>).code).toBe(
      "QUOTA_CHECK_UNAVAILABLE",
    );
    expect((await invalidResponse.json() as Record<string, any>).code).toBe(
      "QUOTA_CONFIGURATION_INVALID",
    );
    expect(unavailable.AI.run).not.toHaveBeenCalled();
    expect(invalid.AI.run).not.toHaveBeenCalled();
  });

  it("enforces the per-browser burst limit before inference", async () => {
    const quota = createMockD1();
    const env = createEnv({ db: quota.db, limit: "20" });
    const first = await fetchHandler(post("/api/search", { question: "Question one" }), env);
    const cookie = sessionCookie(first);

    for (const question of ["Question two", "Question three"]) {
      const response = await fetchHandler(
        post("/api/search", { question }, undefined, cookie),
        env,
      );
      expect(response.status).toBe(200);
    }
    const blocked = await fetchHandler(
      post("/api/search", { question: "Question four" }, undefined, cookie),
      env,
    );

    expect(blocked.status).toBe(429);
    expect((await blocked.json() as Record<string, any>).code).toBe(
      "BROWSER_BURST_LIMIT_REACHED",
    );
    expect(env.AI.run).toHaveBeenCalledTimes(3);
    expect(env.VECTOR_INDEX.query).toHaveBeenCalledTimes(3);
  });

  it("enforces the per-browser daily limit across minute windows", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-07-18T12:00:00.000Z");
    vi.setSystemTime(start);
    const quota = createMockD1();
    const env = createEnv({ db: quota.db });
    const first = await fetchHandler(post("/api/search", { question: "Question 1" }), env);
    const cookie = sessionCookie(first);

    for (let number = 2; number <= 20; number += 1) {
      vi.setSystemTime(new Date(start.getTime() + number * 60_000));
      const response = await fetchHandler(
        post("/api/search", { question: `Question ${number}` }, undefined, cookie),
        env,
      );
      expect(response.status).toBe(200);
    }
    vi.setSystemTime(new Date(start.getTime() + 21 * 60_000));
    const blocked = await fetchHandler(
      post("/api/search", { question: "Question 21" }, undefined, cookie),
      env,
    );

    expect(blocked.status).toBe(429);
    expect((await blocked.json() as Record<string, any>).code).toBe(
      "BROWSER_DAILY_LIMIT_REACHED",
    );
    expect(env.AI.run).toHaveBeenCalledTimes(20);
  });

  it("streams hosted synthesis from bounded visitor excerpts without retrieval", async () => {
    const env = createEnv();
    const response = await fetchHandler(
      post("/api/answer/local/stream", {
        question: "What does the visitor document say about autonomy?",
        excerpts: [
          { label: "visitor.pdf", page: 3, text: "Functional-level autonomy addresses bounded tasks." },
          { label: "visitor.pdf", page: 4, text: "System-level autonomy coordinates subsystems." },
        ],
      }),
      env,
    );
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(lines[0]).toEqual({ type: "stage", stage: "synthesizing" });
    expect(lines.filter((event) => event.type === "delta").length).toBeGreaterThan(0);
    expect(lines.at(-1).type).toBe("done");
    expect(response.headers.get("X-Demo-Remaining")).toBe("199");
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    expect(env.VECTOR_INDEX.query).not.toHaveBeenCalled();
  });

  it("keeps visitor excerpts out of hosted retrieval and validates their bounds", async () => {
    const env = createEnv();
    const tooMany = await fetchHandler(
      post("/api/answer/local/stream", {
        question: "Summarize the document.",
        excerpts: Array.from({ length: 6 }, () => ({ text: "Excerpt." })),
      }),
      env,
    );
    const oversized = await fetchHandler(
      post("/api/answer/local/stream", {
        question: "Summarize the document.",
        excerpts: [{ text: "x".repeat(801) }],
      }),
      env,
    );
    const empty = await fetchHandler(
      post("/api/answer/local/stream", { question: "Summarize the document.", excerpts: [] }),
      env,
    );

    expect(tooMany.status).toBe(422);
    expect((await tooMany.json() as Record<string, any>).error.code).toBe("INVALID_EXCERPTS");
    expect(oversized.status).toBe(422);
    expect((await oversized.json() as Record<string, any>).error.code).toBe("INVALID_EXCERPT_TEXT");
    expect(empty.status).toBe(422);
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(env.VECTOR_INDEX.query).not.toHaveBeenCalled();
  });

  it("gates local-excerpt synthesis behind the same global quota", async () => {
    const disabled = createEnv({ enabled: "false" });
    const disabledResponse = await fetchHandler(
      post("/api/answer/local/stream", {
        question: "Summarize the document.",
        excerpts: [{ text: "Excerpt." }],
      }),
      disabled,
    );

    const quota = createMockD1();
    const env = createEnv({ db: quota.db, limit: "1" });
    const consumed = await fetchHandler(post("/api/search", { question: "Use the only slot" }), env);
    const blocked = await fetchHandler(
      post("/api/answer/local/stream", {
        question: "Summarize the document.",
        excerpts: [{ text: "Excerpt." }],
      }, undefined, sessionCookie(consumed)),
      env,
    );

    expect(disabledResponse.status).toBe(503);
    expect((await disabledResponse.json() as Record<string, any>).code).toBe("DEMO_DISABLED");
    expect(disabled.AI.run).not.toHaveBeenCalled();
    expect(blocked.status).toBe(503);
    expect((await blocked.json() as Record<string, any>).code).toBe("DAILY_DEMO_LIMIT_REACHED");
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it("resets quota on the next UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T23:59:00.000Z"));
    const quota = createMockD1();
    const env = createEnv({ db: quota.db, limit: "1" });
    const first = await fetchHandler(post("/api/search", { question: "Before midnight" }), env);
    const cookie = sessionCookie(first);
    const blocked = await fetchHandler(
      post("/api/search", { question: "Still before midnight" }, undefined, cookie),
      env,
    );
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
    const reset = await fetchHandler(
      post("/api/search", { question: "After midnight" }, undefined, cookie),
      env,
    );

    expect(blocked.status).toBe(503);
    expect(reset.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalledTimes(2);
    expect(quota.state.global.size).toBe(2);
  });
});
