# Frontend

Documentation for this project lives in the [root README](../README.md).

**Quick start:** from this directory, run `npm install` and `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

The hosted application uses same-origin `/api` requests. To use the legacy
local FastAPI backend during development, start it first and run:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

See the root README for the complete local setup.

The production shell uses locally bundled fonts and generates its favicon and
social preview through the Next.js app metadata routes. Set
`NEXT_PUBLIC_SITE_URL` to the final public origin when deploying so social-card
URLs resolve to that origin.

The primary hosted workflow calls `/api/answer/stream` once per question. It
renders sources before streamed answer tokens, turns `[Source N]` references
into evidence controls, and stores up to eight completed sessions in browser
local storage. No history is sent back to the application owner.

## Citation PDF viewer

`npm run dev` and `npm run build` first run `scripts/sync-pdfs.mjs`. The script
copies only the included documents from the canonical root corpus into ignored
static build assets and copies the pinned PDF.js worker. This avoids committing
duplicate PDF binaries while keeping the hosted viewer same-origin and free of
runtime storage services.

The PDF.js viewer is dynamically imported only when a visitor opens a citation.
It renders the cited page with navigation, zoom, open, and download controls.
When extraction coordinates are unavailable, the exact cited page remains
visible and the supporting text excerpt is shown below it.

```bash
npm run test:e2e
```

The Playwright suite runs the viewer at desktop and mobile viewports and verifies
that no PDF request occurs before citation interaction.
