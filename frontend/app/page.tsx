"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-shell/AppHeader";
import { LibrarySidebar } from "@/components/app-shell/LibrarySidebar";
import { SourcePanel } from "@/components/app-shell/SourcePanel";
import { ArrowIcon, CheckIcon, SearchIcon, SparkIcon } from "@/components/icons";
import type { Paper, SearchResult, StatusResponse } from "@/app/types";

type SearchResponse = { question: string; results: SearchResult[] };
type AnswerResponse = { question: string; answer: string; sources: SearchResult[] };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const INITIAL_QUESTION = "What are the main challenges in autonomous systems?";

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as {
      message?: string;
      detail?: string;
      error?: { message?: string };
    };
    return payload.message ?? payload.error?.message ?? payload.detail ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export default function Home() {
  const [question, setQuestion] = useState(INITIAL_QUESTION);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedSource, setSelectedSource] = useState<SearchResult | null>(null);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"search" | "answer" | null>(null);
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadWorkspace() {
      const loadStatus = fetch(`${API_BASE_URL}/status`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Workspace status unavailable");
          setStatus(await response.json() as StatusResponse);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setStatusFailed(true);
        });
      const loadPapers = fetch(`${API_BASE_URL}/papers`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return;
          const payload = await response.json() as { papers: Paper[] };
          setPapers(payload.papers);
        })
        .catch(() => undefined);
      await Promise.all([loadStatus, loadPapers]);
    }
    void loadWorkspace();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function closeDrawers(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLibraryOpen(false);
        setSourcesOpen(false);
      }
    }
    window.addEventListener("keydown", closeDrawers);
    return () => window.removeEventListener("keydown", closeDrawers);
  }, []);

  const statusView = useMemo(() => {
    if (statusFailed) return { label: "Status unavailable", tone: "paused" as const };
    if (!status) return { label: "Checking system", tone: "loading" as const };
    if (status.quota.available) return { label: `${status.quota.remaining} questions left`, tone: "ready" as const };
    return { label: status.quota.code === "DEMO_DISABLED" ? "Hosted demo paused" : "Daily capacity reached", tone: "paused" as const };
  }, [status, statusFailed]);

  const isBusy = mode !== null;
  const hostedAvailable = !statusFailed && (status?.quota.available ?? false);

  async function runRequest(path: "/search" | "/answer") {
    if (!question.trim() || isBusy) return;
    setMode(path === "/search" ? "search" : "answer");
    setError("");
    setAnswer("");
    setResults([]);
    setSelectedSource(null);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), n_results: 5 }),
      });
      if (!response.ok) throw new Error(await responseError(response));

      if (path === "/answer") {
        const payload = await response.json() as AnswerResponse;
        setAnswer(payload.answer);
        setResults(payload.sources);
        setSelectedSource(payload.sources[0] ?? null);
      } else {
        const payload = await response.json() as SearchResponse;
        setResults(payload.results);
        setSelectedSource(payload.results[0] ?? null);
      }

      const remaining = response.headers.get("X-Demo-Remaining");
      if (remaining && status) {
        setStatus({ ...status, quota: { ...status.quota, remaining: Number(remaining) } });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The research request failed.");
    } finally {
      setMode(null);
    }
  }

  return (
    <div className="research-app">
      <AppHeader
        statusLabel={statusView.label}
        statusTone={statusView.tone}
        libraryOpen={libraryOpen}
        sourcesOpen={sourcesOpen}
        onOpenLibrary={() => setLibraryOpen(true)}
        onOpenSources={() => setSourcesOpen(true)}
      />

      <div className="workspace-grid">
        <LibrarySidebar
          papers={papers}
          chunkCount={status?.corpus.chunkCount ?? null}
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
        />

        <main id="workspace" className="research-workspace">
          <section className="workspace-intro">
            <div>
              <p className="eyebrow"><SparkIcon /> Source-grounded research</p>
              <h1>Ask your technical library</h1>
              <p>Search a curated collection with hybrid retrieval, then trace every result back to its paper and page.</p>
            </div>
            <dl className="corpus-stats" aria-label="Corpus statistics">
              <div><dt>Papers</dt><dd>{status?.corpus.paperCount ?? "—"}</dd></div>
              <div><dt>Passages</dt><dd>{status?.corpus.chunkCount ?? "—"}</dd></div>
              <div><dt>Retrieval</dt><dd>Hybrid</dd></div>
            </dl>
          </section>

          <section className="query-card" aria-labelledby="query-heading">
            <div className="query-label">
              <span><SearchIcon /></span>
              <label id="query-heading" htmlFor="research-question">Research question</label>
              <small>{question.length}/500</small>
            </div>
            <textarea
              id="research-question"
              value={question}
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about the library…"
            />
            <div className="query-actions">
              <p><CheckIcon /> Searches titles, sections, and paper text</p>
              <div>
                <button
                  className="secondary-button"
                  disabled={isBusy || !question.trim() || !hostedAvailable}
                  onClick={() => runRequest("/search")}
                >
                  {mode === "search" ? "Searching…" : "Find sources"}
                </button>
                <button
                  className="primary-button"
                  disabled={isBusy || !question.trim() || !hostedAvailable}
                  onClick={() => runRequest("/answer")}
                >
                  {mode === "answer" ? "Synthesizing…" : "Generate answer"} <ArrowIcon />
                </button>
              </div>
            </div>
          </section>

          {error && <div className="message error-message" role="alert"><strong>Research unavailable</strong><span>{error}</span></div>}

          {!hostedAvailable && status && (
            <div className="message paused-message" role="status">
              <strong>{status.quota.code === "DEMO_DISABLED" ? "The hosted demo is paused" : "Today’s demo capacity has been reached"}</strong>
              <span>The library remains available to explore. Hosted research resets at {new Date(status.quota.resetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" })}.</span>
            </div>
          )}

          {answer && (
            <section className="answer-card">
              <div className="section-heading"><div><p className="eyebrow"><SparkIcon /> Synthesized answer</p><h2>Answer from the library</h2></div><span>{results.length} sources</span></div>
              <p className="answer-copy">{answer}</p>
            </section>
          )}

          <section className="results-section" aria-live="polite">
            <div className="section-heading">
              <div><p className="eyebrow">Evidence</p><h2>{results.length ? "Supporting sources" : "Built for verifiable answers"}</h2></div>
              {results.length > 0 && <span>{results.length} of {results.length}</span>}
            </div>

            {results.length > 0 ? (
              <div className="result-list">
                {results.map((result, index) => (
                  <button
                    className={`result-card ${selectedSource?.id === result.id ? "is-selected" : ""}`}
                    key={result.id}
                    onClick={() => { setSelectedSource(result); setSourcesOpen(true); }}
                  >
                    <span className="result-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="result-body">
                      <span className="result-meta">{result.section} · Page {result.page}</span>
                      <strong>{result.title}</strong>
                      <span>{result.snippet}</span>
                    </span>
                    <ArrowIcon />
                  </button>
                ))}
              </div>
            ) : (
              <div id="method" className="method-grid">
                <article><span>01</span><h3>Hybrid retrieval</h3><p>Dense semantic search and BM25 keyword matching find complementary evidence.</p></article>
                <article><span>02</span><h3>Stable citations</h3><p>Every passage carries a real title, section, page number, and source URL.</p></article>
                <article><span>03</span><h3>Grounded synthesis</h3><p>Answers are constrained to retrieved context and keep citations visible.</p></article>
              </div>
            )}
          </section>
        </main>

        <SourcePanel
          source={selectedSource}
          sourceCount={results.length}
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
        />
      </div>
    </div>
  );
}
