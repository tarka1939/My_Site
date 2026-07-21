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
| Frontend hosting | GitHub Pages (static Angular build) | Free, simple, integrates with the repo you're already using — but it's **static-only**, no server-side execution at all (confirmed against current GitHub docs), so this only ever hosts the Angular build output |
| Backend hosting | Render, Railway, or Fly.io free tier (Docker Compose locally) | GitHub Pages cannot run Spring Boot — a JVM process needs an actual server. This is a genuinely separate deployment target from the frontend, not a detail to defer |
| Cross-origin setup | CORS configured on Spring Boot for the `*.github.io` origin | Frontend and backend now live on different domains — without explicit CORS config every API call fails, and this is easy to forget until you've already built half the frontend against it |
| SPA routing on Pages | 404.html fallback trick | GitHub Pages has no server-side URL rewriting, so Angular client-side routes will 404 on refresh/direct link unless you add the standard SPA workaround — decide this now, not after someone shares a broken deep link |
| CI/CD | GitHub Actions from day 1 — separate workflows for Pages deploy (frontend) and container build/deploy (backend) | Cheap to add now, painful to bolt onto an already-messy history later |
| Task tracking | GitHub Projects (board linked to Issues) | One card per task/phase below; doubles as a clean way to track which tasks were agent-assigned vs. reviewed by you |
| Backend module structure | Package-by-feature (`project/`, `contact/`, `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/` — each self-contained) | Keeps future extension features isolated as new packages instead of edits scattered across one global layered structure |
| Cross-feature communication | Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) | Lets later features (analytics, GitHub sync) react to core CMS actions without being directly coupled to it — the actual mechanism that makes "open for extension" true rather than aspirational |
| Async/background jobs | `@Async` + a dedicated task executor, provisioned in Phase 1 even before anything uses it | The DSP demo (Phase 7) needs this to avoid blocking request threads on audio processing; building the pattern once now means it's reused later instead of retrofitted under time pressure |
| Feature rollout | Config-based feature flags per extension | Ship the core CMS live while extensions are still half-built; enable each independently without redeploying broken code |

**Scoping note on auth:** you don't strictly need a login system. If content management can just be "you edit a config/seed file and redeploy," you can skip auth entirely and remove real scope/risk from the project. I've kept JWT auth in the plan below because it's a commonly-asked interview topic and a good multi-agent-orchestration test case (auth logic is exactly the kind of thing agents get subtly wrong), but this is the first thing to cut if you want to move faster.

**Scoping note on extension features (Phase 7):** you asked to build four "real job" backend features — GitHub webhook sync, an agent build-log page, custom analytics, and a live DSP demo. Building all four in parallel is a real scope-creep risk (shallow implementations you can't defend in depth beats one you understand fully). The architecture decisions above (package-by-feature, event publishing, async executor, feature flags) are designed so all four *fit* the codebase cleanly whenever you get to them — but Phase 7 sequences them one at a time rather than building them simultaneously.

---

## Phase 0 — Spec & contract (before any code)

- [ ] Write `SPEC.md`: what the site does, explicit scope, explicit **non-goals** (e.g. "no multi-user support," "no real-time features")
- [ ] Draft the data model / ER diagram: `Project`, `Tag` (many-to-many with Project), `BlogPost`/`Writeup`, `ContactMessage`, optionally `AdminUser`
- [ ] Write the full OpenAPI 3.0 spec for all endpoints — this happens **before** backend or frontend code, not alongside it
- [ ] Decide the auth scope question above, explicitly, in writing
- [ ] Set up repo skeleton: `/backend`, `/frontend`, `/docs`, `.github/workflows/`
- [ ] Set up `AGENT_LOG.md` — running log you'll use in Phase 4 to record what agents got wrong
- [ ] Set up a **GitHub Project** board (columns: Backlog → Ready → In Progress → In Review → Done). Convert each checklist item below into an Issue and add it to the board, tagged by phase/component (`backend`, `frontend`, `infra`). Tag which issues you plan to hand to an agent vs. do yourself — this makes the orchestration decisions visible, not just the code output

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
- [ ] Scaffold as package-by-feature from day 1 (`project/`, `contact/` as the initial packages) rather than one global `controller/service/repository` split — this is what keeps Phase 7's extensions isolated later instead of scattered edits
- [ ] Set up a dedicated `@Async` task executor bean now, even with nothing using it yet — the DSP demo (Phase 7d) needs this, and retrofitting async handling under time pressure later is worse than provisioning it early
- [ ] Add one working `ApplicationEventPublisher` example (e.g. a `ProjectCreatedEvent` published on creation, with a no-op listener) so the pattern exists before Phase 7 needs to hook into it

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
- [ ] Configure `--base-href` in the Angular build to match your Pages URL path (`/repo-name/` for a project page, `/` only if using a `username.github.io` user/org page) — get this wrong and every asset path silently breaks on deploy
- [ ] Add the standard SPA fallback for GitHub Pages: copy `index.html` to `404.html` post-build (or use an equivalent redirect script) so deep links and refreshes on Angular routes don't 404
- [ ] Environment-based API base URL (`environment.ts` / `environment.prod.ts`) pointing at your deployed backend's URL in prod, `localhost` in dev

## Phase 4 — Integration & multi-agent workflow practice

This is the phase that actually earns the "multi-agent" label — do it deliberately, not as an afterthought:

- [ ] Run a backend-agent session and a frontend-agent session **independently**, each working only from the OpenAPI contract (not from each other's implementation) — this is the real test of whether your spec was actually complete
- [ ] Integration pass: bring both together, log every contract mismatch you find in `AGENT_LOG.md`
- [ ] Document at least 3 concrete cases where an agent's output was subtly wrong and how you caught and fixed it — this is your actual differentiation artifact for interviews, more valuable than the app itself
- [ ] End-to-end tests (Playwright) covering the main user journeys: browse projects → view detail → submit contact form

## Phase 5 — Infra & deployment (split targets: Pages for frontend, PaaS for backend)

**Frontend (GitHub Pages):**
- [ ] GitHub Actions workflow that builds the Angular app (with correct `--base-href`) and deploys to Pages on merge to `main` (via `actions/deploy-pages` or `angular-cli-ghpages`)
- [ ] Confirm the 404.html SPA fallback and base-href both survive the CI build, not just your local build
- [ ] Custom domain (optional) — if you want `yourname.dev` instead of `username.github.io`, configure this now since it affects CORS origin config below

**Backend (Render/Railway/Fly.io):**
- [ ] Multi-stage Dockerfile for the Spring Boot app
- [ ] `docker-compose.yml` for local dev (backend + Postgres) — frontend can run via `ng serve` locally against this, since it's not part of the Pages deploy
- [ ] Managed Postgres instance on your chosen platform (most free tiers include one)
- [ ] CORS configuration explicitly allowlisting your GitHub Pages origin (`https://username.github.io`) — do this before you spend a session debugging "why do all my API calls fail from the deployed frontend"
- [ ] GitHub Actions workflow: run backend tests, build Docker image, deploy to the platform on merge to `main`
- [ ] Secrets via CI/CD secret store and the platform's own secret manager — never commit `.env` files, even to a private repo
- [ ] Confirm HTTPS/TLS on both the Pages domain (automatic) and the backend host (usually automatic, but verify)
- [ ] Basic structured logging at minimum; use whatever free-tier log viewer your backend platform provides

## Phase 6 — Content & polish

- [ ] Migrate your existing projects (Equalizer, etc.) into the new content model
- [ ] SEO basics: meta tags, sitemap.xml, robots.txt — cheap now, annoying to retrofit
- [ ] Performance pass: Angular build budgets, image optimization, lazy loading
- [ ] Top-level `README.md` documenting the whole workflow — this is the externally-visible artifact that shows the process, not just the output

## Phase 7 — Extension features (sequenced — ship one before starting the next)

These are the four "give the backend a real job" candidates from earlier. Build and deploy them in this order, not in parallel — each ships and gets reviewed on its own before the next starts, and later ones reuse infrastructure the earlier ones justify building.

**7a. GitHub webhook auto-sync**
- [ ] New `githubsync` package: webhook receiver endpoint, verifying GitHub's signature header before trusting any payload
- [ ] On push/release events, call GitHub's API for repo metadata and update your project list via the `Project` service (or by reacting to it through the event publisher set up in Phase 1)
- [ ] Tests: signature verification, and idempotency — the same webhook delivery arriving twice shouldn't duplicate data

**7b. Rendered agent build-log page**
- [ ] New `agentlog` package: parse `AGENT_LOG.md` (or move its entries into the DB directly, arguably cleaner) and expose via a read-only endpoint
- [ ] A frontend page rendering it well — mostly a content/rendering task, not a hard backend problem, which is exactly why it's cheap here despite high payoff: it's your actual differentiation artifact from the multi-agent workflow, made visible to someone who'd never clone the repo

**7c. Custom analytics**
- [ ] New `analytics` package: event-ingestion endpoint (page view, project click) with basic dedup/rate limiting so one visitor can't spam events
- [ ] Aggregation queries (views per project over time) — this is where the real backend substance is, not the ingestion endpoint itself
- [ ] Simple dashboard view, behind the admin auth if you built it
- [ ] Privacy: no fingerprinting, no third-party trackers, IP addresses hashed or not stored — you're likely serving EU visitors, and this is a detail worth being able to explain, not just a nice-to-have

**7d. Live DSP/audio demo endpoint**
- [ ] Build this last — your most differentiated feature, but also the most operationally risky one
- [ ] New `dspdemo` package, using the `@Async` executor provisioned in Phase 1
- [ ] Upload endpoint with strict file size/type limits and a request queue — free-tier hosts have real CPU/memory/timeout constraints, and unbounded audio processing is the easiest way to get your app throttled or killed
- [ ] Return results via polling or WebSocket rather than a single blocking request — nontrivial audio analysis won't reliably fit inside a normal HTTP timeout window
- [ ] Tests: reuse the numerical-tolerance validation approach from your standalone DSP project if you're building both

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

- **GitHub Pages only ever hosts the Angular frontend.** There is no configuration that makes it run Spring Boot — this is a hard architectural limit, not a setting to enable. The backend must live on a separate host regardless of which one you pick.
- Free tiers on Render/Railway/Fly.io often **spin down on inactivity** and take a few seconds to wake up on the next request — fine for a portfolio, but worth mentioning if a recruiter clicks your link cold and the first load is slow. Worth a one-line note on the site itself if it happens.
- The auth scope question is the one genuine open decision here — I defaulted to "include it" for the learning/interview value, but it's legitimate to cut it.
- Testcontainers and Docker-based local dev have real setup friction; I'm recommending them because the payoff (catching Postgres-specific bugs early) is worth it, but don't be surprised if Phase 1 takes longer than the later phases as a result.
- Backend platform choice (Render/Railway/Fly.io) isn't fully decided here — pick based on your actual budget/limits before starting Phase 5, since it affects secrets/config structure in earlier phases too.
- **Phase 7's sequencing is my recommendation, not a guarantee against scope creep on its own.** The architecture work in Phase 1 (package-by-feature, event publishing, async executor) reduces the cost of building all four eventually, but it doesn't prevent you from starting all four at once anyway if the sequencing gets tempting to skip — the discipline still has to come from you.
- The live DSP demo (7d) is the one extension with real hosting-cost/reliability risk on a free tier — budget for the possibility it needs a paid tier or a queue/backpressure mechanism sooner than the others.
