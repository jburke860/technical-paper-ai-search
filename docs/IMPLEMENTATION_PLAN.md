# Hosted Demo Implementation Plan

This roadmap converts the local prototype into a polished, source-verifiable
portfolio demo while preserving the zero-cost contract in
[`COST_GUARDRAILS.md`](../COST_GUARDRAILS.md).

Only one phase should be implemented per commit. A phase is complete only when
all of its exit criteria pass.

## Product direction

The hosted product is a compact research workspace, not a simulated enterprise
platform. All document counts, retrieval metrics, citations, model labels, and
status indicators must be derived from real application data.

The visual direction is an editorial light interface with warm neutral
surfaces, ink typography, restrained emerald accents, fine borders, and a
three-panel research layout:

```text
library and filters | question, answer, sources | PDF and citation preview
```

On mobile, the library collapses and the source/PDF panel becomes a drawer.

## Phase 0 — Zero-cost operating contract

Status: complete

Deliverables:

- Define allowed and prohibited production services.
- Set conservative global, browser, burst, input, context, and output limits.
- Define fail-closed request ordering and exhaustion behavior.
- Define deployment verification and change-control rules.

Exit criteria:

- `COST_GUARDRAILS.md` is checked in.
- The roadmap links to the guardrails.
- The root README links to both documents.

## Phase 1 — Corpus refactor and retrieval baseline

Status: complete

Deliverables:

- Replace 900-word chunks with section-aware chunks of approximately 300–450
  tokens and 50–75 tokens of overlap.
- Remove repeated headers and footers where possible.
- Store title, authors, year, page, section, stable PDF URL, and stable chunk ID.
- Replace score blending with reciprocal-rank fusion.
- Deduplicate overlapping results from the same page.
- Add a corpus manifest and a 20–25-question retrieval evaluation set.
- Record recall@5 and mean reciprocal rank.

Suggested structure:

```text
data/corpus.json
data/papers.json
evaluation/questions.json
evaluation/evaluate.py
scripts/build_corpus.py
```

Exit criteria:

- Corpus generation is deterministic.
- Citation IDs remain stable across repeated builds.
- Every search result contains complete citation metadata.
- Evaluation runs with one documented command.
- Baseline metrics are recorded in the README.

## Phase 2 — Hosted Worker API

Status: implementation complete; production activation is gated on Phase 3

Safety decision: the deployable Worker bundle is complete, but creating and
publishing the remote Worker is intentionally deferred until the global quota
circuit breaker exists. Publishing an unrestricted AI endpoint would conflict
with the zero-cost operating contract.

Deliverables:

- Add a Cloudflare Worker TypeScript project.
- Bind Workers AI, Vectorize, and D1 on the Free plan.
- Add `GET /api/status`, `GET /api/papers`, `POST /api/search`, and
  `POST /api/answer`.
- Implement request validation, embedding, vector retrieval, BM25/RRF
  reranking, grounded generation, and structured citations.
- Use same-origin `/api` requests from the frontend.
- Remove Python, Torch, Chroma, and Ollama from the hosted runtime while keeping
  the Python pipeline available for local development and offline ingestion.

Exit criteria:

- The production Worker bundle passes a Wrangler deployment dry run and mocked
  binding tests answer a real corpus question.
- Returned citations refer to real document pages.
- Hosted runtime does not require a persistent server or local model process.
- Local development remains documented.
- Remote provisioning and public activation occur only after Phase 3 passes its
  failure drills.

## Phase 3 — Global quota circuit breaker

Status: complete

Deliverables:

- Add an atomic UTC daily counter in D1.
- Enforce `DEMO_ENABLED` and `DAILY_DEMO_LIMIT` before AI calls.
- Add per-browser daily and burst controls.
- Return a stable `503` exhaustion response and UTC reset time.
- Add fail-closed handling for unavailable quota state.
- Add integration tests proving AI bindings are not called after blocking.

Exit criteria:

- The first configured number of requests succeeds and the next fails globally.
- Restarting or redeploying does not reset the daily count.
- Quota-store failure blocks all dynamic operations.
- The next UTC date resets application capacity.
- The global switch disables every dynamic endpoint.

Verification completed with a real local D1 migration, strict TypeScript
checking, a Wrangler production-bundle dry run, and integration drills covering
global exhaustion, Worker restart persistence, quota-store failure, both kill
switches, browser daily and burst limits, and the next-UTC-day reset. Blocked
requests assert that neither Workers AI nor Vectorize is called.

## Phase 4 — Visual foundation and application shell

Status: complete

Deliverables:

- Implement design tokens for color, type, spacing, borders, focus, and motion.
- Build the responsive top navigation, library sidebar, content workspace, and
  source drawer.
- Split the current page into focused components.
- Add real corpus counts and remove decorative or fabricated metrics.
- Self-host fonts and correct metadata, favicon, and social previews.

Suggested component areas:

```text
components/app-shell
components/search
components/answer
components/sources
components/documents
components/system
```

Exit criteria:

- Desktop, tablet, and mobile layouts work.
- Keyboard focus is visible and navigation is usable without a mouse.
- Initial production build requires no Google Fonts network request.
- All displayed counts come from application data.

Verification completed with ESLint and an optimized Next.js production build.
The shell uses locally bundled Geist files from the pinned Next.js package,
contains no Google Fonts request, exposes visible focus states and Escape-close
drawers, and switches between three-column desktop, two-column tablet, and
drawer-based mobile layouts. Corpus and quota figures are loaded from the
Worker status and papers endpoints rather than hard-coded UI metrics.

## Phase 5 — Main research workflow

Status: complete

Deliverables:

- Replace separate search and generation buttons with one `Ask the library`
  action.
- Add example questions, optional retrieval settings, staged loading, streaming
  answers, retries, and meaningful error states.
- Add clickable inline citations, supporting source cards, copy answer, copy
  citation, and local search history.
- Put raw BM25/vector details behind an advanced disclosure.
- Display global quota availability and the fully exhausted state.

Exit criteria:

- A first-time visitor can complete the primary flow without instructions.
- Inline citations select the correct source.
- Empty, loading, success, failure, and quota-exhausted states are implemented.
- Search state is preserved through expected navigation.

Verification completed with Worker streaming and quota tests, strict Worker
typechecking, frontend ESLint, and an optimized Next.js build. The unified
workflow streams NDJSON source and answer events, links inline citations to the
source drawer, supports copy/retry and optional retrieval details, persists up
to eight completed sessions locally, and disables submission whenever status
cannot positively confirm hosted capacity.

## Phase 6 — PDF citation viewer

Status: complete

Deliverables:

- Integrate PDF.js as a lazy-loaded viewer.
- Open citations at their real page.
- Add page navigation, zoom, open-original, and download controls.
- Highlight the supporting passage when extraction coordinates permit it.
- Use a full-height side panel on desktop and a drawer on mobile.

Exit criteria:

- Every citation opens the correct document and page.
- PDFs are fetched only when requested.
- Citations remain usable if passage highlighting is unavailable.
- Desktop and mobile viewer flows pass browser tests.

Verification completed with desktop and mobile Playwright runs against the real
curated PDF asset, plus checks that all three included corpus PDFs are served as
valid static documents. The PDF.js module, worker, and document bytes are loaded
only after citation interaction. Exact-page rendering, navigation, zoom,
open/download controls, coordinate-based highlight overlays, and a text-excerpt
fallback are implemented.

## Phase 7 — Retrieval explainability

Status: complete

Deliverables:

- Add an expandable `Why this source?` view.
- Show semantic rank, keyword rank, RRF contribution, matched concepts, and
  whether both retrievers found the passage.
- Avoid uncalibrated answer-confidence percentages.
- Document the ranking calculation for technical reviewers.

Exit criteria:

- Every explanation is generated from real retrieval data.
- Displayed rankings reproduce the backend result order.
- No knowledge graph or confidence metric is added without a real evaluation
  basis.

Verification completed with Worker assertions that displayed ranks match
response order and that semantic plus keyword contributions reproduce the RRF
score. Desktop and mobile Playwright flows exercise the expandable explanation.
The calculation, lexical concept matching, deduplication order, and limits are
documented in [`RETRIEVAL_EXPLAINABILITY.md`](RETRIEVAL_EXPLAINABILITY.md).

## Phase 8 — Browser-local PDF mode

Deliverables:

- Remove the public server-side upload workflow from the hosted app.
- Parse PDFs in a Web Worker with PDF.js.
- Chunk and embed temporary documents in the browser.
- Keep local documents in memory or opt-in IndexedDB storage.
- Show extraction, model-loading, embedding, and indexing progress.
- Clearly disclose whether answer generation is local or sends selected excerpts
  to the quota-controlled hosted endpoint.

Exit criteria:

- Uploaded files never reach owner-controlled storage.
- Unsupported, scanned, oversized, and malformed PDFs fail safely.
- Browser limits prevent a document from freezing the page.
- Hosted generation remains protected by the global quota gate.

## Phase 9 — Quality and failure testing

Deliverables:

- Add Worker tests for validation, quota, retrieval, citation mapping, provider
  failure, and prompt-injection content.
- Add frontend tests for the successful flow, PDF citations, mobile source
  drawer, keyboard navigation, streaming interruption, and exhaustion.
- Track retrieval recall@5, MRR, duplicate rate, and citation-page accuracy.
- Add lint, typecheck, unit, integration, production-build, and Playwright CI
  jobs.

Exit criteria:

- CI passes from a clean checkout.
- A quota exhaustion drill and quota-store failure drill pass.
- Lighthouse accessibility reaches the agreed target.
- No tested route bypasses quota middleware.

## Phase 10 — Production and portfolio launch

Deliverables:

- Deploy from the dedicated no-payment-method Free account.
- Run real corpus questions and a production quota drill.
- Capture desktop/mobile screenshots and a short interaction video.
- Update the portfolio with Live Demo and Repository actions.
- Update the README with hosted architecture, evaluation, privacy, deployment,
  limitations, and cost controls.

Exit criteria:

- The live demo works in a clean browser session.
- Citations open the correct PDFs.
- Capacity and reset time are visible.
- Exhaustion cannot invoke billable fallback behavior.
- All portfolio claims and displayed metrics are verifiable.

## Release boundaries

- Release 1 — Phases 0–6: hosted, credible, citation-verifiable demo.
- Release 2 — Phases 7–8: explainability and private browser PDF mode.
- Release 3 — Phases 9–10: measured, hardened, portfolio-ready launch.
