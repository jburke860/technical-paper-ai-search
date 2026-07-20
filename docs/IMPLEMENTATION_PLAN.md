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

Status: complete

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

Implementation: a dedicated Web Worker
(`frontend/lib/local-documents/pdf.worker.ts`) validates the file, extracts
text with PDF.js in fake-worker mode, builds bounded overlapping passages,
embeds them with a quantized MiniLM model via Transformers.js, and serves
hybrid BM25 + semantic RRF search with the same constant, deduplication, and
retrieval explanation as the hosted pipeline. Every stage enforces explicit
limits (20 MB, 200 pages, 500k characters, 400 chunks, batch sizes, and
per-stage timeouts) with visible progress and cooperative cancellation; if the
embedding model cannot be downloaded, search degrades to keyword-only ranking
and says so. The index lives in worker memory with opt-in IndexedDB
persistence and explicit cleanup on removal. Optional hosted synthesis posts
only the retrieved excerpts (max 5 × 800 characters) to the new
`POST /api/answer/local/stream` route, which passes the same quota
reservation as every other inference route.

Verification completed with Worker tests proving the synthesis route streams
from bounded excerpts without touching Vectorize, rejects invalid excerpt
shapes before inference, and fails closed behind both kill switches and the
shared global counter. Desktop and mobile Playwright flows index a generated
PDF fully in-browser and assert that no request ever carries the document
bytes or marker text, that opt-in synthesis transmits only bounded excerpts,
that oversized and non-PDF files fail safely, and that removal restores the
empty state. A network-gated spec (`LIVE_MODEL=1`) additionally verifies the
real embedding-model path end to end.

## Phase 9 — Quality and failure testing

Status: complete

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

Implementation: the Worker suite grew to 39 tests covering every validation
boundary, every quota denial code, provider failures (Vectorize outage,
malformed embedding/generation shapes, mid-stream interruption), the
prompt-injection guards on both generation prompts, citation numbering and
metadata mapping, CORS/preflight behavior, read-only routes while disabled,
and a bypass suite asserting all four inference routes share one quota gate
and that blocked requests never call AI or Vectorize. It exposed and fixed a
real bug: the streaming route returned its promise without awaiting, letting a
pre-stream generation failure escape the 503 error contract. Frontend
Playwright coverage (42 tests, desktop and mobile) exercises the streamed
answer flow, empty questions, status failure, load-time and mid-session
exhaustion, burst limits, interrupted streams with retry, history restoration,
copy actions, citation navigation, PDF viewer failure, keyboard-only drawer
use, reduced motion, local-PDF ingestion, cancellation, and oversized/invalid
files; it exposed and fixed a crash in the exhausted-state banner
(`toLocaleString` option conflict). Fourteen Vitest unit tests pin the local
chunking bounds and the local BM25/RRF parity with the hosted formula. Drawer
focus trapping and restoration were implemented (`lib/use-drawer-focus.ts`)
and are verified by a keyboard-only test.

Verification: axe WCAG A/AA scans pass with zero violations across the
initial, answer/explanation, and local-document states after darkening the
muted text token to reach 4.5:1 contrast and making the PDF scroll region
keyboard-focusable; Lighthouse accessibility scores 100 on the production
build. Retrieval evaluation now records recall@5 1.0, MRR@5 0.826, plus
duplicate-result rate 0, citation-page accuracy 1.0, and missing-metadata
rate 0 in `evaluation/baseline.json`; a dependency-free corpus quality gate
(`evaluation/check_corpus_quality.py`) enforces manifest-hash determinism and
Worker-bundle sync. `.github/workflows/ci.yml` runs corpus rebuild
determinism (pinned PyMuPDF), the Worker suite/typecheck/deploy dry run,
frontend lint/unit/build, and both Playwright projects with hosted bindings
mocked and the model CDN blocked — no job can consume Workers AI or any paid
service. Every pre-deployment failure drill is mapped to its automated
rehearsal in [`FAILURE_DRILLS.md`](FAILURE_DRILLS.md).

## Phase 10 — Production and portfolio launch

Status: deployed and activated 2026-07-20; portfolio assets pending

Launch record: provisioned Vectorize (262 vectors under content-hash ids) and
D1 with the quota migration on the dedicated no-payment-method Free account,
deployed the combined Worker (static export + API) to
https://technical-paper-ai-search.jeremy-burke024.workers.dev in the disabled
state, verified fail-closed behavior live, then executed the controlled
activation: D1 switch on, `DEMO_ENABLED` on, one real question confirmed the
counter increment, the emergency-shutdown drill passed, and the lowered-limit
exhaustion drill blocked the next request before AI execution with the stored
day cap correctly refusing to ratchet back up. The live exhausted state was
verified in a real browser (banner, disabled ask action, curated library and
local mode still available). Full procedure in [`DEPLOYMENT.md`](DEPLOYMENT.md).

Remaining: clean-browser verification of the full answer flow after the UTC
midnight quota reset, current screenshots and interaction recording, and the
portfolio card update.

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

## Post-launch enhancements (2026-07-20)

Completed the day after activation, deployed through the same guardrails:

- Corpus expanded from 3 to 10 papers (658 chunks) in the spacecraft-autonomy
  and aerospace computer-vision theme. All seven additions are CC BY 4.0
  arXiv papers whose metadata was taken from the arXiv API, never from
  memory; PDFs are re-hosted under their licenses with `license` recorded in
  `data/papers.json`. Vectors were re-embedded with the production model and
  upserted under content-hash ids.
- Exact-passage citation highlighting: `backend/corpus.py` maps every chunk
  back to its page lines during ingestion and stores merged, normalized
  bounding boxes (`highlight_boxes`, avg 8 per chunk); the Worker passes them
  through search results and the PDF viewer renders them as overlays on the
  cited page.
- Evaluation set expanded from 24 to 59 page-targeted questions authored from
  actual chunk text; one legacy annotation was broadened because the expanded
  corpus contains new papers that legitimately answer it. Baseline: recall@5
  1.0, MRR@5 0.840, duplicate rate 0, citation-page accuracy 1.0.
- Browser-local mode now supports up to 3 simultaneous documents with
  per-document removal, merged cross-document RRF ranking, and set-level
  IndexedDB persistence.
- Interface polish: rotating example questions, a quota explainer popover on
  the status pill, visible "Made by Jeremy Burke" attribution, decorative
  navigation removed.
