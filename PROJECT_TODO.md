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
| Build tool | **Maven** (confirmed 2026-07-29, see `docs/DECISIONS.md`) | Single-module backend gets no benefit from Gradle's build-speed/multi-module advantages; Maven's fixed lifecycle and heavier Spring Boot documentation are the safer bet for an agent-authored build file |
| Cross-feature communication | Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) | Lets later features (analytics, GitHub sync) react to core CMS actions without being directly coupled to it — the actual mechanism that makes "open for extension" true rather than aspirational |
| Async/background jobs | `@Async` + a dedicated task executor, provisioned in Phase 1 even before anything uses it | The DSP demo (Phase 7) needs this to avoid blocking request threads on audio processing; building the pattern once now means it's reused later instead of retrofitted under time pressure |
| Feature rollout | Config-based feature flags per extension | Ship the core CMS live while extensions are still half-built; enable each independently without redeploying broken code |

**Scoping note on auth:** you don't strictly need a login system. If content management can just be "you edit a config/seed file and redeploy," you can skip auth entirely and remove real scope/risk from the project. I've kept JWT auth in the plan below because it's a commonly-asked interview topic and a good multi-agent-orchestration test case (auth logic is exactly the kind of thing agents get subtly wrong), but this is the first thing to cut if you want to move faster.

**Scoping note on extension features (Phase 7):** you asked to build four "real job" backend features — GitHub webhook sync, an agent build-log page, custom analytics, and a live DSP demo. Building all four in parallel is a real scope-creep risk (shallow implementations you can't defend in depth beats one you understand fully). The architecture decisions above (package-by-feature, event publishing, async executor, feature flags) are designed so all four *fit* the codebase cleanly whenever you get to them — but Phase 7 sequences them one at a time rather than building them simultaneously.

---

## GitHub Project organization (added 2026-07-25)

On top of the flat 69-issue backlog and the `[Phase N]` title-prefix convention, two more layers of structure were added — see `docs/DECISIONS.md` for the full reasoning:

- **Milestones — one per phase (Phase 0 through 7, plus Ongoing/meta).** Groups every issue by phase for a native GitHub percent-complete view, without inventing new structure — it just populates a "Milestone" field the project board already had sitting unused. No due dates, since there's no hard deadline on this project.
- **Parent/sub-issues — only where a phase already has a real two-level structure**, not applied uniformly (deliberately, to avoid over-structuring a solo-maintained backlog — same discipline as skipping NgRx/Kubernetes elsewhere in this doc). Six parent "epic" issues were created:
  - #70 — `[Phase 7a] Epic: GitHub webhook auto-sync` (sub-issues #53, #54, #55)
  - #71 — `[Phase 7b] Epic: Rendered agent build-log page` (sub-issues #56, #57)
  - #72 — `[Phase 7c] Epic: Custom analytics` (sub-issues #58, #59, #60, #61)
  - #73 — `[Phase 7d] Epic: Live DSP/audio demo` (sub-issues #62, #63, #64, #65)
  - #74 — `[Phase 5] Epic: Frontend deploy (Netlify)` (sub-issues #38, #39, #40)
  - #75 — `[Phase 5] Epic: Backend deploy (self-managed VPS)` (sub-issues #41–#48)

  Phases 0–4 and 6 stay flat — a milestone already groups those, and parent issues on top would just duplicate that view for phases with no real sub-structure.

**Status (updated 2026-08-07):** parent/sub-issues are live (all 6 epics created, all 24 sub-issues linked, all added to project #1). **Milestones now exist** — all 9 were created manually on GitHub's site (Phase 0 through 7, plus Meta), unblocking the assignment pass that was previously deferred. Note that milestone *numbers* do not line up with phase numbers (Phase 4 is milestone `5`, Meta is `9`), so look them up via `gh api repos/tarka1939/My_Site/milestones` rather than inferring them — see `CLAUDE.md`'s PR conventions.

**Default branch fix (2026-08-02):** the repo's default branch was a stale `master` (57 commits behind `main`, just the original skeleton) from repo creation until now, even though every real PR (#76, #77, #79, #80) targeted `main`. GitHub only auto-links a PR's issues in its "Development" sidebar, and only auto-closes them on merge, when the PR's base is the *default* branch — so those PRs' `Closes #N` references had silently done nothing, invisible unless you specifically checked `closingIssuesReferences` via the API. #76, #77 and #79 were already merged and are permanently unlinked; #80 was still open, was repaired, and closed all ten of its issues on merge. Fixed: default branch switched to `main`, `master` deleted. Separately, GitHub's documentation requires a keyword before *each* issue number, so always use one `Closes #N` per line — and that **was** confirmed here, on #80, once the default-branch fix had removed the confounding variable: with the default corrected, #80's comma-separated `Closes #24, #25, #26, ...` linked only #24, and rewriting it one-per-line made all ten appear. (**Correction 2026-08-29:** a note added here on 2026-08-27 claimed the opposite — that the comma cause had never been confirmed locally — on the evidence that PRs #76 and #77 link zero issues rather than one. That reasoning was wrong. Both were merged *before* the default was fixed, so the default-branch gate short-circuits them and neither can bear on the comma question either way; the isolated experiment is #80, and `AGENT_LOG.md`'s 2026-08-02 entry recorded it correctly all along. See `docs/AGENT_WORKFLOW.md`'s closing-keyword section.) see `CLAUDE.md`'s PR conventions and `AGENT_LOG.md` for the full writeup. **Superseded 2026-08-27:** the default branch is now `dev`, and for the same mechanism — `dev` became the integration branch, and a default of `main` would have voided every feature PR's keywords exactly as `master` did. `main` is production-only. ADR in `docs/DECISIONS.md`.

---

## Autonomous execution workflow (added 2026-08-02)

From Phase 4's tail through Phase 6, the project runs on the model in `docs/AUTONOMOUS_WORKFLOW.md` rather than a hand-written kickoff prompt per phase — see that doc and the corresponding ADR in `docs/DECISIONS.md` for the full reasoning. Summary:

- One persistent "Senior Dev" session the user (product owner) talks to directly — **coordinator and dispatcher, not implementer.** It breaks phase work from this file into discrete tasks and dispatches each to a fresh "junior" session that writes the actual code, checks the result against spec before accepting it, opens the PR, keeps `AGENT_LOG.md`/`CHANGELOG.md`/this file/READMEs current itself, and reports status in standup form rather than raw diffs. (Corrected 2026-08-07: this line still described the Phases 1-3 model, where the same session planned and implemented; `docs/AUTONOMOUS_WORKFLOW.md` and the ADR were updated on 2026-08-02 and this summary was missed.)
- Every PR gets reviewed by a fresh, independent Claude Code session with no shared context with the implementation, dispatched by the Senior Dev into its own detached worktree. GitHub Copilot's automated review normally runs alongside it — each has independently caught real defects — but Copilot is **suspended from the merge gate until 2026-08-25** while its quota is exhausted (updated 2026-08-08; see `docs/AUTONOMOUS_WORKFLOW.md`). The independent review is mandatory and has no fallback.
- Genuine spec ambiguity gets asked and only blocks the dependent task(s), not the whole phase.
- "Large problems" (new accounts/credentials/payment, destructive migrations, repeated failed fix attempts, anything touching prod secrets/DNS/billing) always stop and wait for the user.
- Phase 5 specifically needs human-only setup first (Netlify + VPS account creation, secrets) — see `docs/AUTONOMOUS_WORKFLOW.md`'s pre-flight checklist — plus a manual checkpoint on the first real end-to-end deploy, even once that setup is done.

**Status:** in effect starting Phase 4's tail (2026-08-02).

---

## Phase 0 — Spec & contract (before any code)

- [x] Write `SPEC.md`: what the site does, explicit scope, explicit **non-goals** (e.g. "no multi-user support," "no real-time features") — done, issue #1
- [x] Draft the data model / ER diagram: `Project`, `Tag` (many-to-many with Project), `BlogPost`/`Writeup`, `ContactMessage`, optionally `AdminUser` — done, issue #2
- [x] Write the full OpenAPI 3.0 spec for all endpoints — this happens **before** backend or frontend code, not alongside it — done, issue #3
- [x] Decide the auth scope question above, explicitly, in writing — done, issue #4
- [x] Set up repo skeleton: `/backend`, `/frontend`, `/docs`, `.github/workflows/` — done, issue #5
- [x] Set up `AGENT_LOG.md` — running log you'll use in Phase 4 to record what agents got wrong — done, issue #6
- [x] Set up a **GitHub Project** board (columns: Backlog → Ready → In Progress → In Review → Done). Convert each checklist item below into an Issue and add it to the board, tagged by phase/component (`backend`, `frontend`, `infra`). Tag which issues you plan to hand to an agent vs. do yourself — this makes the orchestration decisions visible, not just the code output — done, issue #7. Board is project #1, all 69 issues attached. Status field (manually edited on GitHub's site 2026-07-25, since it can't be edited via the API) is now Todo / In Progress / In Review / Done / Canceled — not a literal Backlog/Ready split, but functionally equivalent (Todo covers both pre-work states) with Canceled added on top

## Phase 1 — Backend foundation (Spring Boot)

> **Status (2026-08-01):** all items below complete — see PR #76 (branch `phase1/backend-foundation`). Spring Boot 4.1.0 / JDK 25 / Maven, Spring Modulith 2.1.0. `mvn test` green (7 tests: unit + Modulith verification + Testcontainers integration). Boot-verified manually against real Postgres in both `dev` and `prod` profiles.

- [x] Initialize via Spring Initializr: **Maven** project, Web, Data JPA, Validation, Security (if using auth), PostgreSQL driver, Flyway — done, issue #8
- [x] Layered architecture: controller → service → repository, with DTOs at the controller boundary (never return JPA entities directly from controllers — this is a classic junior mistake that causes lazy-loading and serialization bugs you'll patch repeatedly otherwise) — done, issue #9. Note: only the **create** path (`POST /api/v1/projects`) is wired up in Phase 1, deliberately — full CRUD is Phase 2
- [x] Flyway migrations starting at `V1__init.sql` — done, issue #10. All six core tables from `docs/DATA_MODEL.md`; `admin_user` created empty (seeding needs a bcrypt hash, deferred to Phase 2 alongside the login endpoint)
- [x] Centralized exception handling via `@ControllerAdvice` — one consistent error response shape from day 1, not per-endpoint ad hoc handling — done, issue #11. RFC 7807 `ProblemDetail`, matching `docs/openapi.yaml`
- [x] Request validation (`@Valid` + Bean Validation annotations) on every incoming DTO — done, issue #12
- [x] Environment-based config: `application-dev.yml` / `application-prod.yml`, secrets via env vars, nothing hardcoded — done, issue #13
- [x] `/actuator/health` endpoint enabled — trivial now, needed later for deploy health checks — done, issue #14
- [x] Unit tests for service layer (JUnit 5 + Mockito) written alongside each service, not after — done, issue #15
- [x] Integration tests with **Testcontainers** running real Postgres — H2-in-tests will pass things that fail against real Postgres, which is exactly the kind of gap that causes late patches. Fair warning: Testcontainers requires Docker running locally and has its own learning curve — budget time for it, don't treat it as free — done, issue #16. The warning was accurate: this was the only item blocked on environment setup, and it immediately earned its keep by catching a real bug (null `createdAt`/`updatedAt`) that the mocked unit tests structurally could not — see `AGENT_LOG.md`
- [x] Scaffold as package-by-feature from day 1 (`project/`, `contact/` as the initial packages) rather than one global `controller/service/repository` split — this is what keeps Phase 7's extensions isolated later instead of scattered edits — done, issue #17. Enforced by Spring Modulith (`ModularityTests` → `ApplicationModules.verify()`), not just convention
- [x] Set up a dedicated `@Async` task executor bean now, even with nothing using it yet — the DSP demo (Phase 7d) needs this, and retrofitting async handling under time pressure later is worse than provisioning it early — done, issue #18
- [x] Add one working `ApplicationEventPublisher` example (e.g. a `ProjectCreatedEvent` published on creation, with a no-op listener) so the pattern exists before Phase 7 needs to hook into it — done, issue #19

## Phase 2 — Core domain features

> **Status (2026-08-01):** all items below complete — see PR #77 (branch `phase2/core-domain-features`). `mvn test` green (44 tests: unit + Modulith verification + Testcontainers integration against real Postgres). Manually boot-verified against real Postgres (dev profile): full project CRUD lifecycle, tag filtering, contact form + rate limiting, admin login, and password-reset-request, all via `curl`. A real bug (tag-filtered pagination + Postgres's `SELECT DISTINCT`/`ORDER BY` rule) was caught only by that manual verification, not by `mvn test` — see `AGENT_LOG.md`.

- [x] `Project` CRUD: title, description, tags, links, images, dates — build pagination/filtering in from the start (retrofitting pagination once you have real data and a frontend depending on the shape is genuinely painful) — done, issue #20
- [x] Tag/category system as a proper many-to-many JPA relation (good real practice, and a common interview topic) — done, issue #21 (relation itself was Phase 1; Phase 2 added the read-only `GET /tags` endpoint)
- [x] Contact form endpoint with basic rate limiting — cheap to add now, a real spam/abuse vector if skipped — done, issue #22
- [x] (If in scope) JWT admin auth: login endpoint, token issuance, `@PreAuthorize` guards on write endpoints — use Spring Security's established JWT support, don't hand-roll token signing/verification — done, issue #23. Spring Security's OAuth2 Resource Server support (Nimbus JWT encoder/decoder, HS256), not a third-party JWT library
- [x] Password reset flow for the `AdminUser` account: reset-request + reset-confirm endpoints, short-lived single-use reset token, delivered via a transactional email API (Resend recommended — free tier well beyond single-admin volume, simple REST call, no mail server to operate/secure yourself) — added 2026-07-24 during Phase 0 review, not in the original TODO; see `docs/DECISIONS.md` — done, issue #69. `RESEND_API_KEY` now provisioned and delivery verified end-to-end (2026-08-01, local dev only — real email received via `onboarding@resend.dev`); reset link pointed at `localhost:4200` as expected, since Phase 3's frontend doesn't exist yet. `RESEND_API_KEY` and `FRONTEND_URL` still need setting in the real deploy target once Phase 5's VPS/secret store exist

## Phase 3 — Frontend foundation (Angular)

> **Status (2026-08-02):** all items below complete — see PR #80 (branch `phase3/frontend-foundation`). Angular 21.2.19 (Node 24.14.0 — the newest Angular CLI, 22.x, needs Node `^24.15.0`, one patch ahead of what was installed; see `docs/DECISIONS.md`/`AGENT_LOG.md`). `ng test` green (25 Vitest tests: components, `AuthService`, `authGuard`, `errorInterceptor`). Manually smoke-tested against a real backend (throwaway Docker Postgres + `mvn spring-boot:run -Dspring-boot.run.profiles=dev`) via the Claude Browser tool: browse → filter by tag → project detail → contact form submit → admin login → create/edit project → view contact messages → logout → guard redirect. A real gap (no backend CORS config, breaking local dev) was caught only by that live browser test, not by `ng test`/`ng build` — see `AGENT_LOG.md`. Post-open-PR follow-ups: a manual review round found two minor gaps (unvalidated image URLs in the project form; an unvalidated `returnUrl` reaching `navigateByUrl`), both fixed with test coverage added (2026-08-02); separately, the repo's default branch was discovered to be a stale `master` rather than `main`, which had silently prevented every PR's `Closes #N` from auto-linking issues since Phase 1 — fixed (default branch switched to `main`, `master` deleted) and logged, see `AGENT_LOG.md` and the "GitHub Project organization" section below.

- [x] Initialize with standalone components (current recommended structure) — done, issue #24
- [x] Routing with lazy-loaded feature routes — done, issue #25. Per-feature `loadChildren` (`projects`, `contact`, `admin`) plus per-page `loadComponent` within each
- [x] Generate a typed API client from your OpenAPI spec (e.g. `openapi-generator-cli`) rather than hand-writing HTTP calls — this is what keeps frontend/backend contract drift from silently becoming a bug instead of a compile error — done, issue #26. Committed to `frontend/src/app/core/api` (not gitignored-and-regenerated-in-CI, so Netlify's Phase 5 build never needs a JVM); regenerate via `npm run generate:api`
- [x] HTTP interceptor for centralized error handling and auth token attachment — done, issue #27. Split into `authInterceptor` (attaches the admin JWT) and `errorInterceptor` (normalizes every failed response into an `ApiProblem`, handles 401/429 specifically, surfaces non-field errors via a global notification banner)
- [x] State via Angular signals — skip NgRx at this scale — done, issue #28
- [x] Component tests for core components — done, issue #29. Vitest, 25 tests across `App`, `ProjectsListComponent`, `ContactFormComponent`, `AdminLoginComponent` (including the `returnUrl` safe/rejected cases added in the 2026-08-02 review follow-up), `AuthService`, `authGuard`, `errorInterceptor`
- [x] Basic accessibility pass: semantic HTML, alt text, keyboard navigation — cheap to build in, expensive to retrofit later — done, issue #30. Skip link, focus moved to `<main>` on route change, `aria-live` notifications, per-item (not shared) `aria-label`s on repeated remove/dismiss buttons
- [x] Configure `--base-href` in the Angular build — adapted 2026-07-25: frontend hosting is now Netlify, not GitHub Pages (see `docs/DECISIONS.md`), so this uses the Angular default (`/`), not a repo-name subpath — done, issue #31. Verified in the production build's `index.html`
- [x] Add a `frontend/public/_redirects` file (`/* /index.html 200`) so deep links and refreshes on Angular routes don't 404 — adapted 2026-07-25: Netlify handles SPA routing natively via this one-line file; the originally-planned GitHub Pages `404.html` copy trick is no longer needed — done, issue #32. Verified it survives into `dist/frontend/browser/_redirects`
- [x] Environment-based API base URL (`environment.ts` / `environment.prod.ts`) pointing at your deployed backend's URL in prod, `localhost` in dev — done, issue #33. Angular 21's `ng generate environments` schematic now names the dev override `environment.development.ts`, not `environment.prod.ts` (the naming inverted from the convention this line assumed — `environment.ts` is the prod default now). Dev's `apiBaseUrl` is a relative `/api/v1`, proxied to `localhost:8080` by `frontend/proxy.conf.json` — see `AGENT_LOG.md`'s CORS finding

## Phase 4 — Integration & multi-agent workflow practice

> **Status (2026-08-02):** adapted — see `docs/AUTONOMOUS_WORKFLOW.md` and the corresponding ADR in `docs/DECISIONS.md`. The original premise (build backend and frontend blind to each other, then integrate for the first time here) didn't hold: Phase 3 was built and smoke-tested against the real, running backend from the start, so there was no "first integration" left to test in this phase. The backend/frontend isolation exercise moves to Phase 7, where each new extension is a genuine not-yet-built, contract-first venue for it.
>
> **Status (2026-08-07):** both remaining items complete — the agent-mistake index (#36, PR #81) and the Playwright E2E suite (#37, PR #82). First phase run under the Senior Dev dispatcher model: the E2E implementation was delegated to a junior session in an isolated worktree, reviewed against spec, and gated on a personally re-run test suite before review was requested. That gate is what caught the junior's suite having never been executed at all — see `AGENT_LOG.md`'s 2026-08-07 entry, which also logs two Senior Dev errors from the same session.

- [ ] ~~Run a backend-agent session and a frontend-agent session independently~~ — moved to Phase 7 (see status note above)
- [ ] ~~Integration pass: bring both together, log every contract mismatch~~ — superseded; integration already happened live during Phase 3
- [x] Document at least 3 concrete cases where an agent's output was subtly wrong and how you caught and fixed it — this is your actual differentiation artifact for interviews, more valuable than the app itself. Already substantively satisfied by `AGENT_LOG.md`'s existing entries (the null-timestamp `saveAndFlush` bug, the Copilot-review findings, the tag-filtered-pagination Postgres bug, the Phase 3 CORS gap) — this item is to formally index/confirm those as the deliverable, not to manufacture new ones — done, issue #36. `AGENT_LOG.md` now opens with an index grouping ~15 documented cases by **which layer of verification failed to catch each one** (mocked-test blind spots, browser-only bugs, adversarial/concurrent input, fail-open security config, and tooling that reports success while doing nothing) rather than chronologically — the failure class is the part that transfers, the date isn't
- [x] End-to-end tests (Playwright) covering the main user journeys: browse projects → view detail → submit contact form — still genuinely unbuilt, do this for real. Fully unblocked regardless of Phase 5's status: Playwright drives the app against local dev servers (`ng serve` + `mvn spring-boot:run`), not a live deployment — done, issue #37. Four journeys in a top-level `/e2e` package (not inside `frontend/`, so Netlify's Phase 5 build stays clean — see `docs/DECISIONS.md`), holding to the 3-5 ceiling this file's testing-strategy section sets. Verified 7/7 twice back-to-back with no DB wipe between; the first run failed 4/7 purely because the Playwright browser binary had never been installed, which is also how it was discovered the suite had never actually been executed by the agent that wrote it — see `AGENT_LOG.md`

## Phase 5 — Infra & deployment (split targets: Netlify for frontend, self-managed VPS for backend)

> **Runbook: `docs/DEPLOYMENT.md`** (added 2026-08-30). Step-by-step commands for the parts that cannot be delegated — provider and domain choices, VPS hardening, Postgres, TLS, and the wiring order that resolves the frontend-needs-backend-host / backend-needs-frontend-origin cycle. It also records the two things that will otherwise surprise you: Netlify defaults its production branch to the repo default, which is now `dev` rather than `main`; and #121 means a freshly migrated production database has an admin account nobody can log in as.

> **Status (2026-09-03):** **unpaused and in progress.** Host chosen: Mikrus, a NAT'd LXC container on Ubuntu 24.04. **The backend is live** — `https://tarka1939.tojest.dev/actuator/health` answers `{"groups":["liveness","readiness"],"status":"UP"}` from the public internet and `/api/v1/projects` returns a valid page, so Cloudflare, the provider's nginx, the container's IPv6, Spring Boot, Flyway and Postgres are all confirmed working together. Remaining — the admin password (#121, nobody can log in yet), a redeploy carrying CORS (#44) and forwarded-header handling (#168) which merged after the running jar was built, and all of the Netlify half. Step-by-step in `docs/DEPLOYMENT.md`; the exposure decision and its rejected alternatives are an ADR in `docs/DECISIONS.md`, 2026-09-03.
>
> **Superseded (2026-08-05):** paused — backend VPS/Coolify setup was still being evaluated (Hetzner Cloud vs. Mikrus vs. reusing a home laptop). Per `docs/AUTONOMOUS_WORKFLOW.md`'s task-dependency model, a blocked phase only blocks the tasks that actually depend on it — Phase 6 and Phase 7 are not gated on this and may proceed in the meantime; see the notes added to each below for exactly what can and can't move forward without a live deploy target.

**Frontend (Netlify — adapted 2026-07-25, originally GitHub Pages; see `docs/DECISIONS.md`):**
- [ ] GitHub Actions workflow that builds the Angular app (with default `--base-href /`) and deploys to Netlify on merge to `main` (e.g. via `nwtgck/actions-netlify`) — **`main`, not the default branch.** Since 2026-08-27 the default is `dev`, so a workflow keyed on the default branch, or on `push` without a branch filter, would publish every feature the moment it merged
- [ ] Confirm the `_redirects` SPA fallback survives the CI build, not just your local build
- [ ] Custom domain (optional, not currently planned — see `docs/DECISIONS.md`) — if added later, configure before finalizing the CORS origin below

**Backend (self-managed VPS — see `docs/DECISIONS.md`):**
- [ ] Multi-stage Dockerfile for the Spring Boot app
- [ ] `docker-compose.yml` for local dev (backend + Postgres) — frontend can run via `ng serve` locally against this, since it's not part of the Netlify deploy
- [x] Set up Postgres on the VPS — done (#43). Postgres 16.15, listening on `127.0.0.1` only, database and role `mysite` owned per-database so Flyway can create its schema; verified by the application's own migrations running against it (self-hosted, not a managed add-on — see `docs/DECISIONS.md`)
- [x] CORS configuration explicitly allowlisting the Netlify origin — done (#44, PR #172). `app.cors.allowed-origins` takes **exact** origins, defaulting to `https://krzysztof-tarka.netlify.app`; deliberately not `allowedOriginPatterns`, since a pattern like `https://*--<site>.netlify.app` would admit a deploy preview built from a fork's pull request — arbitrary third-party JavaScript on an origin this API answers. A test asserts a deploy-preview origin is refused
- [ ] GitHub Actions workflow: run backend tests, build Docker image, deploy to the platform on merge to `main` — same caveat as the frontend workflow above: pin the branch to `main` explicitly, because it is no longer the default
- [ ] Secrets via CI/CD secret store and the platform's own secret manager — never commit `.env` files, even to a private repo
- [ ] Confirm HTTPS/TLS on both the Netlify domain (automatic) and the backend host (usually automatic, but verify)
- [ ] Basic structured logging at minimum; use whatever free-tier log viewer your backend platform provides

**Pre-flight (see `docs/AUTONOMOUS_WORKFLOW.md`):** Netlify + VPS accounts, secrets, and a budget ceiling need to be provided by the user before this phase can run with the same autonomy as Phases 1-4 — account creation and payment are always human-only steps, regardless of session. The first real end-to-end deploy is a manual checkpoint even after that setup is done.

## Phase 6 — Content & polish

> **Note (2026-08-05):** not blocked by Phase 5's pause — content migration, the performance pass, and the README can all be done against local dev. One exception: sitemap.xml/robots.txt need the real canonical domain to be correct, so draft them with a placeholder and leave that checkbox flagged incomplete until Phase 5 actually lands, rather than treating it as done against a guess.

- [ ] Migrate your existing projects (Equalizer, etc.) into the new content model — **deliberately still open.** The migration *artifact* exists and is verified: `/content-seed` holds five entries drafted from the real repos plus a dependency-free script that applies them through the real HTTP API, proven end-to-end against Spring Boot and Postgres (five created, idempotent on re-run, dates round-tripping, cleanup verified). Two things keep this unchecked, and neither is a coding task: **the owner has not signed off the prose**, and there is nowhere permanent to apply it while Phase 5 is paused. Applying the seed to a live site is what closes this. See `docs/CONTENT_DRAFT.md` for the copy and `content-seed/README.md` for how to run it
- [ ] SEO basics: meta tags, sitemap.xml, robots.txt — cheap now, annoying to retrofit — **meta tags done (issue #50); sitemap/robots deliberately still open.** Static description, Open Graph and Twitter card tags now ship in `index.html`, and routes set their own description at runtime via Angular's `Meta` service. The split matters: **Googlebot executes JavaScript, the social scrapers do not**, so the static tags are what LinkedIn, Slack and Discord actually read and the runtime ones give Googlebot per-route accuracy. `robots.txt` and `sitemap.xml` exist but carry `REPLACE-WITH-CANONICAL-ORIGIN.invalid` — this box stays unticked until the Netlify site is created in Phase 5 and the real origin replaces it in both files. Prerendering was evaluated and **deferred**, not rejected: it would make the Netlify build depend on the VPS backend, which the committed API client exists to avoid. See the 2026-08-10 SEO ADR in `docs/DECISIONS.md` for the revisit conditions
- [x] Performance pass: Angular build budgets, image optimization, lazy loading — done, issue #51 (PR #83). Total bytes barely moved; the wins were elsewhere. Build budgets were replaced because the stock ones **could not fire** (500 kB warn against 284 kB of actual output); a request waterfall was found on the landing route (`app.routes.ts` → `projects.routes.ts` → the list component, three sequential requests before first render); and layout shift was removed by reserving the gallery box. `NgOptimizedImage` was evaluated against `@angular/common` source and **rejected** — every feature it offers is inert given admin-pasted external image URLs with no CDN loader and no known intrinsic dimensions. Two review findings caught real defects: the LCP hint silently no-op'd when the newest project had no images, and `path: ''` without `pathMatch` prefix-matched every URL, so the router fetched the projects chunk and backtracked on every cold entry. See `AGENT_LOG.md`
- [x] Top-level `README.md` documenting the whole workflow — this is the externally-visible artifact that shows the process, not just the output — done, issue #52. Adds a "How this is built" section covering contract-first development, worktree isolation and its limits, the coordinator/implementer/reviewer split, and five real cases of what the process caught. The cold review of that PR found three overstatements in it — including a claim that two implementation sessions "could not read each other's code" when they ran sequentially in the same worktree, separated only by prompt instruction — so the section now states plainly what the process does and does not demonstrate, and records its own correction. See `AGENT_LOG.md`
- [x] **Not in the original plan** — project date period (`startedOn` + nullable `completedOn`), issue #85. `SPEC.md` line 11 has promised "dates" on project detail since Phase 0, but the data model only ever had `created_at`/`updated_at` — record timestamps, not dates describing the work. The divergence survived the data-model design, the OpenAPI contract and four PR review rounds, and surfaced only when content drafting (#49) had nowhere to put a date. Built contract-first: `docs/openapi.yaml`, `docs/DATA_MODEL.md` and the ADR landed before any code, then backend, then frontend against the same settled contract. Null `completedOn` means *ongoing* — a value, not missing data. See `AGENT_LOG.md`

- [x] **Not in the original plan** — admin form load failure, issue #92 (PR #105). A failed `getProject` left an editable blank form whose save PUTs, destroying the record; fixed with independent template and `submit()` guards, so the path is unreachable rather than merely hidden. The larger finding is underneath it: the form rendered server validation errors only into slots keyed by field name, and `errorInterceptor` deliberately stays silent when a 400 carries field errors, so any unslotted key meant **Save did nothing and said nothing** — the same failure shape as #92, one layer down. That recurred four times: two long-standing gaps inherited from the Phase 3 form, then two genuine regressions introduced by the preceding round's fix once the code began reaching into keys it had never parsed. Closed structurally rather than by enumeration, and verified at review time by an adversarial key sweep. 115 tests to 156, across four cold reviews that each found real defects. See `AGENT_LOG.md`

**Also surfaced during Phase 6, tracked separately** (none in the original checklist; all found while drafting real content, measuring real build output, or reviewing the fixes above): #86 no description clamp on the list page, #87 image alt text hardcoded as "screenshot N", #88 no ordering field on `Project`, #89 API-origin `preconnect` (blocked on Phase 5), #90 frontend dependency audit, #97 per-image alt text in the data model, #99 E2E fixtures can't regress-test excerpts or alt text. Of the three that were prerequisites for #49, **#86 and #87 are closed** and only #88 remains open; #97 now carries the alt-text work that #87 started. #89 and #90 are also still open.

**Found during PR #105's four review rounds — #107 through #111 are now all closed** (see the 2026-08-18 entry in `AGENT_LOG.md`), and #106 closed with the contact form fix. Recorded here for the trail rather than as outstanding work: #106 the public contact form has the identical silent-validator defect — worse than the admin case, since the person hitting it is a visitor with no idea what the constraints are; #107 `AdminProjectFormComponent` reads `route.snapshot` once (latent, no UI path reaches it today); #108 the interceptor's 401 branch never fires for a wall-clock-expired token, so ordinary session expiry produces neither logout nor redirect; #109 the contract never documented the indexed validation key format two clients now depend on; #110 the specs use `detectChanges()`, which under zoneless cannot catch a missing dirty-mark; #111 three stale-state gaps the in-flight freeze deliberately did not cover.

## Phase 7 — Extension features (sequenced — ship one before starting the next)

These are the four "give the backend a real job" candidates from earlier. Build and deploy them in this order, not in parallel — each ships and gets reviewed on its own before the next starts, and later ones reuse infrastructure the earlier ones justify building.

**Note (2026-08-02):** this is also where the genuine backend-agent/frontend-agent isolation exercise from Phase 4's original plan now lives — see `docs/AUTONOMOUS_WORKFLOW.md`. Each extension below is new and not-yet-built, a real contract-first venue for it. Correction from Phase 3's mistake: the frontend side should develop against a mock server generated from the new contract addition, not the live backend, until an explicit integration step.

**Note (2026-08-05):** Phase 5's pause doesn't block starting 7a–7d — all four are backend/frontend feature development that runs fully against local dev. The one piece that can't be finished yet is 7a's final step of pointing GitHub's real webhook at a live public endpoint; build and test the receiver locally with a webhook relay tool (e.g. smee.io, or a temporary tunnel) and defer only that last wiring step until Phase 5 is done.

**7a. GitHub webhook auto-sync** — **complete** (issues #53, #54, #55, #144, epic #70). Backend 100 → 202 tests, frontend 236 → 255.
- [x] New `githubsync` package: webhook receiver endpoint, verifying GitHub's signature header before trusting any payload — signature checked against the **raw bytes** (a deserialised body is not what GitHub signed), constant-time comparison, fails closed on an unconfigured secret, feature-flagged off by default
- [x] On push/release events, sync repo metadata via the `Project` service — **scoped by an ADR written before the code** (`docs/DECISIONS.md`, 2026-08-18): sync never writes a curated field, only what GitHub is authoritative for, and an unmatched repo becomes an *unpublished draft*. A naive reading of this item would have overwritten the prose signed off in #49
- [x] Tests: signature verification, and idempotency — guarded by a unique constraint rather than a pre-check
- [x] **Not in the original plan** — the admin can see and publish drafts (#144), and `PUT` reaching a draft is now pinned (#146). Without the first, an auto-created draft could never go live; without the second, the behaviour the control depends on was untested

> **Known follow-up:** #148 — an auto-created draft has no tags and the edit form requires one, so open-edit-publish cannot be completed. Publishing from the list works. Needs an editorial decision, not a patch.
>
> **Not yet wired to anything real:** per the 2026-08-05 note above, pointing GitHub's webhook at a live endpoint waits on Phase 5. The flag is off by default.

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

## Phase 8 — Polishing and cleaning (added 2026-08-26)

Opened as the home for work that is neither a new feature nor a bug in something shipped: the hardening Phases 1–3 deferred on purpose, and the visual design the site never had. Not sequenced as a whole — the visual work and the hardening are independent of each other, and each item ships on its own PR; the one ordering that matters is noted where it applies. Milestone `Phase 8` is number `10`; as everywhere else here, the milestone number does not match the phase number.

**Visual design** — **complete for the public pages** (issue #152, PRs #153/#154/#155).
- [x] Direction settled *before* any of it was built (#153) — three directions mocked against the real content and compared on both grounds; ADR in `docs/DECISIONS.md`, 2026-08-22. What the site actually had was browser defaults plus accessibility repairs: no type scale (`h2` at 1.1× body), headings inheriting body leading, tag chips in Arial against `system-ui`, and `--color-border: #ccc` drawing **15** strokes at 1.6:1 on white and **11.7:1 on the near-black canvas** (all four of #152, the ADR, `styles.spec.ts` and this entry originally said 16, which counts the `--color-border` declaration alongside its 15 usages; corrected in #159)
- [x] A token layer with **every colour that can carry two values defined per scheme, and its computed ratio recorded beside it** (#154) — twelve of the fourteen tokens; the two that deliberately do not flip are enumerated by the suite's flip test, plus a completeness test that fails the build if a `--color-*` token exists that the ratio table does not know about. One token declared once and inherited by both grounds is precisely how #116 and the border defect happened — twice, which is why the guard is a test and not a convention
- [x] Self-hosted `Archivo` + `IBM Plex` rather than the Google Fonts CDN — visitor IPs on an EU-facing site, and #122's future CSP keeping `font-src` at `'self'`
- [x] Per-project generated artwork where no image exists (#155) — deterministic from title and *sorted* tags, kept out of the accessibility tree, reporting its own degraded state via `data-artwork`
- [x] **Follow-up, shipped** (#156, PR #158) — the card chose artwork on whether an image was *specified*, never whether one *arrived*, so a dead URL left an empty plate permanently. Now `(error)` on the `<img>`, failures keyed by **URL** so a repaired link recovers on the next load, and the slot reports `data-media="image" | "artwork" | "artwork-fallback"` so a card that lost its image is distinguishable from one that never had one. Frontend 329 → 337 tests
- [x] **Follow-up, shipped** (#159, PR #163) — three comments carried contrast figures that did not survive recomputation, including one naming the wrong colour pair: `#fff` on the light accent is 5.83:1, not the 5.65:1 copied down from the `--color-accent` row. No token value or threshold changed. The artwork's plate luminances and 3:1 window are now asserted by tests rather than left as prose, and `0.18` is pinned near the window's midpoint rather than merely inside it. Frontend 337 → 341 tests
- [ ] **Left as a direction question, not a defect:** `main` is 960px, which puts detail-page prose at roughly 120 characters per line against a comfortable 60–75. Narrowing it is a taste call on a page nobody has re-read since the cards landed

**Security hardening** — deferred from Phases 1–3 deliberately, not overlooked.
- [ ] #122 — no Content-Security-Policy or security response headers anywhere
- [ ] #123 — the admin JWT is readable from JavaScript, so any XSS is a full admin session takeover. Wants #122 first: a CSP is the cheaper half of the same problem, and doing the cookie rework without one just moves the exposure

## Ongoing / meta

- [ ] Treat `SPEC.md` and the OpenAPI contract as source of truth — update them **before** changing code, not after the fact
- [ ] Keep `AGENT_LOG.md` running for the whole project, not just Phase 4
- [ ] Periodically do a short tech-debt pass rather than letting rough edges silently accumulate

---

## Definition of Done

Beyond each phase's own feature checklist above, every phase's closing PR needs to clear these before it's mergeable. Added 2026-08-01 after Phase 1's two PR review rounds kept surfacing the same handful of gap-shapes rather than new ones each time — see `AGENT_LOG.md`'s 2026-08-01 entries for the specifics that prompted this. Deliberately generic rather than backend- or Phase-1-specific: Phase 2's CRUD expansion and Phase 7's four new extension packages are exactly where these same shapes are likely to recur.

- [ ] **Error paths are tested with actual status/response assertions, not just "doesn't look like the default error page."** A response having the right *shape* doesn't mean the status code is right — verify malformed/unexpected input against the specific status it should produce, not just that something structured comes back.
- [ ] **Any interim or placeholder security/permission config fails closed by default.** Deny unless an explicitly-named allow case (e.g. an active `dev` profile) matches — never permit unless an explicitly-named deny case matches. Applies even to scaffolding meant to be replaced later; "it's temporary" doesn't lower the bar.
- [ ] **Absence of configuration is its own test case.** No profile set, a missing env var, an unset default — these need explicit coverage, not just the branches you happened to write config for. A test that "passes" only because the app failed to boot for an unrelated reason doesn't count as coverage of the thing it was meant to verify.
- [ ] **JPA entities used as `Set`/`Map` elements implement `equals`/`hashCode` by natural key, not identity.** Correctness that only holds because of Hibernate's first-level cache isn't correctness — it breaks the moment two instances for the same row cross a persistence-context boundary. Entity accessors that expose collections or arrays return defensive copies, not live internal references.

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
