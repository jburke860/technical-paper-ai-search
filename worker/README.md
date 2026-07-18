# Hosted Cloudflare Worker API

This directory contains the production API for the hosted portfolio demo. It
uses Workers AI for query embeddings and grounded generation, Vectorize for
semantic retrieval, a bundled sparse BM25 index for keyword retrieval, and RRF
for deterministic hybrid ranking. D1 is bound now and becomes the fail-closed
global quota ledger in Phase 3.

The hosted runtime does not import or install Python, Torch, Chroma, Ollama, or
the source PDFs.

## API

| Route | Method | Purpose |
|---|---:|---|
| `/api/status` | GET | Corpus and pinned-model status |
| `/api/papers` | GET | Included paper metadata |
| `/api/search` | POST | Vectorize + BM25/RRF retrieval |
| `/api/answer` | POST | Grounded Workers AI answer and sources |

Search and answer requests accept:

```json
{
  "question": "How does functional-level autonomy differ from system-level autonomy?",
  "n_results": 5
}
```

## Local verification

```bash
cd worker
npm install
npm run build:assets
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
upgrade the account plan.

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

Deploy and verify:

```bash
npm run deploy
curl https://technical-paper-ai-search.<your-subdomain>.workers.dev/api/status
curl https://technical-paper-ai-search.<your-subdomain>.workers.dev/api/search \
  -H 'Content-Type: application/json' \
  -d '{"question":"How does functional-level autonomy differ from system-level autonomy?","n_results":5}'
```

Phase 3 must be completed before linking the public deployment from the
portfolio. It adds the global application-level circuit breaker required by
the zero-cost contract.
