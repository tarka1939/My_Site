# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit conventions
Never add "Co-Authored-By" lines to commits. Do not include Claude attribution in commit messages, PR descriptions, or any git metadata.

> Status: no code exists yet (`/backend`, `/frontend` not scaffolded). This file is a placeholder — fill in each section as the corresponding phase in `PROJECT_TODO.md` is completed. Don't delete the structure below; it mirrors where commands/architecture notes will live once they exist.

## Project

My Site — portfolio site (Angular + Spring Boot). Full scope lives in `SPEC.md`; phased build plan in `PROJECT_TODO.md`.

## Commands

_Fill in once each part of the stack is scaffolded (Phase 1 backend, Phase 3 frontend)._

### Backend (`/backend`)

```
# Build:
# Run locally:
# Run all tests:
# Run a single test:
# Lint:
```

### Frontend (`/frontend`)

```
# Install:
# Dev server:
# Build:
# Run all tests:
# Run a single test:
# Lint:
```

### Full stack (Docker Compose)

```
# docker compose up — once docker-compose.yml exists (Phase 5)
```

## Architecture

_Expand this once backend/frontend exist. Skeleton reflects the plan in `PROJECT_TODO.md`._

> **Status (2026-07-25):** all 14 foundational decisions in `docs/DECISIONS.md` are confirmed except the specific VPS provider and the exact Netlify subdomain (both deferred to Phase 5). The bullets below reflect the confirmed choices.

- **Repo layout:** monorepo — `/backend` (Spring Boot), `/frontend` (Angular), `/docs` (spec, data model, decisions, OpenAPI contract).
- **Hosting split (hard constraint, not a config choice):** frontend deploys as a static build to Netlify (overrides the TODO's original GitHub Pages default — see `docs/DECISIONS.md`); backend deploys separately to a self-managed VPS (specific provider not yet chosen — this overrides the TODO's original Render/Railway/Fly.io default). Neither hosts a JVM process — the backend needs its own host regardless.
- **Cross-origin:** Spring Boot must explicitly allowlist the Netlify origin in CORS config — frontend and backend live on different domains, so this isn't optional. Exact origin (`*.netlify.app` subdomain) is TBD until the Netlify site is created in Phase 5.
- **SPA routing:** Netlify handles this natively via a `frontend/public/_redirects` file (`/* /index.html 200`) — no GitHub-Pages-style `404.html` copy trick needed. `--base-href` uses the Angular default (`/`), since Netlify serves from root rather than a repo-name subpath.
- **Contract-first:** `docs/openapi.yaml` is the source of truth for the API and is written before backend or frontend code. The Angular client is generated from it (`openapi-generator-cli`) rather than hand-written — don't add HTTP calls that bypass the generated client.
- **Backend layering:** package-by-feature, enforced with **Spring Modulith** — not a single layered controller/service/repository split. Initial packages: `project/`, `contact/`. Phase 7 adds `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/` as isolated packages, each self-contained. A Spring Modulith verification test (`ApplicationModules.verify()`) enforces that packages only interact through public APIs or events, not internal classes. Within each package, still keep DTOs at the controller boundary — never return JPA entities directly from controllers.
- **Cross-feature communication:** Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) — this is what lets Phase 7 extensions (analytics, GitHub sync) react to core CMS actions without being directly coupled to it. Consider `spring-modulith-events` for durable/transactional event publication once this is built (not yet decided).
- **Async/background jobs:** a dedicated `@Async` task executor bean, provisioned in Phase 1 before anything uses it — the DSP demo (Phase 7d) needs this for non-blocking audio processing.
- **Feature rollout:** config-based feature flags per extension, so the core CMS can ship live while Phase 7 extensions are still half-built.
- **Schema changes:** Flyway migrations only (`V1__init.sql`, ...). Never rely on `hibernate.ddl-auto=update` outside local scratch experiments.
- **Frontend:** standalone Angular components, signals for state. No NgRx — confirmed 2026-07-25, this site's state is simple and mostly server-derived (see `docs/DECISIONS.md`).
- **Auth:** JWT admin login guarding write endpoints, 1 hour token expiry, password reset via a transactional email API (Resend) — confirmed in scope, see the "Auth scope decision" in `SPEC.md` and `docs/DECISIONS.md`.

## Where to look first

- `SPEC.md` — scope and non-goals (source of truth; update before changing code)
- `docs/DECISIONS.md` — locked-in technical decisions and why
- `docs/DATA_MODEL.md` — entities and relationships
- `PROJECT_TODO.md` — phase-by-phase build plan
- `AGENT_LOG.md` — record agent mistakes/fixes here per Phase 4 workflow
