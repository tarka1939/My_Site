# My Site

_One-sentence description of the site._

## Status

Phase 0 — spec & contract (planning docs in progress; no code scaffolded yet). See `PROJECT_TODO.md` for the full phase plan.

## Overview

- **What it is:**
- **Who it's for:**
- **Live URL:** (once deployed)

## Stack

| Layer | Choice |
|---|---|
| Frontend framework | Angular — standalone components, signals for state, no NgRx — **confirmed** |
| Frontend hosting | **Netlify** (static build) — **confirmed**, overrides the TODO's GitHub Pages default; native SPA routing, no non-commercial ToS restriction |
| Backend | Spring Boot, package-by-feature + **Spring Modulith** (enforced module boundaries): `project/`, `contact/`, plus Phase 7 additions `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/` |
| Backend hosting | Self-managed VPS — **overrides** the TODO's Render/Railway/Fly.io PaaS default; specific provider not yet chosen |
| Database | PostgreSQL |
| ORM / migrations | Spring Data JPA + Hibernate; Flyway (never `hibernate.ddl-auto=update` outside local scratch) |
| API contract | OpenAPI 3.0, written before implementation; Angular client generated via `openapi-generator-cli` |
| Auth | JWT admin login (1 hour expiry) + password reset via Resend — **confirmed in scope**, gates write endpoints (see `SPEC.md` → Auth scope decision) |
| Cross-origin | CORS on Spring Boot, allowlisting the Netlify origin — exact `*.netlify.app` subdomain **TBD until the Netlify site is created** (Phase 5) |
| CI/CD | GitHub Actions — separate workflows for Netlify deploy (frontend) and container build/deploy (backend) |
| Task tracking | GitHub Projects board (Backlog → Ready → In Progress → In Review → Done) |

See `docs/DECISIONS.md` for full reasoning. All 14 foundational decisions are now confirmed except the specific VPS provider and the exact Netlify subdomain, both deliberately deferred to Phase 5.

## Repo structure

```
/backend
  /project        Project CRUD (title, description, tags, links, images)
  /contact        Contact form + rate limiting
  /analytics      Phase 7c — usage analytics (privacy-respecting)
  /githubsync     Phase 7a — GitHub webhook auto-sync
  /agentlog       Phase 7b — rendered agent build-log page
  /dspdemo        Phase 7d — live DSP/audio demo (built last)
/frontend         Angular app (standalone components, signals)
/docs             SPEC, data model, decisions, OpenAPI contract
.github/workflows Separate CI/CD: Netlify deploy (frontend), container build/deploy (backend)
```

Backend is package-by-feature with Spring Modulith enforcing boundaries between packages, not a single layered controller/service/repository split — each Phase 7 extension is meant to be an isolated, boundary-checked module.

## Constraints & caveats

- **Frontend hosting (Netlify) only ever hosts the Angular frontend** — the backend needs a separate host (self-managed VPS) regardless.
- **Backend hosting is a self-managed VPS**, not a managed PaaS — the free-tier "spins down on inactivity" caveat from the TODO doesn't apply, but in exchange you own things a PaaS would otherwise handle: OS patching, TLS certificate renewal (e.g. via certbot), a reverse proxy (e.g. Nginx) in front of the Spring Boot process, and process supervision/restarts. Budget setup time for this in Phase 5.
- Phase 7's sequencing (ship one extension before starting the next) is a discipline call, not something the architecture enforces on its own.
- The live DSP demo (7d) carries the most hosting-cost/reliability risk — budget for the possibility it needs more resources or a queue/backpressure mechanism sooner than the others.

## Getting started

### Prerequisites

- JDK 25, Node 24 (see note below), Docker
- No custom domain planned — frontend serves from a Netlify subdomain (`*.netlify.app`, exact name TBD until the site is created in Phase 5). Netlify serves from root, so `--base-href` uses the Angular default (`/`) — no repo-name subpath needed, unlike the GitHub Pages project-page setup originally planned.

> **Note on versions:** JDK 21 / Node 20 were floated initially as "current LTS," but that's stale as of mid-2026 — Node 20 is past its recommended window (Node 24 is the current active LTS; Node 22 is maintenance-only), and JDK 21 permissive-license updates end September 2026 (JDK 25 is the current LTS). Updated to JDK 25 + Node 24 accordingly — override if you have a specific reason to pin older versions.

### Local development

```bash
# Fill in setup commands once Phase 1/3 scaffolding exists
```

## Documentation

- [`SPEC.md`](./SPEC.md) — scope, non-goals
- [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) — entities and relationships
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — locked-in decisions and rationale
- [`AGENT_LOG.md`](./AGENT_LOG.md) — multi-agent workflow log
- [`PROJECT_TODO.md`](./PROJECT_TODO.md) — phased build plan
- [`CHANGELOG.md`](./CHANGELOG.md) — notable changes over time

## License

All rights reserved.
