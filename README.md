# My Site

_Personal portfolio site (Angular + Spring Boot), doubling as a practice ground for multi-agent development workflows._

## Status

**Phases 0-4 complete.** Spec and OpenAPI contract; backend foundation; core domain features (project CRUD, tags, contact form, JWT auth, password reset); frontend foundation (Angular app, routing, generated API client, auth, admin CRUD pages); and a Playwright end-to-end suite covering four critical journeys.

**Phase 6 (content & polish) is in progress** — a performance pass, a project date period, the content-rendering work real portfolio copy depends on, and a substantial hardening pass across both forms have landed. What remains needs decisions rather than code: per-image alt text, a contact route that does not depend on the contact endpoint, and the canonical domain the sitemap needs.

**Phase 5 (deployment) is paused** pending VPS setup, so nothing is deployed yet. Phase 6 and Phase 7 don't depend on it and are proceeding in the meantime.

`PROJECT_TODO.md` carries the authoritative per-phase status; this section summarises it and can lag.

## Overview

- **What it is:** A personal portfolio site (Angular + Spring Boot) hosting a project portfolio, doubling as a deliberate practice ground for multi-agent development workflows (spec-first, parallel agents, documented review).
- **Who it's for:** Visitors browsing the portfolio and submitting contact messages; a single site-owner admin managing project content.
- **Live URL:** (once deployed — Phase 5)

## How this is built

The second goal of this project, stated in `SPEC.md`, is to be a practice ground for multi-agent development. That's the part worth reading — the site itself is a portfolio site.

**Contract first, and it means something here.** `docs/openapi.yaml` is written and validated *before* implementation. When the `Project` model gained a date period, the contract, data model and ADR landed as one commit; only then was the backend built against it, and only after the backend passed its gates was the frontend dispatched. Neither implementation session was shown the other's code — the backend agent was told to stop and report if it thought the contract was wrong rather than quietly diverging, and it confirmed the contract was implementable as written. Both halves matched on the first attempt with no integration round.

Worth being precise about what that does and doesn't demonstrate: the two sessions ran sequentially in the *same* worktree, so the separation was a prompt-level instruction, not a filesystem boundary — and `docs/AGENT_WORKFLOW.md` is explicit that those are not the same thing. The frontend's client is also *generated* from the contract, so its agreement is partly mechanical rather than independent. The genuinely isolated backend-agent/frontend-agent exercise is scheduled for Phase 7 and has not run yet.

**One task, one worktree, one branch, one session.** Concurrent sessions never share a working directory — each gets its own `git worktree`, which is what makes simultaneous commits safe. Two `PreToolUse` hooks cover the mechanically checkable parts: force-pushes, hard resets and direct checkouts of `main` are denied unconditionally, and `Edit`/`Write` calls outside a session's assigned worktree are denied when that session opts in by exporting `CLAUDE_WORKTREE_ROOT`. The second is opt-in by design, so it doesn't restrict ordinary single-session work — which means it's a guard rail, not a guarantee.

**Three roles.** A coordinator session plans and dispatches but doesn't implement; a fresh session per task writes the code; and since 2026-08-02, **every PR is reviewed by a separate session with no shared context** — only the diff and the standing docs. Reviewers are given the PR pointer and told nothing about why an approach was taken.

**Nothing merges on a report.** Every gate is re-run by the coordinator before review is requested, and the review layer has no "unavailable" fallback. That last rule exists because a merge gate phrased as "every *available* check passed" fails open when nothing runs.

### What the process actually catches

The point of `AGENT_LOG.md` is that this is recorded honestly, including when the process caught its author. A representative sample:

- **A 1,370-line test suite that had never been executed once.** Thoroughly commented and citing the plan by section — the browser binary was never installed, so nothing in it had ever run. Caught by re-running the gate rather than accepting the branch on how well-written it was.
- **An agent that died mid-mutation-test**, leaving a deliberate defect in the working tree beneath a comment stating the opposite. Committing it would have shipped the exact bug the tests existed to prevent.
- **A CSS declaration that no test asserted**, where deleting it left every test green and the feature completely inert in a real browser.
- **A merge gate that couldn't fail** — `mvn test | tail` captures `tail`'s exit status, so it reported success regardless of the tests.
- **Documentation citing a line number from a stale checkout**, inside a pull request whose other half was about stale-branch confusion.

The recurring theme is not "agents write buggy code". It is that **tooling reports success by doing nothing** — an unfired build budget, an issue-closing keyword that linked nothing, a migration that silently never ran. The corresponding discipline is to verify the *effect*, not the exit code.

The same applies to the claims in this section. An earlier draft of it asserted that the two implementation sessions "could not read each other's code" and that the never-run test suite was "green in the report" — neither was true, and both were caught by the cold review of the pull request that added them. That is the process working, and it is also the reason this section is shorter and more hedged than it started.

### What it costs

Roughly one independent review session per PR, plus re-running every gate at the coordinator level. Every review round so far has found real defects, including in the coordinator's own work — most usefully, three separate cases of a confident *explanation* invented for a real observation, which reads as insight and is therefore more dangerous than a wrong fact.

See `docs/AGENT_WORKFLOW.md` for the mechanics and `docs/AUTONOMOUS_WORKFLOW.md` for the role model.

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
| Testing | JUnit 5 + Mockito unit tests, Testcontainers integration tests against real Postgres, Vitest component tests, and a deliberately thin Playwright E2E suite (4 journeys — see `PROJECT_TODO.md`'s testing-strategy note on why it stays small) |
| Task tracking | GitHub Projects board (Backlog → Ready → In Progress → In Review → Done) |

See `docs/DECISIONS.md` for full reasoning. All 14 foundational decisions are now confirmed except the specific VPS provider and the exact Netlify subdomain, both deliberately deferred to Phase 5.

## Repo structure

```
/backend
  /project        Project CRUD (title, description, tags, links, images)
  /contact        Contact form + rate limiting
  /auth           JWT admin login, password reset
  /analytics      Phase 7c — usage analytics (privacy-respecting)
  /githubsync     Phase 7a — GitHub webhook auto-sync
  /agentlog       Phase 7b — rendered agent build-log page
  /dspdemo        Phase 7d — live DSP/audio demo (built last)
/frontend         Angular app (standalone components, signals, generated API client, admin CRUD)
/e2e              Playwright end-to-end suite — its own package, deliberately not inside /frontend
/content-seed     Portfolio content as data, plus a script that applies it through the real API
/docs             SPEC, data model, decisions, OpenAPI contract, agent workflow
.github/workflows Separate CI/CD: Netlify deploy (frontend), container build/deploy (backend)
```

`/e2e` sits at the top level rather than under `/frontend` because it drives the backend as much as the frontend, and because Phase 5 deploys `/frontend` to Netlify — a browser-automation framework in that package would be installed on every production build for no benefit.

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

No `docker-compose.yml` yet (that's Phase 5) — point the backend at whatever Postgres you have
locally, or run one yourself:

```bash
docker run -e POSTGRES_USER=mysite -e POSTGRES_PASSWORD=mysite -e POSTGRES_DB=mysite_dev -p 5432:5432 postgres
```

```bash
# Backend (dev profile, needs Postgres reachable — see above):
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev

# Frontend (separate terminal):
cd frontend && npm install && npm start
```

`ng serve`'s dev-server proxy (`frontend/proxy.conf.json`) forwards `/api/*` to `localhost:8080`,
so the browser sees same-origin requests — the backend has no CORS config yet (Phase 5 adds it,
for the deployed Netlify origin only, not local dev). See `CLAUDE.md`'s Commands section for the
full command reference (tests, builds, regenerating the API client, etc.).

### End-to-end tests

```bash
cd e2e && npm install && npm run install:browsers   # one-time (~115 MB browser download)
cd e2e && npm test
```

Playwright starts the backend and frontend itself (and reuses them if already running), so only
Postgres needs to be up first. JDK 25 and Maven must be on `PATH` — the runner shells out to
`mvn spring-boot:run`. Full prerequisites, the four covered journeys, and why the suite provisions
its own throwaway admin account are in `e2e/README.md`.

## Documentation

- [`SPEC.md`](./SPEC.md) — scope, non-goals
- [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) — entities and relationships
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — locked-in decisions and rationale
- [`docs/openapi.yaml`](./docs/openapi.yaml) — API contract (source of truth for the generated Angular client)
- [`AGENT_LOG.md`](./AGENT_LOG.md) — what each agent session got wrong, how it was caught, and what changed as a result. Opens with an index grouping the cases by *which layer of verification failed to catch them*
- [`docs/AGENT_WORKFLOW.md`](./docs/AGENT_WORKFLOW.md) — worktree isolation, hook enforcement, task distribution
- [`docs/AUTONOMOUS_WORKFLOW.md`](./docs/AUTONOMOUS_WORKFLOW.md) — the coordinator/implementer/reviewer model and its escalation rules
- [`PROJECT_TODO.md`](./PROJECT_TODO.md) — phased build plan, per-phase status, and a Definition of Done derived from recurring review findings
- [`CHANGELOG.md`](./CHANGELOG.md) — notable changes over time

## License

All rights reserved.
