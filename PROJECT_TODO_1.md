# Portfolio Site — Angular + Spring Boot — Project TODO

**Goals (in priority order):**
1. Working personal site that hosts your project portfolio (frontend + backend + content).
2. Deliberate practice ground for multi-agent development workflows (spec-first, parallel agents, documented review).
3. Minimize technical debt by front-loading the decisions that are expensive to change later.

**Constraints assumed:** solo developer, agentic-tool-assisted, no hard deadline, budget-conscious (free/cheap hosting tiers), no real scale requirements (this is a portfolio, not a product).

---

## 0. Decisions to lock in before writing any code

These are the choices that are cheap to make now and expensive to unwind later — exactly the "patch magnets" you asked to avoid. I've defaulted each one with reasoning; treat these as **reviewable assumptions**, not settled facts.

| Decision | Default | Why locking it now matters |
|---|---|---|
| Repo structure | Monorepo (`/backend`, `/frontend`, `/docs`) | Keeps the OpenAPI contract in one place both agents can reference; splitting later means syncing two repos |
| Database | PostgreSQL | Real production-grade DB with free tiers everywhere; avoids the classic "works on H2/SQLite in dev, breaks on Postgres in prod" patch cycle |
| ORM | Spring Data JPA + Hibernate | Standard, well-documented, matches most Java job postings you'll see |
| Schema migrations | Flyway | Explicit, versioned schema changes from commit #1 — **never use `hibernate.ddl-auto=update`** beyond local scratch experiments, it's one of the most common sources of "why doesn't prod match dev" bugs |
| API contract | OpenAPI 3.0, written before implementation | This is the shared contract your backend-agent and frontend-agent build against independently — it's the mechanism that makes "multi-agent" mean something here, not just "I used two chat windows" |
| Auth | JWT-based admin login (optional — see note below) | See scoping note below; this is the one decision worth genuinely debating, not just accepting the default |
| Angular architecture | Standalone components, signals for state | NgModules-style Angular is legacy-leaning; standalone + signals is the current recommended direction and avoids a rewrite later. NgRx would be over-engineering at this scale — skip it |
| Deployment | Docker Compose locally → Render/Railway/Fly.io (or a cheap VPS) for prod | Pick the actual platform before writing CI/CD config — env var handling and secrets differ per platform and retrofitting is annoying |
| CI/CD | GitHub Actions from day 1 | Cheap to add now, painful to bolt onto an already-messy history later |

**Scoping note on auth:** you don't strictly need a login system. If content management can just be "you edit a config/seed file and redeploy," you can skip auth entirely and remove real scope/risk from the project. I've kept JWT auth in the plan below because it's a commonly-asked interview topic and a good multi-agent-orchestration test case (auth logic is exactly the kind of thing agents get subtly wrong), but this is the first thing to cut if you want to move faster.

---

## Phase 0 — Spec & contract (before any code)

- [ ] Write `SPEC.md`: what the site does, explicit scope, explicit **non-goals** (e.g. "no multi-user support," "no real-time features")
- [ ] Draft the data model / ER diagram: `Project`, `Tag` (many-to-many with Project), `BlogPost`/`Writeup`, `ContactMessage`, optionally `AdminUser`
- [ ] Write the full OpenAPI 3.0 spec for all endpoints — this happens **before** backend or frontend code, not alongside it
- [ ] Decide the auth scope question above, explicitly, in writing
- [ ] Set up repo skeleton: `/backend`, `/frontend`, `/docs`, `.github/workflows/`
- [ ] Set up `AGENT_LOG.md` — running log you'll use in Phase 4 to record what agents got wrong

## Phase 1 — Backend foundation (Spring Boot)

- [ ] Initialize via Spring Initializr: Web, Data JPA, Validation, Security (if using auth), PostgreSQL driver, Flyway
- [ ] Layered architecture: controller → service → repository, with DTOs at the controller boundary (never return JPA entities directly from controllers — this is a classic junior mistake that causes lazy-loading and serialization bugs you'll patch repeatedly otherwise)
- [ ] Flyway migrations starting at `V1__init.sql`
- [ ] Centralized exception handling via `@ControllerAdvice` — one consistent error response shape from day 1, not per-endpoint ad hoc handling
- [ ] Request validation (`@Valid` + Bean Validation annotations) on every incoming DTO
- [ ] Environment-based config: `application-dev.yml` / `application-prod.yml`, secrets via env vars, nothing hardcoded
- [ ] `/actuator/health` endpoint enabled — trivial now, needed later for deploy health checks
- [ ] Unit tests for service layer (JUnit 5 + Mockito) written alongside each service, not after
- [ ] Integration tests with **Testcontainers** running real Postgres — H2-in-tests will pass things that fail against real Postgres, which is exactly the kind of gap that causes late patches. Fair warning: Testcontainers requires Docker running locally and has its own learning curve — budget time for it, don't treat it as free

## Phase 2 — Core domain features

- [ ] `Project` CRUD: title, description, tags, links, images, dates — build pagination/filtering in from the start (retrofitting pagination once you have real data and a frontend depending on the shape is genuinely painful)
- [ ] Tag/category system as a proper many-to-many JPA relation (good real practice, and a common interview topic)
- [ ] Contact form endpoint with basic rate limiting — cheap to add now, a real spam/abuse vector if skipped
- [ ] (If in scope) JWT admin auth: login endpoint, token issuance, `@PreAuthorize` guards on write endpoints — use Spring Security's established JWT support, don't hand-roll token signing/verification

## Phase 3 — Frontend foundation (Angular)

- [ ] Initialize with standalone components (current recommended structure)
- [ ] Routing with lazy-loaded feature routes
- [ ] Generate a typed API client from your OpenAPI spec (e.g. `openapi-generator-cli`) rather than hand-writing HTTP calls — this is what keeps frontend/backend contract drift from silently becoming a bug instead of a compile error
- [ ] HTTP interceptor for centralized error handling and auth token attachment
- [ ] State via Angular signals — skip NgRx at this scale
- [ ] Component tests for core components
- [ ] Basic accessibility pass: semantic HTML, alt text, keyboard navigation — cheap to build in, expensive to retrofit later

## Phase 4 — Integration & multi-agent workflow practice

This is the phase that actually earns the "multi-agent" label — do it deliberately, not as an afterthought:

- [ ] Run a backend-agent session and a frontend-agent session **independently**, each working only from the OpenAPI contract (not from each other's implementation) — this is the real test of whether your spec was actually complete
- [ ] Integration pass: bring both together, log every contract mismatch you find in `AGENT_LOG.md`
- [ ] Document at least 3 concrete cases where an agent's output was subtly wrong and how you caught and fixed it — this is your actual differentiation artifact for interviews, more valuable than the app itself
- [ ] End-to-end tests (Playwright) covering the main user journeys: browse projects → view detail → submit contact form

## Phase 5 — Infra & deployment

- [ ] Multi-stage Dockerfiles for backend and frontend
- [ ] `docker-compose.yml` for local dev (backend + frontend + Postgres)
- [ ] GitHub Actions CI: run backend tests, frontend tests, lint, build — on every PR, not just before merges
- [ ] CD: auto-deploy on merge to `main`
- [ ] Secrets via CI/CD secret store — never commit `.env` files, even to a private repo
- [ ] Confirm HTTPS/TLS (usually handled by the platform, but verify)
- [ ] Basic structured logging at minimum; a free-tier log viewer if your platform offers one

## Phase 6 — Content & polish

- [ ] Migrate your existing projects (Equalizer, etc.) into the new content model
- [ ] SEO basics: meta tags, sitemap.xml, robots.txt — cheap now, annoying to retrofit
- [ ] Performance pass: Angular build budgets, image optimization, lazy loading
- [ ] Top-level `README.md` documenting the whole workflow — this is the externally-visible artifact that shows the process, not just the output

## Ongoing / meta

- [ ] Treat `SPEC.md` and the OpenAPI contract as source of truth — update them **before** changing code, not after the fact
- [ ] Keep `AGENT_LOG.md` running for the whole project, not just Phase 4
- [ ] Periodically do a short tech-debt pass rather than letting rough edges silently accumulate

---

## Testing strategy summary

Following the standard pyramid — many fast unit tests, fewer integration tests, fewest E2E tests:

- **Backend:** unit tests (service logic, mocked dependencies) → integration tests (Testcontainers, real Postgres) → contract tests (validate actual responses against the OpenAPI spec in CI, e.g. via a schema-validation step)
- **Frontend:** component tests → a handful of key interaction tests
- **Cross-cutting:** Playwright E2E, kept deliberately thin — 3–5 critical journeys, not exhaustive coverage. E2E tests are slow and brittle to maintain; don't let them sprawl

---

## What to deliberately skip (avoid over-engineering)

- **NgRx** — signals are sufficient at this scale; NgRx would be maintenance overhead with no real benefit here
- **Microservices** — a single Spring Boot monolith is correct for this project; splitting now creates integration overhead for zero benefit
- **Kubernetes** — Docker Compose or a PaaS free tier is enough; K8s here would be resume-padding, not a real need
- **Hand-rolled auth/crypto** — use Spring Security's established JWT handling if you do auth at all

---

## Caveats on this plan

- The auth scope question is the one genuine open decision here — I defaulted to "include it" for the learning/interview value, but it's legitimate to cut it.
- Testcontainers and Docker-based local dev have real setup friction; I'm recommending them because the payoff (catching Postgres-specific bugs early) is worth it, but don't be surprised if Phase 1 takes longer than the later phases as a result.
- Deploy platform (Render/Railway/Fly.io/VPS) isn't decided here — pick based on your actual budget before starting Phase 5, since it affects how you structure secrets and config in earlier phases too.
