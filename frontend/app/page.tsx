"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-shell/AppHeader";
import { LibrarySidebar } from "@/components/app-shell/LibrarySidebar";
import { SourcePanel } from "@/components/app-shell/SourcePanel";
import { AnswerCard } from "@/components/answer/AnswerCard";
import { LocalDocumentPanel } from "@/components/local/LocalDocumentPanel";
import { QueryComposer } from "@/components/search/QueryComposer";
import { ResultList } from "@/components/sources/ResultList";
import { BookIcon, FileIcon, RefreshIcon, SparkIcon } from "@/components/icons";
import {
  MAX_FILE_BYTES,
  MAX_LOCAL_EXCERPTS,
  MAX_LOCAL_EXCERPT_CHARS,
} from "@/lib/local-documents/limits";
import { LocalDocumentSession } from "@/lib/local-documents/session";
import { readPersistedMetas } from "@/lib/local-documents/storage";
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
// A rotating subset keeps repeat visits fresh; all of these are grounded in
// the curated corpus and drawn from the evaluation themes.
const EXAMPLE_POOL = [
  "How does functional-level autonomy differ from system-level autonomy?",
  "How is deep learning applied to spacecraft pose estimation?",
  "Why do limited real datasets and synthetic images create a domain gap?",
  "How can spacecraft components be detected during rendezvous with an unknown target?",
  "What role do data augmentations play in object detection for orbital imagery?",
  "How can NeRF models reconstruct tumbling resident space objects in 3D?",
  "What makes tracking space debris against complex skylight backgrounds difficult?",
  "How are craters used for terrain-relative navigation during lunar descent?",
  "What are the main limitations of monocular spacecraft pose estimation methods?",
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
  const [examples, setExamples] = useState<string[]>(EXAMPLE_POOL.slice(0, 3));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [collection, setCollection] = useState<Collection>("curated");
  const [localDocs, setLocalDocs] = useState<LocalDocumentMeta[]>([]);
  const [localBusy, setLocalBusy] = useState(false);
  const [localProgress, setLocalProgress] = useState<LocalProgress | null>(null);
  const [localError, setLocalError] = useState("");
  const [persistedAvailable, setPersistedAvailable] = useState(false);
  // Hosted synthesis is on by default so local-PDF questions get a real
  // answer out of the box; the panel toggle switches to fully local search.
  const [hostedSynthesis, setHostedSynthesis] = useState(true);
  const [localSearchMode, setLocalSearchMode] = useState<"hybrid" | "keyword" | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const localSession = useRef<LocalDocumentSession | null>(null);
  const localPdfUrls = useRef(new Map<string, string>());

  function getSession(): LocalDocumentSession {
    if (!localSession.current) {
      const session = new LocalDocumentSession();
      session.onProgress = setLocalProgress;
      localSession.current = session;
    }
    return localSession.current;
  }

  function setLocalPdfUrl(docId: string, url: string) {
    const existing = localPdfUrls.current.get(docId);
    if (existing) URL.revokeObjectURL(existing);
    localPdfUrls.current.set(docId, url);
  }

  function revokeLocalPdfUrls(keep: Set<string>) {
    for (const [docId, url] of localPdfUrls.current) {
      if (!keep.has(docId)) {
        URL.revokeObjectURL(url);
        localPdfUrls.current.delete(docId);
      }
    }
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
    void readPersistedMetas().then((metas) => setPersistedAvailable(metas.length > 0));
    // Rotate after hydration so server and first client render agree.
    const exampleFrame = window.requestAnimationFrame(() => {
      setExamples([...EXAMPLE_POOL].sort(() => Math.random() - 0.5).slice(0, 3));
    });

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
      window.cancelAnimationFrame(exampleFrame);
      activeRequest.current?.abort();
      localSession.current?.dispose();
      revokeLocalPdfUrls(new Set());
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
  const localReady = localDocs.length > 0 && !localBusy;
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

  async function askLocalDocument(
    submittedQuestion: string,
    controller: AbortController,
    synthesis: boolean,
  ) {
    const outcome = await getSession().search(submittedQuestion, sourceCount);
    const localSources = outcome.results.map((result) => ({
      ...result,
      pdf_url: localPdfUrls.current.get(result.paper_id) ?? "",
    }));
    setResults(localSources);
    setSelectedSource(localSources[0] ?? null);
    setLocalSearchMode(outcome.embedded ? "hybrid" : "keyword");
    if (localSources.length === 0) {
      setStage(null);
      return;
    }

    if (!synthesis || !hostedAvailable) {
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

  // Accepts an optional { synthesis } override so the results banner can turn
  // hosted synthesis on and re-ask in one click, before the state updates.
  // Event objects from onClick/onSubmit fall through to the toggle state.
  async function askLibrary(options?: unknown) {
    const synthesis =
      options && typeof options === "object" && "synthesis" in options
        ? Boolean((options as { synthesis: unknown }).synthesis)
        : hostedSynthesis;
    const submittedQuestion = question.trim();
    if (!submittedQuestion || stage || !composerAvailable) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStage("retrieving");
    resetResearchState();

    try {
      if (collection === "curated") await askCuratedLibrary(submittedQuestion, controller);
      else await askLocalDocument(submittedQuestion, controller, synthesis);
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
      setLocalError(`PDFs up to ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB are supported.`);
      return;
    }
    setLocalBusy(true);
    setLocalProgress(null);
    setLocalError("");
    try {
      const { meta, metas } = await getSession().process(file);
      setLocalPdfUrl(meta.id, URL.createObjectURL(file));
      setLocalDocs(metas);
    } catch (caught) {
      const { code, message } = localErrorMessage(caught);
      if (code !== "PROCESSING_CANCELLED") setLocalError(message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function restoreLocalDocuments() {
    setLocalBusy(true);
    setLocalProgress(null);
    setLocalError("");
    try {
      const restored = await getSession().restore();
      if (restored.length === 0) {
        setPersistedAvailable(false);
        return;
      }
      for (const doc of restored) {
        setLocalPdfUrl(doc.meta.id, URL.createObjectURL(new Blob([doc.pdfBytes], { type: "application/pdf" })));
      }
      setLocalDocs(restored.map((doc) => doc.meta));
    } catch (caught) {
      setLocalError(localErrorMessage(caught).message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function removeLocalDocument(docId: string) {
    try {
      const metas = await getSession().remove(docId);
      setLocalDocs(metas);
      revokeLocalPdfUrls(new Set(metas.map((meta) => meta.id)));
      if (metas.length === 0) {
        setPersistedAvailable(false);
        resetResearchState();
      } else {
        setResults((current) => current.filter((result) => result.paper_id !== docId));
        setSelectedSource((current) => (current?.paper_id === docId ? null : current));
      }
    } catch {
      localSession.current?.terminate();
      setLocalDocs([]);
      revokeLocalPdfUrls(new Set());
      resetResearchState();
    }
  }

  async function persistLocalDocuments(persist: boolean) {
    try {
      const metas = await getSession().setPersist(persist);
      setLocalDocs(metas);
      setPersistedAvailable(metas.some((meta) => meta.persisted));
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
      <AppHeader statusLabel={statusView.label} statusTone={statusView.tone} quota={status?.quota ?? null} libraryOpen={libraryOpen} sourcesOpen={sourcesOpen} onOpenLibrary={() => setLibraryOpen(true)} onOpenSources={() => setSourcesOpen(true)} />

      <div className="workspace-grid">
        <LibrarySidebar papers={papers} chunkCount={status?.corpus.chunkCount ?? null} history={history} open={libraryOpen} onClose={() => setLibraryOpen(false)} onSelectHistory={restoreHistory} />

        <main id="workspace" className="research-workspace">
          <section className="workspace-intro">
            <div key={collection} className="mode-transition">
              <p className="eyebrow"><SparkIcon /> Source-grounded research</p>
              <h1>{collection === "curated" ? "Ask the spacecraft autonomy library" : "Find insights in your own PDFs"}</h1>
              <p>
                {collection === "curated" ? (
                  <>
                    Question a curated collection of research on spacecraft autonomy and aerospace
                    computer vision, then trace every answer back to its paper and page —{" "}
                    <button className="hero-link" onClick={() => switchCollection("local")}>
                      or upload your own PDF to get cited insights from it
                    </button>
                    .
                  </>
                ) : (
                  "Your PDFs are parsed and searched privately in this browser tab; answers are synthesized by the hosted model from the few retrieved passages, or switch it off to stay fully local."
                )}
              </p>
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
              docs={localDocs}
              busy={localBusy}
              searchBusy={Boolean(stage)}
              progress={localProgress}
              error={localError}
              persistedAvailable={persistedAvailable}
              persistEnabled={localDocs.some((doc) => doc.persisted)}
              hostedSynthesisEnabled={hostedSynthesis}
              hostedAvailable={hostedAvailable}
              onAddFile={addLocalFile}
              onRestore={restoreLocalDocuments}
              onCancel={() => localSession.current?.cancel()}
              onRemoveDoc={removeLocalDocument}
              onPersistChange={persistLocalDocuments}
              onHostedSynthesisChange={setHostedSynthesis}
              onDismissError={() => setLocalError("")}
            />
          )}

          <QueryComposer
            question={question}
            examples={collection === "curated" ? examples : []}
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
              {!answer && hostedAvailable && (
                <button
                  onClick={() => {
                    setHostedSynthesis(true);
                    void askLibrary({ synthesis: true });
                  }}
                >
                  <SparkIcon /> Generate an answer from these passages — uses 1 daily question
                </button>
              )}
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

          <footer className="workspace-footer">
            <p>
              <strong>Made by Jeremy Burke</strong>
              <a href="https://github.com/jburke860/technical-paper-ai-search" target="_blank" rel="noreferrer">Source on GitHub</a>
            </p>
            <p>Runs entirely on Cloudflare&rsquo;s free tier with a hard daily question cap.</p>
          </footer>
        </main>

        <SourcePanel source={selectedSource} sourceCount={results.length} open={sourcesOpen} viewerOpen={viewerOpen} onOpenViewer={() => setViewerOpen(true)} onClose={() => setSourcesOpen(false)} />
      </div>
    </div>
  );
}
