"use client";

import { useState } from "react";

type SearchResult = {
  id: string;
  document: string;
  page: number;
  snippet: string;
  distance: number;
};

type SearchResponse = {
  question: string;
  results: SearchResult[];
};

export default function Home() {
  const [question, setQuestion] = useState(
    "What are the main challenges in autonomous systems?"
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch() {
    if (!question.trim()) return;

    setLoading(true);
    setError("");
    setResults([]);

    try {
      const response = await fetch("http://localhost:8000/search", {
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
        throw new Error("Search request failed.");
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
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex rounded-full border border-emerald-800 bg-emerald-950/60 px-4 py-2 text-sm text-emerald-200">
            Local RAG Demo • Public Technical Papers • Semantic Search
          </p>

          <h1 className="text-5xl font-bold tracking-tight text-white md:text-7xl">
            Technical Paper AI Search Assistant
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
            Search a small collection of public technical PDFs using local
            embeddings and vector retrieval. Results include source snippets,
            document names, and page numbers.
          </p>
        </div>

        <div className="mt-12 rounded-3xl border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-black/30">
          <label className="text-sm font-medium text-stone-300">
            Ask a question
          </label>

          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="min-h-28 flex-1 rounded-2xl border border-stone-700 bg-stone-950 p-4 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-emerald-500"
              placeholder="Ask about the papers..."
            />

            <button
              onClick={handleSearch}
              disabled={loading}
              className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-44"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-2xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        <section className="mt-10">
          <div className="mb-5 flex items-end justify-between gap-4">
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
                Showing {results.length} results
              </p>
            )}
          </div>

          <div className="grid gap-5">
            {results.map((result, index) => (
              <article
                key={result.id}
                className="rounded-3xl border border-stone-800 bg-stone-900/80 p-6 shadow-lg shadow-black/20"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">
                      Result {index + 1}
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-white">
                      {result.document}
                    </h3>
                    <p className="mt-1 text-sm text-stone-400">
                      Page {result.page}
                    </p>
                  </div>

                  <span className="w-fit rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300">
                    Distance: {result.distance.toFixed(4)}
                  </span>
                </div>

                <p className="mt-5 text-sm leading-7 text-stone-300">
                  {result.snippet}
                </p>
              </article>
            ))}
          </div>

          {!loading && results.length === 0 && (
            <div className="rounded-3xl border border-dashed border-stone-700 p-8 text-center text-stone-400">
              Search results will appear here.
            </div>
          )}
        </section>

        <section className="mt-16 rounded-3xl border border-stone-800 bg-stone-900 p-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
            How It Works
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {[
              "Extract text from public PDFs",
              "Split papers into searchable chunks",
              "Create local embeddings",
              "Retrieve relevant source snippets",
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

        <p className="mt-12 text-center text-sm text-stone-500">
          Created by{" "}
          <span className="text-stone-400">Jeremy Burke</span>
        </p>
      </section>
    </main>
  );
}