# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Status: no code exists yet (`/backend`, `/frontend` not scaffolded). This file is a placeholder — fill in each section as the corresponding phase in `PROJECT_TODO_1.md` is completed. Don't delete the structure below; it mirrors where commands/architecture notes will live once they exist.

## Project

[Project Name] — portfolio site (Angular + Spring Boot). Full scope lives in `SPEC.md`; phased build plan in `PROJECT_TODO_1.md`.

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

_Expand this once backend/frontend exist. Skeleton reflects the plan in `PROJECT_TODO_1.md`._

- **Repo layout:** monorepo — `/backend` (Spring Boot), `/frontend` (Angular), `/docs` (spec, data model, decisions, OpenAPI contract).
- **Contract-first:** `docs/openapi.yaml` is the source of truth for the API and is written before backend or frontend code. The Angular client is generated from it (`openapi-generator-cli`) rather than hand-written — don't add HTTP calls that bypass the generated client.
- **Backend layering:** controller → service → repository. DTOs at the controller boundary — never return JPA entities directly from controllers.
- **Schema changes:** Flyway migrations only (`V1__init.sql`, ...). Never rely on `hibernate.ddl-auto=update` outside local scratch experiments.
- **Frontend:** standalone Angular components, signals for state. No NgRx (out of scope by design — see `docs/DECISIONS.md`).
- **Auth:** optional JWT admin login guarding write endpoints — see the "Auth scope decision" in `SPEC.md` for whether this is actually in scope.

## Where to look first

- `SPEC.md` — scope and non-goals (source of truth; update before changing code)
- `docs/DECISIONS.md` — locked-in technical decisions and why
- `docs/DATA_MODEL.md` — entities and relationships
- `PROJECT_TODO_1.md` — phase-by-phase build plan
- `AGENT_LOG.md` — record agent mistakes/fixes here per Phase 4 workflow
