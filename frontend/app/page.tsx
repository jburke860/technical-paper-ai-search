"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-shell/AppHeader";
import { LibrarySidebar } from "@/components/app-shell/LibrarySidebar";
import { SourcePanel } from "@/components/app-shell/SourcePanel";
import { AnswerCard } from "@/components/answer/AnswerCard";
import { LocalDocumentPanel, type LocalPhase } from "@/components/local/LocalDocumentPanel";
import { QueryComposer } from "@/components/search/QueryComposer";
import { ResultList } from "@/components/sources/ResultList";
import { BookIcon, FileIcon, RefreshIcon, SparkIcon } from "@/components/icons";
import {
  MAX_FILE_BYTES,
  MAX_LOCAL_EXCERPTS,
  MAX_LOCAL_EXCERPT_CHARS,
} from "@/lib/local-documents/limits";
import { LocalDocumentSession } from "@/lib/local-documents/session";
import { readPersistedMeta } from "@/lib/local-documents/storage";
import type { LocalDocumentError, LocalDocumentMeta, LocalProgress } from "@/lib/local-documents/types";
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

type Collection = "curated" | "local";

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: string; detail?: string; error?: { message?: string } };
    return payload.message ?? payload.error?.message ?? payload.detail ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

function localErrorMessage(caught: unknown): { code: string; message: string } {
  if (caught && typeof caught === "object" && "code" in caught && "message" in caught) {
    const error = caught as LocalDocumentError;
    return { code: error.code, message: error.message };
  }
  if (caught instanceof Error) return { code: "WORKER_FAILURE", message: caught.message };
  return { code: "WORKER_FAILURE", message: "Local document processing failed unexpectedly." };
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
  const [viewerOpen, setViewerOpen] = useState(false);
  const [collection, setCollection] = useState<Collection>("curated");
  const [localPhase, setLocalPhase] = useState<LocalPhase>("idle");
  const [localMeta, setLocalMeta] = useState<LocalDocumentMeta | null>(null);
  const [localProgress, setLocalProgress] = useState<LocalProgress | null>(null);
  const [localError, setLocalError] = useState("");
  const [persistedAvailable, setPersistedAvailable] = useState(false);
  const [hostedSynthesis, setHostedSynthesis] = useState(false);
  const [localSearchMode, setLocalSearchMode] = useState<"hybrid" | "keyword" | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const localSession = useRef<LocalDocumentSession | null>(null);
  const localPdfUrlRef = useRef<string | null>(null);

  function getSession(): LocalDocumentSession {
    if (!localSession.current) {
      const session = new LocalDocumentSession();
      session.onProgress = setLocalProgress;
      localSession.current = session;
    }
    return localSession.current;
  }

  function replaceLocalPdfUrl(url: string | null) {
    if (localPdfUrlRef.current) URL.revokeObjectURL(localPdfUrlRef.current);
    localPdfUrlRef.current = url;
  }

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
    void readPersistedMeta().then((meta) => setPersistedAvailable(Boolean(meta)));

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
      localSession.current?.dispose();
      if (localPdfUrlRef.current) URL.revokeObjectURL(localPdfUrlRef.current);
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
  const localReady = localPhase === "ready";
  const composerAvailable = collection === "curated" ? hostedAvailable : localReady;

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

  async function consumeAnswerStream(
    response: Response,
    onEvent: (event: AnswerStreamEvent) => void,
  ): Promise<void> {
    if (!response.body) throw new Error("The browser could not open the answer stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AnswerStreamEvent);
      if (done) break;
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as AnswerStreamEvent);
  }

  function resetResearchState() {
    setError("");
    setAnswer("");
    setResults([]);
    setSelectedSource(null);
    setViewerOpen(false);
    setLocalSearchMode(null);
  }

  async function askCuratedLibrary(submittedQuestion: string, controller: AbortController) {
    let completeAnswer = "";
    let completeSources: SearchResult[] = [];
    let completed = false;

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

    await consumeAnswerStream(response, (event) => {
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
    });
    if (!completed || !completeAnswer.trim()) throw new Error("The answer stream ended before completion.");

    saveHistory({
      id: crypto.randomUUID(),
      question: submittedQuestion,
      answer: completeAnswer,
      sources: completeSources,
      createdAt: new Date().toISOString(),
    });
  }

  async function askLocalDocument(submittedQuestion: string, controller: AbortController) {
    const outcome = await getSession().search(submittedQuestion, sourceCount);
    const localSources = outcome.results.map((result) => ({
      ...result,
      pdf_url: localPdfUrlRef.current ?? "",
    }));
    setResults(localSources);
    setSelectedSource(localSources[0] ?? null);
    setLocalSearchMode(outcome.embedded ? "hybrid" : "keyword");
    if (localSources.length === 0) {
      setStage(null);
      return;
    }

    if (!hostedSynthesis || !hostedAvailable) {
      setStage(null);
      return;
    }

    // Only the bounded retrieved excerpts are transmitted — never the file.
    const excerpts = localSources.slice(0, MAX_LOCAL_EXCERPTS).map((source) => ({
      label: source.title,
      page: source.page,
      text: source.snippet.slice(0, MAX_LOCAL_EXCERPT_CHARS),
    }));
    const response = await fetch(`${API_BASE_URL}/answer/local/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: submittedQuestion, excerpts }),
      signal: controller.signal,
    });
    updateRemaining(response);
    if (!response.ok) {
      const message = await responseError(response);
      await refreshStatus();
      throw new Error(message);
    }

    let completeAnswer = "";
    let completed = false;
    await consumeAnswerStream(response, (event) => {
      if (event.type === "stage") setStage(event.stage);
      else if (event.type === "delta") {
        completeAnswer += event.delta;
        setAnswer(completeAnswer);
      } else if (event.type === "done") completed = true;
      else if (event.type === "error") throw new Error(event.message);
    });
    if (!completed || !completeAnswer.trim()) throw new Error("The answer stream ended before completion.");
  }

  async function askLibrary() {
    const submittedQuestion = question.trim();
    if (!submittedQuestion || stage || !composerAvailable) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStage("retrieving");
    resetResearchState();

    try {
      if (collection === "curated") await askCuratedLibrary(submittedQuestion, controller);
      else await askLocalDocument(submittedQuestion, controller);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (caught && typeof caught === "object" && "code" in caught) {
        setError(localErrorMessage(caught).message);
      } else {
        setError(caught instanceof Error ? caught.message : "The research request failed.");
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setStage(null);
    }
  }

  async function addLocalFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setLocalPhase("error");
      setLocalError(`PDFs up to ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB are supported.`);
      return;
    }
    setLocalPhase("processing");
    setLocalProgress(null);
    setLocalError("");
    try {
      const meta = await getSession().process(file, false);
      replaceLocalPdfUrl(URL.createObjectURL(file));
      setLocalMeta(meta);
      setLocalPhase("ready");
    } catch (caught) {
      const { code, message } = localErrorMessage(caught);
      if (code === "PROCESSING_CANCELLED") {
        setLocalPhase("idle");
        return;
      }
      setLocalPhase("error");
      setLocalError(message);
    }
  }

  async function restoreLocalDocument() {
    setLocalPhase("processing");
    setLocalProgress(null);
    setLocalError("");
    try {
      const restored = await getSession().restore();
      if (!restored) {
        setPersistedAvailable(false);
        setLocalPhase("idle");
        return;
      }
      replaceLocalPdfUrl(URL.createObjectURL(new Blob([restored.pdfBytes], { type: "application/pdf" })));
      setLocalMeta(restored.meta);
      setLocalPhase("ready");
    } catch (caught) {
      setLocalPhase("error");
      setLocalError(localErrorMessage(caught).message);
    }
  }

  async function removeLocalDocument() {
    try {
      await getSession().remove();
    } catch {
      localSession.current?.terminate();
    }
    replaceLocalPdfUrl(null);
    setLocalMeta(null);
    setLocalPhase("idle");
    setLocalProgress(null);
    setPersistedAvailable(false);
    resetResearchState();
  }

  async function persistLocalDocument(persist: boolean) {
    try {
      const meta = await getSession().setPersist(persist);
      setLocalMeta(meta);
      setPersistedAvailable(meta.persisted);
    } catch (caught) {
      setError(localErrorMessage(caught).message);
    }
  }

  function switchCollection(next: Collection) {
    if (next === collection) return;
    activeRequest.current?.abort();
    setCollection(next);
    setStage(null);
    resetResearchState();
  }

  function selectSource(source: SearchResult) {
    setSelectedSource(source);
    setViewerOpen(true);
    setSourcesOpen(true);
  }

  function restoreHistory(entry: HistoryEntry) {
    activeRequest.current?.abort();
    setCollection("curated");
    setQuestion(entry.question);
    setAnswer(entry.answer);
    setResults(entry.sources);
    setSelectedSource(entry.sources[0] ?? null);
    setViewerOpen(false);
    setError("");
    setStage(null);
    setLocalSearchMode(null);
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

          <div className="collection-switch" role="group" aria-label="Search collection">
            <button
              className={collection === "curated" ? "is-active" : ""}
              aria-pressed={collection === "curated"}
              onClick={() => switchCollection("curated")}
            >
              <BookIcon /> Curated library
            </button>
            <button
              className={collection === "local" ? "is-active" : ""}
              aria-pressed={collection === "local"}
              onClick={() => switchCollection("local")}
            >
              <FileIcon /> Your PDF <em>private</em>
            </button>
          </div>

          {collection === "local" && (
            <LocalDocumentPanel
              phase={localPhase}
              meta={localMeta}
              progress={localProgress}
              error={localError}
              persistedAvailable={persistedAvailable && localPhase === "idle"}
              hostedSynthesisEnabled={hostedSynthesis}
              hostedAvailable={hostedAvailable}
              busy={Boolean(stage)}
              onAddFile={addLocalFile}
              onRestore={restoreLocalDocument}
              onCancel={() => localSession.current?.cancel()}
              onRemove={removeLocalDocument}
              onPersistChange={persistLocalDocument}
              onHostedSynthesisChange={setHostedSynthesis}
              onReset={() => { setLocalPhase("idle"); setLocalError(""); }}
            />
          )}

          <QueryComposer
            question={question}
            examples={collection === "curated" ? EXAMPLE_QUESTIONS : []}
            sourceCount={sourceCount}
            showDetails={showDetails}
            available={composerAvailable}
            busy={Boolean(stage)}
            actionLabel={collection === "curated" ? "Ask the library" : "Search your document"}
            onQuestionChange={setQuestion}
            onSourceCountChange={setSourceCount}
            onShowDetailsChange={setShowDetails}
            onSubmit={askLibrary}
          />

          {error && (
            <div className="message error-message" role="alert">
              <div><strong>Research interrupted</strong><span>{error}</span></div>
              <button onClick={askLibrary} disabled={!composerAvailable}><RefreshIcon /> Retry</button>
            </div>
          )}

          {collection === "curated" && !hostedAvailable && status && (
            <div className="message paused-message" role="status">
              <strong>{status.quota.code === "DEMO_DISABLED" ? "The hosted demo is paused" : "Today’s demo capacity has been reached"}</strong>
              <span>The library remains available to explore. Hosted research resets at {new Date(status.quota.resetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} local time. Your own PDF can still be searched fully in-browser.</span>
            </div>
          )}

          {(stage || answer) && <AnswerCard answer={answer} sources={results} stage={stage} onCitation={selectSource} onRetry={askLibrary} />}

          {collection === "local" && localSearchMode && results.length > 0 && !stage && (
            <div className="message local-mode-note" role="status">
              <strong>
                {answer
                  ? "Answer generated by the hosted model from bounded excerpts"
                  : "Local search only"}
              </strong>
              <span>
                {answer
                  ? `Only the ${Math.min(results.length, MAX_LOCAL_EXCERPTS)} retrieved excerpts were sent to the quota-limited hosted endpoint.`
                  : `Ranked in this browser with ${localSearchMode === "hybrid" ? "local embeddings and keyword search" : "keyword search"}. Nothing was transmitted.`}
              </span>
            </div>
          )}

          {results.length > 0 && (
            <section className="results-section" aria-live="polite">
              <div className="section-heading">
                <div><p className="eyebrow">Evidence</p><h2>Supporting sources</h2></div>
                <span>{results.length} sources</span>
              </div>
              <ResultList results={results} selectedSource={selectedSource} showDetails={showDetails} onSelect={selectSource} />
            </section>
          )}

          <section id="method" className="results-section">
            <div className="section-heading">
              <div><p className="eyebrow">Method</p><h2>Built for verifiable answers</h2></div>
            </div>
            <div className="method-grid">
              <article><span>01</span><h3>Hybrid retrieval</h3><p>Dense semantic search and BM25 keyword matching find complementary evidence.</p></article>
              <article><span>02</span><h3>Stable citations</h3><p>Every passage carries a real title, section, page number, and source URL.</p></article>
              <article><span>03</span><h3>Grounded synthesis</h3><p>Answers are constrained to retrieved context and keep citations visible.</p></article>
            </div>
          </section>
        </main>

        <SourcePanel source={selectedSource} sourceCount={results.length} open={sourcesOpen} viewerOpen={viewerOpen} onOpenViewer={() => setViewerOpen(true)} onClose={() => setSourcesOpen(false)} />
      </div>
    </div>
  );
}
