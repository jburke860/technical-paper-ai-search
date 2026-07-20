# Deployment Runbook

Production runs one Cloudflare Worker that serves both the static frontend
export and the quota-protected API on the Workers Free plan. This documents
the exact procedure used for the 2026-07-20 launch and the standing
operational commands. Prerequisites for any deployment are the checklist in
[`COST_GUARDRAILS.md`](../COST_GUARDRAILS.md) — above all: no payment method
on the account, Workers Free plan, both kill switches off by default.

Live URL: https://technical-paper-ai-search.jeremy-burke024.workers.dev

## One-time provisioning

```bash
cd worker
npx wrangler login

# 1. Vector index (dimensions/metric must match BGE-small)
npx wrangler vectorize create technical-paper-search --dimensions=384 --metric=cosine

# 2. Quota database; put the printed database_id into wrangler.jsonc
npx wrangler d1 create technical-paper-search-quota
npx wrangler d1 migrations apply technical-paper-search-quota --remote

# 3. Corpus embeddings with the production model, via the local helper
#    (tools/embed-worker.ts proxies env.AI through the wrangler session;
#    it is never deployed). Alternative: scripts/build_cloudflare_vectors.py
#    with an API token.
cd tools && npx wrangler dev --config wrangler-embed.jsonc --port 8790
# ...batch data/corpus.json texts against localhost:8790 into vectors.ndjson,
#    with each vector id set to the chunk's content_hash (Vectorize ids are
#    limited to 64 bytes; chunk ids can be longer).
cd .. && npx wrangler vectorize insert technical-paper-search --file vectors.ndjson
npx wrangler vectorize info technical-paper-search   # wait for vectorCount 262
```

## Deploying

```bash
cd frontend && npm run build     # static export into frontend/out
cd ../worker && npx wrangler deploy
```

Deploys are safe while `DEMO_ENABLED` is `"false"` in `wrangler.jsonc` or the
D1 `demo_control` switch is 0: static pages, `/api/status`, and `/api/papers`
work; every inference route returns 503 before touching AI or Vectorize.

## Activation order (used at launch)

1. Confirm no payment method and Workers Free plan in the dashboard.
2. Deploy disabled; verify static pages, PDFs, `/api/status`, and that
   `POST /api/search` returns 503 `DEMO_DISABLED`.
3. Confirm `demo_control` exists with `enabled = 0`, then enable it:
   ```bash
   npx wrangler d1 execute technical-paper-search-quota --remote \
     --command "UPDATE demo_control SET enabled = 1 WHERE id = 1"
   ```
4. Set `DEMO_ENABLED` to `"true"` in `wrangler.jsonc` and redeploy.
5. Submit one real question; confirm `/api/status` shows `consumed` increment.
6. Emergency-shutdown drill: set the D1 switch to 0, confirm 503, restore.
7. Exhaustion drill: lower `DAILY_DEMO_LIMIT` (e.g. to 3), redeploy, consume
   it, confirm the next request fails with `DAILY_DEMO_LIMIT_REACHED` before
   AI execution, then restore `"200"` and redeploy. The stored day cap
   intentionally stays at the drill value until midnight UTC — stored caps
   only ratchet down.

## Emergency shutdown

Either control stops all hosted inference immediately; static content stays up.

```bash
# Fastest (no redeploy): database kill switch
npx wrangler d1 execute technical-paper-search-quota --remote \
  --command "UPDATE demo_control SET enabled = 0 WHERE id = 1"

# Environment kill switch: set "DEMO_ENABLED": "false" in wrangler.jsonc, then
npx wrangler deploy
```

Both were exercised against production at launch (see
[`FAILURE_DRILLS.md`](FAILURE_DRILLS.md) for the full drill map).

## Operational notes

- Quota state: `npx wrangler d1 execute technical-paper-search-quota --remote
  --command "SELECT * FROM daily_quota"` — never raise a current day's stored
  `quota_limit`.
- `ALLOWED_ORIGIN` is empty because the frontend is same-origin with the API;
  add origins (comma-separated) only if the UI ever moves to another host.
- `vectors.ndjson` is git-ignored; regenerate it rather than committing it.
- Corpus updates: rebuild (`scripts/build_corpus.py`,
  `scripts/build_worker_assets.py`), re-run the embedding step, re-insert
  vectors, redeploy, and run `evaluation/check_corpus_quality.py`.
