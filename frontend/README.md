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
