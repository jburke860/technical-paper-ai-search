"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-shell/AppHeader";
import { LibrarySidebar } from "@/components/app-shell/LibrarySidebar";
import { SourcePanel } from "@/components/app-shell/SourcePanel";
import { AnswerCard } from "@/components/answer/AnswerCard";
import { QueryComposer } from "@/components/search/QueryComposer";
import { ResultList } from "@/components/sources/ResultList";
import { RefreshIcon, SparkIcon } from "@/components/icons";
import type {
  AnswerStreamEvent,
  HistoryEntry,
  Paper,
  SearchResult,
  StatusResponse,
  WorkflowStage,
} from "@/app/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const HISTORY_KEY = "technical-paper-ai-history-v1";
const INITIAL_QUESTION = "What safety and reliability challenges affect autonomous systems?";
const EXAMPLE_QUESTIONS = [
  "How does functional-level autonomy differ from system-level autonomy?",
  "How is deep learning applied to spacecraft pose estimation?",
  "Why do limited real datasets and synthetic images create a domain gap?",
];

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: string; detail?: string; error?: { message?: string } };
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
  const [stage, setStage] = useState<WorkflowStage>(null);
  const [error, setError] = useState("");
  const [sourceCount, setSourceCount] = useState(5);
  const [showDetails, setShowDetails] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let historyFrame = 0;
    async function loadWorkspace() {
      const loadStatus = fetch(`${API_BASE_URL}/status`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Workspace status unavailable");
          setStatus(await response.json() as StatusResponse);
          setStatusFailed(false);
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

    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        historyFrame = window.requestAnimationFrame(() => {
          setHistory(stored.slice(0, 8) as HistoryEntry[]);
        });
      }
    } catch {
      localStorage.removeItem(HISTORY_KEY);
    }

    return () => {
      controller.abort();
      window.cancelAnimationFrame(historyFrame);
      activeRequest.current?.abort();
    };
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

  const hostedAvailable = !statusFailed && (status?.quota.available ?? false);

  function updateRemaining(response: Response) {
    const remainingHeader = response.headers.get("X-Demo-Remaining");
    if (remainingHeader === null) return;
    const remaining = Number(remainingHeader);
    setStatus((current) => current ? {
      ...current,
      status: remaining > 0 ? "available" : "unavailable",
      quota: {
        ...current.quota,
        available: remaining > 0,
        code: remaining > 0 ? "AVAILABLE" : "DAILY_DEMO_LIMIT_REACHED",
        remaining,
      },
    } : current);
  }

  function saveHistory(entry: HistoryEntry) {
    setHistory((current) => {
      const updated = [entry, ...current.filter((item) => item.question !== entry.question)].slice(0, 8);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* local storage is optional */ }
      return updated;
    });
  }

  async function refreshStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/status`);
      if (!response.ok) throw new Error();
      setStatus(await response.json() as StatusResponse);
      setStatusFailed(false);
    } catch {
      setStatusFailed(true);
    }
  }

  async function askLibrary() {
    const submittedQuestion = question.trim();
    if (!submittedQuestion || stage || !hostedAvailable) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStage("retrieving");
    setError("");
    setAnswer("");
    setResults([]);
    setSelectedSource(null);
    let completeAnswer = "";
    let completeSources: SearchResult[] = [];
    let completed = false;

    try {
      const response = await fetch(`${API_BASE_URL}/answer/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion, n_results: sourceCount }),
        signal: controller.signal,
      });
      updateRemaining(response);
      if (!response.ok) {
        const message = await responseError(response);
        await refreshStatus();
        throw new Error(message);
      }
      if (!response.body) throw new Error("The browser could not open the answer stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function handleEvent(event: AnswerStreamEvent) {
        if (event.type === "sources") {
          completeSources = event.sources;
          setResults(event.sources);
          setSelectedSource(event.sources[0] ?? null);
        } else if (event.type === "stage") {
          setStage(event.stage);
        } else if (event.type === "delta") {
          completeAnswer += event.delta;
          setAnswer(completeAnswer);
        } else if (event.type === "done") {
          completed = true;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line) as AnswerStreamEvent);
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer) as AnswerStreamEvent);
      if (!completed || !completeAnswer.trim()) throw new Error("The answer stream ended before completion.");

      saveHistory({
        id: crypto.randomUUID(),
        question: submittedQuestion,
        answer: completeAnswer,
        sources: completeSources,
        createdAt: new Date().toISOString(),
      });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "The research request failed.");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setStage(null);
    }
  }

  function selectSource(source: SearchResult) {
    setSelectedSource(source);
    setSourcesOpen(true);
  }

  function restoreHistory(entry: HistoryEntry) {
    activeRequest.current?.abort();
    setQuestion(entry.question);
    setAnswer(entry.answer);
    setResults(entry.sources);
    setSelectedSource(entry.sources[0] ?? null);
    setError("");
    setStage(null);
  }

  return (
    <div className="research-app">
      <AppHeader statusLabel={statusView.label} statusTone={statusView.tone} libraryOpen={libraryOpen} sourcesOpen={sourcesOpen} onOpenLibrary={() => setLibraryOpen(true)} onOpenSources={() => setSourcesOpen(true)} />

      <div className="workspace-grid">
        <LibrarySidebar papers={papers} chunkCount={status?.corpus.chunkCount ?? null} history={history} open={libraryOpen} onClose={() => setLibraryOpen(false)} onSelectHistory={restoreHistory} />

        <main id="workspace" className="research-workspace">
          <section className="workspace-intro">
            <div>
              <p className="eyebrow"><SparkIcon /> Source-grounded research</p>
              <h1>Ask your technical library</h1>
              <p>Search a curated collection with hybrid retrieval, then trace every answer back to its paper and page.</p>
            </div>
            <dl className="corpus-stats" aria-label="Corpus statistics">
              <div><dt>Papers</dt><dd>{status?.corpus.paperCount ?? "—"}</dd></div>
              <div><dt>Passages</dt><dd>{status?.corpus.chunkCount ?? "—"}</dd></div>
              <div><dt>Retrieval</dt><dd>Hybrid</dd></div>
            </dl>
          </section>

          <QueryComposer question={question} examples={EXAMPLE_QUESTIONS} sourceCount={sourceCount} showDetails={showDetails} available={hostedAvailable} busy={Boolean(stage)} onQuestionChange={setQuestion} onSourceCountChange={setSourceCount} onShowDetailsChange={setShowDetails} onSubmit={askLibrary} />

          {error && (
            <div className="message error-message" role="alert">
              <div><strong>Research interrupted</strong><span>{error}</span></div>
              <button onClick={askLibrary} disabled={!hostedAvailable}><RefreshIcon /> Retry</button>
            </div>
          )}

          {!hostedAvailable && status && (
            <div className="message paused-message" role="status">
              <strong>{status.quota.code === "DEMO_DISABLED" ? "The hosted demo is paused" : "Today’s demo capacity has been reached"}</strong>
              <span>The library remains available to explore. Hosted research resets at {new Date(status.quota.resetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" })}.</span>
            </div>
          )}

          {(stage || answer) && <AnswerCard answer={answer} sources={results} stage={stage} onCitation={selectSource} onRetry={askLibrary} />}

          <section className="results-section" aria-live="polite">
            <div className="section-heading">
              <div><p className="eyebrow">Evidence</p><h2>{results.length ? "Supporting sources" : "Built for verifiable answers"}</h2></div>
              {results.length > 0 && <span>{results.length} sources</span>}
            </div>

            {results.length > 0 ? <ResultList results={results} selectedSource={selectedSource} showDetails={showDetails} onSelect={selectSource} /> : (
              <div id="method" className="method-grid">
                <article><span>01</span><h3>Hybrid retrieval</h3><p>Dense semantic search and BM25 keyword matching find complementary evidence.</p></article>
                <article><span>02</span><h3>Stable citations</h3><p>Every passage carries a real title, section, page number, and source URL.</p></article>
                <article><span>03</span><h3>Grounded synthesis</h3><p>Answers are constrained to retrieved context and keep citations visible.</p></article>
              </div>
            )}
          </section>
        </main>

        <SourcePanel source={selectedSource} sourceCount={results.length} open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
      </div>
    </div>
  );
}
