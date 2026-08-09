# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit conventions
Never add "Co-Authored-By" lines to commits. Do not include Claude attribution in commit messages, PR descriptions, or any git metadata.

## PR conventions
Every PR needs three pieces of metadata set, not just opened against `main`:
- **Issues closed:** reference them in the PR body with GitHub's closing keywords, **one keyword per issue on its own line** (`Closes #20`, newline, `Closes #21`, ...) — not just prose, and not a comma-separated list after a single keyword (`Closes #20, #21`), which despite GitHub's own docs only actually links/auto-closes the *first* issue in practice (confirmed via `gh api graphql` querying `closingIssuesReferences` on PR #80 — the rendered PR body looks identical either way, so this fails silently). Verify with that same GraphQL query before trusting a multi-issue PR actually linked everything, not just by eyeballing the body text.
- **Milestone:** set to the matching phase (e.g. "Phase 2"). Milestone numbers aren't the same as phase numbers — look them up with `gh api repos/tarka1939/My_Site/milestones --jq '.[] | "\(.number): \(.title)"'` rather than guessing, then set via the issue/PR update call (PRs share the Issues API for this).
- **Project board:** add the PR to project #1 ("My Site") and set its Status field (`Todo`/`In Progress`/`In Review`/`Done`/`Canceled`) — `In Review` once the PR is open and ready for review.

## Keeping docs current
Three files need updating together whenever a phase's state changes, not just `AGENT_LOG.md` alone — a repeat mistake in this project specifically, where a fix would get logged in `AGENT_LOG.md` but the other two would go stale:
- **`PROJECT_TODO.md`:** keep each phase's status blurb current for the *whole* time that phase is being worked, not just once at the initial completion checkpoint. Any follow-up after a phase's checklist is first checked off — review-round fixes, hardening, a process/infra discovery like a misconfigured default branch — needs the status note updated too, in the same session, before moving on.
- **Root `README.md`:** its Status section, Stack table, repo structure tree, and "Local development" commands need to reflect what's actually scaffolded/built, not what's planned. Update it whenever a phase completes or a repo structure/commands change lands (a new backend package, a new frontend command, a new phase's PR merging) — it went three phases (through PR #76, #77, #79) without a single update before this was caught.

> Status: `/backend` has full Project CRUD, tag listing, contact form + rate limiting, JWT login, and password reset (Phases 1-2). `/frontend` is scaffolded with routing, a generated API client, auth, and the core CMS pages (Phase 3).

## Never quote a working tree without naming its branch

**`D:\repos\My_Site` — the main checkout, and the most obvious place to run a command — sits on `phase1/review-followups`, 58 commits behind `main` as of 2026-08-09.** Its files parse fine, grep fine, and are wrong. Several worktrees exist alongside it on their own task branches; none of them is `main` either. There is no checkout of `main` on this machine by default.

So: **a path alone is not a reference to anything.** `AGENT_LOG.md` means a different file in every one of those directories.

- **Resolve file content through an explicit ref, not through whatever a directory happens to hold:** `git show My_Site/main:AGENT_LOG.md`, or `git show <branch>:<path>` for the branch actually under discussion. Do this for any evidence that leaves this session — a PR body, a review reply, a doc, a claim to the user.
- **Before grepping or reading a working tree as evidence, run `git rev-parse --abbrev-ref HEAD`** and state which branch the finding came from. "I grepped the repo" is not a provenance.
- **Don't cite line numbers in fast-moving files.** `AGENT_LOG.md` grew by hundreds of lines in a day; a line number is stale before the PR merges. Quote enough text to be searchable instead.
- **`git fetch` before comparing against `main`.** A local `main` ref can lag the remote by a full session's work.

This is not hypothetical. PR #94 cited `AGENT_LOG.md:611` as evidence for a factual claim; the correct line on `main` was 1243, and 611 came from grepping the stale main checkout — inside a PR whose other half was about stale-branch confusion. See `AGENT_LOG.md`'s 2026-08-09 entry.

Worth fixing at the root too: if you own the machine, get the main checkout back onto `main`, or stop treating it as a place to read from.

## When a dispatched agent dies mid-task

Added 2026-08-08 after three agents were lost to API/session limits in a single session, and were each salvaged by hand when they should simply have been resumed.

**Resume the agent; do not reconstruct its work.** `SendMessage` addressed to the agent's ID continues it **with its context intact** — a fresh `Agent` call starts cold and loses everything it knew. The completion notification for a failed agent says so explicitly, and the same task ID can notify more than once for this reason. Waiting for the limit to reset and sending one message beats reverse-engineering intent from a working tree, every time.

**A dying agent's last message is not a status report.** It is whatever it happened to be saying when the process stopped. Treat it as a fragment, never as a summary of what was completed.

**If you genuinely must salvage, treat the working tree as an unknown intermediate state, not a finished one.** "Died just before committing" and "died in the middle of an experiment" look identical from outside. A real example from 2026-08-07, on PR #83: an agent finished its fixes, then began mutation-testing its own tests — deliberately reintroducing each bug to prove the tests caught it. It died with a mutation still applied. The working tree contained a live, intentional defect sitting directly beneath a comment stating the opposite. Committing that would have shipped the exact bug the tests existed to prevent. What caught it was noticing the code contradicted its own comment and then running the suite; a resume would have avoided the situation entirely, because the agent knew it had a mutation applied and that restoring it was the next step.

**Before salvaging anything, run the tests first, not last.** They are the cheapest available check on whether a working tree is in the state its author intended.

Caveat: resumption after an API-error termination is documented by the tooling but has not been verified in this project across a multi-hour gap. If a resume comes back confused or empty-handed, fall back to salvage — with the discipline above.

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
- **Security defaults:** any interim or placeholder security config (before Phase 2's real JWT auth lands) must fail closed, never open — deny by default, permit only under an explicitly-named allow case (e.g. an active `dev` profile), not the reverse. Learned the hard way in Phase 1: an inverted `@Profile("!prod")` predicate meant "permit everything" was the default for *any* profile that wasn't literally `prod`, including no profile set at all — see `AGENT_LOG.md`'s 2026-08-01 "`SecurityConfig` failed open by default, not closed" entry for the full incident and fix.

## Backend correctness checklist

Before considering a write endpoint, auth flow, or migration done, check every item below. Each one caught a real bug in Phases 1-2 that `mvn test` alone missed — see `AGENT_LOG.md`'s Phase 1 and Phase 2 entries for the specific incidents. Treat these as standing risks in this codebase, not one-off mistakes already dealt with.

- **Concurrency — check-then-act races.** Any read-then-write on state a concurrent request could also touch (an entity that might be deleted/modified mid-request, a single-use token, an upsert-by-name)? This shape has already appeared three times — the tag upsert (Phase 1, PR #76), a `Project` deleted between the two queries of a paginated list, and password-reset-token consumption (both Phase 2, PR #77) — so assume it will recur. The fix depends on what the race corrupts: where a write must not double-apply, make it atomic (`ON CONFLICT`, a conditional `UPDATE ... WHERE`, as used for the tag upsert and `markUsedIfValid`); where a concurrent change only makes a *read* inconsistent, tolerate it instead (`listProjects` filters nulls out of the re-fetch — no atomicity available or needed). Note `ContactService.submit` is a knowingly-accepted instance: its rate-limit count-then-insert can be raced, and that was judged acceptable for a deliberately "basic" abuse guard. Accepting a race is a legitimate answer; not noticing one isn't.
- **Trust boundaries.** Don't trust a client-supplied header or value unless something upstream is known to set or sanitize it. In particular, don't read `X-Forwarded-For`/`X-Real-IP` for IP-based logic — there's no reverse proxy in front of the backend until Phase 5, so any caller can set these directly and spoof their way past per-IP rate limiting.
- **Secrets & PII.** Never log a token, password, or other credential-equivalent value at a level that's enabled in production — a raw password-reset link was logged at WARN and had to be moved. DEBUG is the accepted floor for a dev-only diagnostic (it's off by default in prod), and `ResendEmailClient` deliberately does exactly that; if you go that route, comment *why* it's safe rather than leaving the next reader to guess. Never hardcode real personal data (emails, names) into migrations, seed data, or fixtures — a real address in a migration is permanent in git history and gets seeded into every environment that runs it, including throwaway CI databases. Use an RFC 2606 `.invalid` placeholder.
- **Config validation.** A config-derived value that is *present but malformed* (a too-short secret, an unparseable key or threshold) should fail fast at bean-creation/startup, not lazily on first use — the JWT secret's length check was lazy, so a too-short key looked healthy until someone tried to log in. An app that boots "successfully" on a broken config is a worse failure mode than one that refuses to start. **This is not the same as an *absent optional* value.** `ResendEmailClient` deliberately boots with no `RESEND_API_KEY` and degrades to warn-and-skip, so the password-reset flow can be exercised locally without a Resend account; that is a designed no-op path, not a lazy check. The rule is: fail fast on values that are wrong, degrade deliberately on values that are optional — and say in a comment which one you meant.
- **Shared components.** Adding a new caller to an existing shared/singleton component (a rate limiter, a cache, any mutable in-process state)? Check whether its key or namespace collides with an existing caller before assuming the new call site is isolated. An unnamespaced key reused across callers silently merges their state.
- **Migration completeness.** Every new repository method that queries by a non-primary-key column needs a supporting index in the *same* migration, not a later cleanup pass.
- **Review-fix scrutiny.** A fix written in response to review feedback gets the same scrutiny as original code, not a pass for being "just a review response" — a fix can introduce a fresh instance of any item above. This has already happened: adding login rate limiting reused the shared limiter with an unnamespaced key, which broke password-reset's independent limit.

## Where to look first

- `SPEC.md` — scope and non-goals (source of truth; update before changing code)
- `docs/DECISIONS.md` — locked-in technical decisions and why
- `docs/DATA_MODEL.md` — entities and relationships
- `PROJECT_TODO.md` — phase-by-phase build plan
- `AGENT_LOG.md` — record agent mistakes/fixes here for the whole project, not just Phase 4
- `docs/AGENT_WORKFLOW.md` — how to run agent sessions (sequential single-agent vs. dispatcher vs. isolated worktrees) and when each applies; see also `.claude/agents/backend-agent.md` and `.claude/agents/frontend-agent.md`
- `docs/AUTONOMOUS_WORKFLOW.md` — the operative workflow for Phase 4's tail through Phase 6: one persistent "Senior Dev" session, independent fresh-session PR review, ambiguity/escalation handling, and the Phase 5 pre-flight checklist
