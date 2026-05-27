"use client";

import { ChangeEvent, useState } from "react";

type SearchResult = {
  id: string;
  document: string;
  page: number;
  snippet: string;
  distance: number | null;
  bm25_score: number | null;
  hybrid_score: number | null;
};

type SearchResponse = {
  question: string;
  results: SearchResult[];
};

type AnswerResponse = {
  question: string;
  answer: string;
  sources: SearchResult[];
};

const API_BASE_URL = "http://localhost:8000";

function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return value.toFixed(4);
}

function truncateText(text: string, maxLength = 1200) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

export default function Home() {
  const [question, setQuestion] = useState(
    "What are the main challenges in autonomous systems?"
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [searchLoading, setSearchLoading] = useState(false);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);

  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadMessage("");
    setError("");
  }

  async function getErrorMessage(response: Response) {
    try {
      const data = await response.json();
      return data.detail || "Request failed.";
    } catch {
      return "Request failed.";
    }
  }

  async function handleSearch() {
    if (!question.trim()) return;

    setSearchLoading(true);
    setError("");
    setAnswer("");
    setResults([]);

    try {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          n_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const data: SearchResponse = await response.json();
      setResults(data.results);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while searching."
      );
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleGenerateAnswer() {
    if (!question.trim()) return;

    setAnswerLoading(true);
    setError("");
    setAnswer("");
    setResults([]);

    try {
      const response = await fetch(`${API_BASE_URL}/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          n_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const data: AnswerResponse = await response.json();
      setAnswer(data.answer);
      setResults(data.sources);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while generating an answer."
      );
    } finally {
      setAnswerLoading(false);
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      setError("Select a PDF before uploading.");
      return;
    }

    setUploadLoading(true);
    setError("");
    setUploadMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const data: { filename: string; message: string } = await response.json();

      setUploadMessage(`${data.filename} uploaded and indexed successfully.`);
      setSelectedFile(null);
      setResults([]);
      setAnswer("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while uploading the PDF."
      );
    } finally {
      setUploadLoading(false);
    }
  }

  const isBusy = searchLoading || answerLoading || uploadLoading;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
        <div className="max-w-4xl">
          <p className="mb-5 inline-flex rounded-full border border-emerald-800 bg-emerald-950/60 px-4 py-2 text-sm text-emerald-200">
            Local RAG Demo • Hybrid Search • PDF Upload • Ollama Answers
          </p>

          <h1 className="text-5xl font-bold tracking-tight text-white md:text-7xl">
            Technical Paper AI Search Assistant
          </h1>

          <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-300">
            Search public technical PDFs using local embeddings, hybrid
            vector/BM25 retrieval, and local Ollama answer synthesis. Results
            include source snippets, document names, page numbers, and retrieval
            scores.
          </p>
        </div>

        <section className="mt-10 rounded-3xl border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-black/30">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <label className="text-sm font-medium text-stone-300">
                Ask a question
              </label>

              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="mt-3 min-h-32 w-full rounded-2xl border border-stone-700 bg-stone-950 p-4 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-emerald-500"
                placeholder="Ask about the papers..."
              />

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={handleSearch}
                  disabled={isBusy || !question.trim()}
                  className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {searchLoading ? "Searching..." : "Search Sources"}
                </button>

                <button
                  onClick={handleGenerateAnswer}
                  disabled={isBusy || !question.trim()}
                  className="rounded-2xl border border-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500 hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {answerLoading ? "Generating..." : "Generate Answer"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-stone-800 bg-stone-950 p-5">
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
                Add a PDF
              </p>

              <p className="mt-3 text-sm leading-6 text-stone-400">
                Upload a public technical PDF to add it to the local collection.
                The backend will save the file and rebuild the search index.
              </p>

              <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-stone-700 bg-stone-900 p-5 text-center transition hover:border-emerald-500">
                <span className="text-sm font-semibold text-stone-200">
                  {selectedFile ? selectedFile.name : "Choose PDF"}
                </span>
                <span className="mt-1 text-xs text-stone-500">
                  PDF files only
                </span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <button
                onClick={handleUpload}
                disabled={uploadLoading || !selectedFile}
                className="mt-4 w-full rounded-2xl bg-stone-100 px-6 py-3 text-sm font-semibold text-stone-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadLoading ? "Uploading and indexing..." : "Upload PDF"}
              </button>
            </div>
          </div>

          {error && (
            <p className="mt-5 rounded-2xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
              {error}
            </p>
          )}

          {uploadMessage && (
            <p className="mt-5 rounded-2xl border border-emerald-900 bg-emerald-950/50 p-4 text-sm text-emerald-200">
              {uploadMessage}
            </p>
          )}
        </section>

        {answer && (
          <section className="mt-10 rounded-3xl border border-emerald-900 bg-emerald-950/40 p-6 shadow-lg shadow-black/20">
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">
              Generated Answer
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              Local Ollama response
            </h2>
            <p className="mt-5 whitespace-pre-line text-sm leading-7 text-emerald-50/90">
              {answer}
            </p>
          </section>
        )}

        <section className="mt-10">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
                Results
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">
                Source-grounded snippets
              </h2>
            </div>

            {results.length > 0 && (
              <p className="text-sm text-stone-400">
                Showing {results.length} sources
              </p>
            )}
          </div>

          <div className="grid gap-5">
            {results.map((result, index) => (
              <article
                key={result.id}
                className="rounded-3xl border border-stone-800 bg-stone-900/80 p-6 shadow-lg shadow-black/20"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">
                      Source {index + 1}
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-white">
                      {result.document}
                    </h3>
                    <p className="mt-1 text-sm text-stone-400">
                      Page {result.page}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-stone-700 px-3 py-1 text-stone-300">
                      Hybrid: {formatScore(result.hybrid_score)}
                    </span>
                    <span className="rounded-full border border-stone-700 px-3 py-1 text-stone-300">
                      BM25: {formatScore(result.bm25_score)}
                    </span>
                    <span className="rounded-full border border-stone-700 px-3 py-1 text-stone-300">
                      Distance: {formatScore(result.distance)}
                    </span>
                  </div>
                </div>

                <p className="mt-5 text-sm leading-7 text-stone-300">
                  {truncateText(result.snippet)}
                </p>
              </article>
            ))}
          </div>

          {!searchLoading && !answerLoading && results.length === 0 && (
            <div className="rounded-3xl border border-dashed border-stone-700 p-8 text-center text-stone-400">
              Search results and answer sources will appear here.
            </div>
          )}
        </section>

        <section className="mt-16 rounded-3xl border border-stone-800 bg-stone-900 p-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
            How It Works
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-5">
            {[
              "Upload or load public PDFs",
              "Extract and chunk document text",
              "Create local embeddings",
              "Run hybrid vector/BM25 retrieval",
              "Generate answers with local Ollama",
            ].map((step, index) => (
              <div
                key={step}
                className="rounded-2xl border border-stone-800 bg-stone-950 p-5"
              >
                <p className="text-sm font-semibold text-emerald-300">
                  Step {index + 1}
                </p>
                <p className="mt-3 text-sm leading-6 text-stone-300">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-12 text-center text-xs text-stone-600">
          Created by Jeremy Burke
        </footer>
      </section>
    </main>
  );
}