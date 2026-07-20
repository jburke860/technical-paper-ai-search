# Hosted Cloudflare Worker API

This directory contains the production API for the hosted portfolio demo. It
uses Workers AI for query embeddings and grounded generation, Vectorize for
semantic retrieval, a bundled sparse BM25 index for keyword retrieval, and RRF
for deterministic hybrid ranking. D1 is the fail-closed global quota ledger:
no hosted inference runs unless both kill switches and every quota reservation
succeed.

The hosted runtime does not import or install Python, Torch, Chroma, Ollama, or
the source PDFs.

## API

| Route | Method | Purpose |
|---|---:|---|
| `/api/status` | GET | Corpus, model, availability, remaining quota, and UTC reset status |
| `/api/papers` | GET | Included paper metadata |
| `/api/search` | POST | Vectorize + BM25/RRF retrieval |
| `/api/answer` | POST | Grounded Workers AI answer and sources |
| `/api/answer/stream` | POST | NDJSON sources, answer deltas, and completion events |

Search and answer requests accept:

```json
{
  "question": "How does functional-level autonomy differ from system-level autonomy?",
  "n_results": 5
}
```

The streaming endpoint emits one JSON object per line. A `sources` event arrives
before `delta` events, followed by `done`. If generation is interrupted after
headers are sent, the stream ends with an `error` event. It uses the same quota
reservation as the non-streaming routes.

Every result also includes deterministic retrieval-explanation fields: final
rank, semantic and BM25 ranks, each list's RRF contribution, retriever agreement,
and exact query concepts present in the passage. See
[`docs/RETRIEVAL_EXPLAINABILITY.md`](../docs/RETRIEVAL_EXPLAINABILITY.md) for the
formula and interpretation limits.

## Local verification

```bash
cd worker
npm install
npm run build:assets
npm exec wrangler d1 migrations apply technical-paper-search-quota -- --local
npm run typecheck
npm test
npm run deploy -- --dry-run
```

The test suite supplies mock AI and Vectorize bindings. It does not consume
Cloudflare usage.

## One-time Free-plan provisioning

Use the dedicated Cloudflare account required by `COST_GUARDRAILS.md`. Confirm
that it has no payment method and remains on Workers Free before continuing.

```bash
cd worker
npx wrangler login
npx wrangler vectorize create technical-paper-search \
  --dimensions=384 \
  --metric=cosine
npx wrangler d1 create technical-paper-search-quota
```

Copy the returned D1 database UUID into `wrangler.jsonc`. Do not change or
upgrade the account plan. Apply the schema while the two independent kill
switches remain off:

```bash
npx wrangler d1 migrations apply technical-paper-search-quota --remote
```

The migration creates `demo_control` with `enabled = 0`, and the checked-in
`DEMO_ENABLED` value is also `false`. A new deployment therefore fails closed
even if one switch is accidentally changed.

Generate corpus embeddings using the same BGE model and `cls` pooling used for
queries. The script requires an API token supplied only through the environment
and refuses to run without explicit remote-usage confirmation:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-short-lived-api-token"
backend/.venv/bin/python scripts/build_cloudflare_vectors.py --confirm-remote
cd worker
npx wrangler vectorize upsert technical-paper-search --file=vectors.ndjson
```

Delete or unset the short-lived token after indexing. `vectors.ndjson` is
ignored by Git.

Deploy and verify the disabled state first:

```bash
npm run deploy
curl https://technical-paper-ai-search.<your-subdomain>.workers.dev/api/status
```

The status payload must report `DEMO_DISABLED`. Only after every checklist item
in `COST_GUARDRAILS.md` passes, enable the D1 switch and explicitly change
`DEMO_ENABLED` to `true` for the production deployment. Keep
`DAILY_DEMO_LIMIT` at or below 200.

```bash
npx wrangler d1 execute technical-paper-search-quota --remote \
  --command='UPDATE demo_control SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
npm run deploy
curl https://technical-paper-ai-search.<your-subdomain>.workers.dev/api/search \
  -H 'Content-Type: application/json' \
  -d '{"question":"How does functional-level autonomy differ from system-level autonomy?","n_results":5}'
```

To stop all dynamic usage immediately, set either switch to false. The D1
switch is the fastest independent stop and does not require a code change:

```bash
npx wrangler d1 execute technical-paper-search-quota --remote \
  --command='UPDATE demo_control SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
```

The global counter is keyed by UTC date and survives Worker restarts and
deployments. Limits are never automatically raised for an existing day. A
quota-store error, invalid limit, or ambiguous reservation returns `503` before
Workers AI or Vectorize is called. Reservations are intentionally not refunded
after an inference failure.
