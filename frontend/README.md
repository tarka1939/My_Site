# /frontend

Placeholder — Angular app, not yet initialized.

Initialization happens in Phase 3 (`PROJECT_TODO.md`): standalone components, signals for state (no NgRx), lazy-loaded feature routes, a typed API client generated from `docs/openapi.yaml` via `openapi-generator-cli`. Build uses the default `--base-href /` (Netlify serves from root — see `CLAUDE.md`), plus a `frontend/public/_redirects` file (`/* /index.html 200`) for the SPA routing fallback — updated 2026-07-25, originally GitHub Pages/`404.html`; see `docs/DECISIONS.md`.

See `CLAUDE.md` (repo root) for the locked-in architecture conventions this needs to follow once scaffolded.
