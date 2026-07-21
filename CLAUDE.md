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

- **Repo layout:** monorepo — `/backend` (Spring Boot), `/frontend` (Angular), `/docs` (spec, data model, decisions, OpenAPI contract).
- **Hosting split (hard constraint, not a config choice):** frontend deploys as a static build to GitHub Pages; backend deploys separately to a self-managed VPS (specific provider not yet chosen — this overrides the TODO's original Render/Railway/Fly.io default). Pages cannot run Spring Boot — there is no way to make it do so.
- **Cross-origin:** Spring Boot must explicitly allowlist the GitHub Pages origin (`https://tarka1939.github.io`) in CORS config — frontend and backend live on different domains, so this isn't optional.
- **SPA routing on Pages:** this is a GitHub *project* page (`tarka1939/My_Site` → `https://tarka1939.github.io/My_Site/`), so the Angular build needs `--base-href /My_Site/`, plus a `404.html` copy of `index.html` (GitHub Pages has no server-side rewriting) — without it, refreshing or deep-linking to an Angular route 404s.
- **Contract-first:** `docs/openapi.yaml` is the source of truth for the API and is written before backend or frontend code. The Angular client is generated from it (`openapi-generator-cli`) rather than hand-written — don't add HTTP calls that bypass the generated client.
- **Backend layering:** package-by-feature, not a single layered controller/service/repository split. Initial packages: `project/`, `contact/`. Phase 7 adds `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/` as isolated packages, each self-contained. Within each package, still keep DTOs at the controller boundary — never return JPA entities directly from controllers.
- **Cross-feature communication:** Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) — this is what lets Phase 7 extensions (analytics, GitHub sync) react to core CMS actions without being directly coupled to it.
- **Async/background jobs:** a dedicated `@Async` task executor bean, provisioned in Phase 1 before anything uses it — the DSP demo (Phase 7d) needs this for non-blocking audio processing.
- **Feature rollout:** config-based feature flags per extension, so the core CMS can ship live while Phase 7 extensions are still half-built.
- **Schema changes:** Flyway migrations only (`V1__init.sql`, ...). Never rely on `hibernate.ddl-auto=update` outside local scratch experiments.
- **Frontend:** standalone Angular components, signals for state. No NgRx (out of scope by design — see `docs/DECISIONS.md`).
- **Auth:** JWT admin login guarding write endpoints — confirmed in scope, see the "Auth scope decision" in `SPEC.md`.

## Where to look first

- `SPEC.md` — scope and non-goals (source of truth; update before changing code)
- `docs/DECISIONS.md` — locked-in technical decisions and why
- `docs/DATA_MODEL.md` — entities and relationships
- `PROJECT_TODO.md` — phase-by-phase build plan
- `AGENT_LOG.md` — record agent mistakes/fixes here per Phase 4 workflow
