# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit conventions
Never add "Co-Authored-By" lines to commits. Do not include Claude attribution in commit messages, PR descriptions, or any git metadata.

## PR conventions
Every PR needs three pieces of metadata set, not just opened against `main`:
- **Issues closed:** reference them in the PR body with GitHub's closing keywords, **one keyword per issue on its own line** (`Closes #20`, newline, `Closes #21`, ...) — not just prose, and not a comma-separated list after a single keyword (`Closes #20, #21`), which despite GitHub's own docs only actually links/auto-closes the *first* issue in practice (confirmed via `gh api graphql` querying `closingIssuesReferences` on PR #80 — the rendered PR body looks identical either way, so this fails silently). Verify with that same GraphQL query before trusting a multi-issue PR actually linked everything, not just by eyeballing the body text.
- **Milestone:** set to the matching phase (e.g. "Phase 2"). Milestone numbers aren't the same as phase numbers — look them up with `gh api repos/tarka1939/My_Site/milestones --jq '.[] | "\(.number): \(.title)"'` rather than guessing, then set via the issue/PR update call (PRs share the Issues API for this).
- **Project board:** add the PR to project #1 ("My Site") and set its Status field (`Todo`/`In Progress`/`In Review`/`Done`/`Canceled`) — `In Review` once the PR is open and ready for review.

## PROJECT_TODO.md discipline
Keep `PROJECT_TODO.md`'s phase status blurb current for the *whole* time a phase is being worked, not just once at the initial completion checkpoint. If you do any follow-up after a phase's checklist is first checked off — review-round fixes, hardening, a process/infra discovery like a misconfigured default branch — go back and update that phase's status note (and `AGENT_LOG.md`) to reflect it, in the same session, before moving on. A repeat mistake in this project specifically: fixing something and logging it in `AGENT_LOG.md` alone, without touching `PROJECT_TODO.md`, leaves the phase's own status blurb stale and understates what actually happened.

> Status: `/backend` has full Project CRUD, tag listing, contact form + rate limiting, JWT login, and password reset (Phases 1-2). `/frontend` is scaffolded with routing, a generated API client, auth, and the core CMS pages (Phase 3).

## Project

My Site — portfolio site (Angular + Spring Boot). Full scope lives in `SPEC.md`; phased build plan in `PROJECT_TODO.md`.

## Commands

### Backend (`/backend`)

Requires JDK 25 and Maven on `PATH` (or `JAVA_HOME`/`MAVEN_HOME` set). Requires a running
PostgreSQL instance for anything beyond `compile`/`test` — Phase 1 has no `docker-compose.yml`
yet (that's Phase 5), so point `DB_NAME`/`DB_USERNAME`/`DB_PASSWORD` at whatever Postgres
you have locally, or run one yourself: `docker run -e POSTGRES_USER=mysite -e POSTGRES_PASSWORD=mysite -e POSTGRES_DB=mysite_dev -p 5432:5432 postgres`.

```bash
# Build (compile only, no DB needed):
cd backend && mvn compile

# Run locally (dev profile, needs Postgres reachable — see above):
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev

# Run all tests (unit tests + Spring Modulith ApplicationModules.verify() — no DB needed;
# Testcontainers integration tests additionally need a running Docker daemon):
cd backend && mvn test

# Run a single test:
cd backend && mvn test -Dtest=ProjectServiceTest

# Lint: no linter/formatter has been decided yet (not in docs/DECISIONS.md) — nothing to run.

# Package an executable jar:
cd backend && mvn clean package
```

### Frontend (`/frontend`)

Requires Node 24+. `ng serve`'s dev-server proxy (`frontend/proxy.conf.json`) forwards `/api/*`
to `http://localhost:8080` so the browser sees same-origin requests — the backend has no CORS
config yet (that's Phase 5, and only covers the deployed Netlify origin, not local dev), so
without the proxy every API call from `ng serve` fails with a CORS error. Regenerating the API
client (`npm run generate:api`) needs Java (JDK 11+) on `PATH`, since `openapi-generator-cli`
shells out to a Java-based generator.

```bash
# Install:
cd frontend && npm install

# Dev server (proxies /api to localhost:8080 — see above; start the backend first for real data):
cd frontend && npm start

# Build (production, default --base-href /):
cd frontend && npm run build

# Run all tests (Vitest):
cd frontend && npm test

# Run a single test file:
cd frontend && npx ng test --include='**/projects-list.component.spec.ts'

# Regenerate the typed API client from docs/openapi.yaml:
cd frontend && npm run generate:api

# Lint: no linter/formatter has been decided yet (not in docs/DECISIONS.md) — nothing to run.
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
- **Error handling:** the centralized exception handler extends Spring's `ResponseEntityExceptionHandler`, not a bare `@RestControllerAdvice` with a broad `@ExceptionHandler(Exception.class)` catch-all. The latter intercepts standard Spring MVC exceptions (malformed request body, wrong HTTP method, unsupported media type) *before* Spring's own correct 4xx mapping ever runs, silently turning all of them into 500s — a real regression shipped and caught during Phase 1 review, see `AGENT_LOG.md` 2026-08-01. A generic catch-all should only ever match what neither the base class nor a more specific handler already covers.
- **Cross-feature communication:** Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) — this is what lets Phase 7 extensions (analytics, GitHub sync) react to core CMS actions without being directly coupled to it. Consider `spring-modulith-events` for durable/transactional event publication once this is built (not yet decided).
- **Async/background jobs:** a dedicated `@Async` task executor bean, provisioned in Phase 1 before anything uses it — the DSP demo (Phase 7d) needs this for non-blocking audio processing.
- **Feature rollout:** config-based feature flags per extension, so the core CMS can ship live while Phase 7 extensions are still half-built.
- **Schema changes:** Flyway migrations only (`V1__init.sql`, ...). Never rely on `hibernate.ddl-auto=update` outside local scratch experiments.
- **Frontend:** standalone Angular components, signals for state. No NgRx — confirmed 2026-07-25, this site's state is simple and mostly server-derived (see `docs/DECISIONS.md`). The typed API client (`frontend/src/app/core/api`, generated via `npm run generate:api`) is committed rather than gitignored-and-regenerated-in-CI, so the Netlify build never needs a JVM. A functional `authInterceptor` attaches the admin JWT (from `AuthService`'s signals, not the generated client's own unused `Configuration.credentials.bearerAuth`) and a separate `errorInterceptor` normalizes every failed response into an `ApiProblem` — components branch on `fieldErrors`/`rateLimited` instead of re-parsing RFC 7807 bodies themselves, and non-field errors surface via a global `NotificationService` banner rather than per-component ad hoc handling.
- **Local dev CORS:** the backend has no CORS config yet (Phase 5 adds it, for the deployed Netlify origin only) — `ng serve` works around this with a dev-server proxy (`frontend/proxy.conf.json` forwards `/api/*` to `localhost:8080`) rather than requiring a backend change just for local dev. `environment.development.ts`'s `apiBaseUrl` is deliberately a relative path (`/api/v1`) for this to work; `environment.ts` (prod) stays an absolute URL.
- **Auth:** JWT admin login guarding write endpoints, 1 hour token expiry, password reset via a transactional email API (Resend) — confirmed in scope, see the "Auth scope decision" in `SPEC.md` and `docs/DECISIONS.md`.
- **Security defaults:** any interim or placeholder security config (before Phase 2's real JWT auth lands) must fail closed, never open — deny by default, permit only under an explicitly-named allow case (e.g. an active `dev` profile), not the reverse. Learned the hard way in Phase 1: an inverted `@Profile("!prod")` predicate meant "permit everything" was the default for *any* profile that wasn't literally `prod`, including no profile set at all — see `AGENT_LOG.md` for the full incident and fix.

## Where to look first

- `SPEC.md` — scope and non-goals (source of truth; update before changing code)
- `docs/DECISIONS.md` — locked-in technical decisions and why
- `docs/DATA_MODEL.md` — entities and relationships
- `PROJECT_TODO.md` — phase-by-phase build plan
- `AGENT_LOG.md` — record agent mistakes/fixes here for the whole project, not just Phase 4
- `docs/AGENT_WORKFLOW.md` — how to run agent sessions (sequential single-agent vs. dispatcher vs. isolated worktrees) and when each applies; see also `.claude/agents/backend-agent.md` and `.claude/agents/frontend-agent.md`
