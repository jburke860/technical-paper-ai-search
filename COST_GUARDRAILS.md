# Zero-Cost Operating Guardrails

This document is the deployment contract for the hosted portfolio demo. The
demo must remain incapable of producing an infrastructure or model-usage bill.
Availability is secondary to this requirement: when capacity is exhausted or
cannot be verified, the dynamic demo must stop for everyone.

## Allowed production services

- Cloudflare Workers Free
- Cloudflare Workers AI Free allocation
- Cloudflare Vectorize Free allocation
- Cloudflare D1 Free allocation
- Cloudflare static assets on a free `workers.dev` or `pages.dev` URL
- GitHub-hosted source code and deployment automation that does not require a
  paid plan

The four curated PDFs are served as static assets. R2 is not required for the
initial hosted release.

## Prohibited production services

- Workers Paid or any Cloudflare paid subscription
- A billing method attached to the dedicated deployment account
- Paid model APIs or automatic fallback providers
- Paid vector databases, object storage, monitoring, analytics, or domains
- Usage-based resources that continue serving after a free allocation is
  exhausted
- Public server-side PDF persistence or anonymous mutation of the curated index

If a future feature cannot operate within these constraints, it must run in the
visitor's browser, remain local-only, or be omitted.

## Application limits

Initial limits for the hosted demo:

| Control | Limit |
|---|---:|
| Complete hosted questions | 200 per UTC day globally |
| Questions per browser | 20 per UTC day |
| Burst rate | 3 questions per minute per browser |
| Question length | 500 characters |
| Retrieved sources | 5 |
| Total source context | 4,000 characters |
| Generated answer | 400 tokens maximum |

These are conservative application limits, not estimates of the provider's
remaining allowance. They may be lowered after measuring real usage, but they
must not be automatically raised.

## Required request sequence

Every route capable of consuming hosted compute must execute these checks in
this order:

1. Validate the request shape and size.
2. Verify the global `DEMO_ENABLED` kill switch.
3. Verify that the quota store is available.
4. Atomically reserve one unit from the global daily allowance.
5. Apply the per-browser and burst limits.
6. Only then call embeddings, vector retrieval, or answer-generation services.

If quota state is unavailable or ambiguous, the request must fail before any AI
binding is called. A reserved unit is not refunded after an upstream failure;
this intentionally favors cost safety over availability.

## Exhaustion behavior

When the application limit is reached, every dynamic search and answer route
returns:

```json
{
  "code": "DAILY_DEMO_LIMIT_REACHED",
  "message": "Today's hosted demo capacity has been reached.",
  "resetsAt": "<next-midnight-UTC>"
}
```

The response status is `503`. The frontend must disable hosted search and show
the reset time. Static project information, screenshots, architecture, and
curated example results may remain visible. A browser-only mode may continue
because it consumes no owner-funded infrastructure.

The deployment must also use fail-closed routing. Provider exhaustion, quota
storage failure, configuration errors, and unexpected exceptions must never
bypass the Worker or invoke a fallback provider.

## Global controls

The hosted implementation must provide:

- `DEMO_ENABLED`: global dynamic-demo kill switch, defaulting to `false` when
  missing or invalid
- `DAILY_DEMO_LIMIT`: explicit global limit with a code-owned safe maximum
- A D1-backed atomic daily counter keyed by UTC date
- A read-only `/api/status` response containing availability, remaining
  application units, and reset time
- A stable `DAILY_DEMO_LIMIT_REACHED` error contract
- Response headers exposing application capacity without provider credentials
- Request logs that never include full uploaded documents or private user text

## Deployment checklist

Before every production deployment:

- [ ] Confirm the deployment account has no payment method.
- [ ] Confirm the account remains on Workers Free.
- [ ] Confirm no paid services or fallback API keys are bound.
- [ ] Confirm `DEMO_ENABLED` is explicitly configured.
- [ ] Confirm the application daily limit is at or below the approved maximum.
- [ ] Confirm Worker routes fail closed.
- [ ] Run the quota-exhaustion integration test.
- [ ] Run the quota-store-failure integration test.
- [ ] Confirm AI calls are not made when either test blocks a request.
- [ ] Review provider pricing and free-plan terms for material changes.

If any item cannot be confirmed, do not deploy the dynamic API.

## Change-control rule

Any change that adds a service, raises a quota, introduces persistent uploads,
or changes billing behavior must update this document in the same commit. No
deployment script may create or upgrade a paid resource.
