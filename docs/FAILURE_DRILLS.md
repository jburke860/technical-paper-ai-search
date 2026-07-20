# Failure Drills

Every deliberate failure the hosted demo must survive, the automated test that
rehearses it on every CI run, and the manual step that re-verifies it in
production before launch (Phase 10). The invariant in all drills: a blocked or
failing path must never reach Workers AI or Vectorize, and quota is never
refunded after inference begins.

| Drill | Automated rehearsal | Production verification |
|---|---|---|
| Exhaust the global quota | `worker/test/api.test.ts` — "stops all inference at the persisted global daily limit", "keeps the global counter across Worker restarts"; `frontend/e2e/research-flow.spec.ts` — exhausted-at-load and mid-session exhaustion flows | Lower `DAILY_DEMO_LIMIT`, submit questions past the cap, confirm 503 `DAILY_DEMO_LIMIT_REACHED` before AI execution, restore the limit without raising the stored day cap |
| Disable the environment kill switch | "fails closed before AI when either kill switch is off"; "blocks every inference route behind the environment kill switch" (all four POST routes) | Set `DEMO_ENABLED=false`, confirm every dynamic route returns 503 while `/api/status` and `/api/papers` stay readable |
| Disable the D1 kill switch | Same tests, `demo_control` variant via `createMockD1({ controlEnabled: false })` | Set `demo_control.enabled = 0` in D1, confirm identical fail-closed behavior |
| Simulate D1 unavailable | "fails the status check closed when D1 is unavailable"; "blocks every inference route when the quota store is unavailable" | Temporarily rename the D1 binding in a staging deploy, confirm `QUOTA_CHECK_UNAVAILABLE` on all inference routes |
| Interrupt the answer stream | Worker — "emits a terminal error event when the upstream stream breaks mid-answer", "emits an error event when the stream produces no tokens"; e2e — "recovers from an interrupted stream through the retry action" | Kill the network mid-answer in a browser, confirm the retryable error state |
| Return malformed generation data | Worker — empty generation response, unexpected embedding shape, non-stream generation result all return 503 `HOSTED_INFERENCE_UNAVAILABLE` | Not separately reproducible in production; covered by the stable 503 contract |
| Make the PDF viewer fail | e2e — "shows a safe failure state when the cited PDF cannot load" | Open a citation with the network throttled offline, confirm the viewer error state with the open-original fallback |
| Cancel local document processing | e2e — "cancels local processing and returns to the empty state" | Add a large PDF, cancel during model loading, confirm the page stays responsive |
| Oversized local PDF | e2e — "fails safely for unsupported and oversized files" (21 MB file and non-PDF file) | Attempt a >20 MB PDF, confirm immediate rejection without processing |
| No blocked path reaches hosted compute | Worker — every denial test asserts `AI.run` and `VECTOR_INDEX.query` were never called; "consumes exactly one global unit per request on every inference route" | Run the production quota-store failure check with request logs open; confirm zero AI invocations during blocked requests |

Vectorize outage is also rehearsed ("fails closed when Vectorize is unavailable
and does not refund quota") — the reserved unit is intentionally not returned,
favoring cost safety over availability per COST_GUARDRAILS.md.
