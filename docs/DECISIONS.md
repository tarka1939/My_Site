# Decisions

Log of locked-in decisions and the reasoning behind them. Pre-seeded with the defaults proposed in `PROJECT_TODO.md` — review each, confirm or override, and record the final call. Add new entries below as they come up.

## How to use this file

Each row is a decision. `Status` is one of: `proposed`, `confirmed`, `overridden`. If overridden, add a line explaining why under the table. `PROJECT_TODO.md` itself frames all of these as "reviewable assumptions, not settled facts" — leave `Status` at `proposed` until you've actually made the call, don't mark `confirmed` by default.

## Foundational decisions (from PROJECT_TODO.md)

| Decision | Default | Status | Notes |
|---|---|---|---|
| Repo structure | Monorepo (`/backend`, `/frontend`, `/docs`) | proposed | not revisited in the 2026-07-24 review pass — carry forward as-is unless flagged later |
| Database | PostgreSQL | **confirmed** (2026-07-24) | already baked into `docs/DATA_MODEL.md` (jsonb, text[]) and `docs/openapi.yaml` |
| ORM | Spring Data JPA + Hibernate | **confirmed** (2026-07-24) | |
| Schema migrations | Flyway | **confirmed** (2026-07-24) | never `hibernate.ddl-auto=update` outside local scratch experiments |
| API contract | OpenAPI 3.0, written before implementation | **confirmed** (2026-07-24) | `docs/openapi.yaml` written and validated; shared contract for independent backend-agent/frontend-agent sessions (Phase 4) |
| Auth | JWT-based admin login | **confirmed** (2026-07-21) | see SPEC.md → Auth scope decision; expiry/reset flow detailed below (2026-07-24) |
| Angular architecture | Standalone components, signals for state, no NgRx | **confirmed** (2026-07-25) | this site's state is simple and mostly server-derived; none of NgRx's justifying cases (undo/redo, optimistic updates, deep cross-cutting state) apply here |
| Frontend hosting | **Netlify** (overridden from TODO's GitHub Pages default) | **confirmed** (2026-07-25) | see ADR below — no non-commercial ToS restriction (unlike Vercel), native SPA rewrites, no 404.html workaround needed |
| Backend hosting | Render, Railway, or Fly.io free tier | **overridden** (2026-07-21) | replaced by a self-managed VPS — see note below table; specific provider still TBD, deliberately deferred (2026-07-24 review) to closer to Phase 5 |
| Cross-origin setup | CORS on Spring Boot, allowlisting the frontend origin | **confirmed in principle** (2026-07-25) | exact origin is a `*.netlify.app` subdomain, **TBD until the Netlify site is created** (Phase 5) — no custom domain planned, see `docs/DECISIONS.md` license/domain ADR |
| SPA routing on Pages | ~~`404.html` fallback~~ — **N/A, superseded** | **confirmed** (2026-07-25) | moot once Netlify was chosen — Netlify handles SPA routing natively via a one-line `_redirects` file, no build-step workaround needed |
| CI/CD | GitHub Actions — separate workflows for frontend deploy (to Netlify) and backend container build/deploy | **confirmed** (2026-07-24) | two distinct deploy targets, not one pipeline; frontend workflow now deploys to Netlify (e.g. via `nwtgck/actions-netlify`) instead of `actions/deploy-pages` |
| Task tracking | GitHub Projects board (Backlog → Ready → In Progress → In Review → Done), linked to Issues | **confirmed** (2026-07-24) | already built: project #1, all checklist items converted to issues and added, tagged by phase/component |
| Backend module structure | Package-by-feature + **Spring Modulith** (enforced boundaries) | **confirmed** (2026-07-25) | see ADR below — low added cost (one dependency, one verification test) for enforced boundaries as Phase 7 adds 4 more packages |
| Build tool | **Maven** | **confirmed** (2026-07-29) | see ADR below — never decided until now; single-module backend gets no benefit from Gradle's build-speed/multi-module advantages |
| Backend framework version | **Spring Boot 4.1.0** | **confirmed** (2026-08-01) | see ADR below — never decided until Phase 1 implementation surfaced it; paired with Spring Modulith 2.1.0 |
| Cross-feature communication | Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) | **confirmed** (2026-07-24) | lets Phase 7 extensions react to core CMS actions without direct coupling |
| Async/background jobs | Dedicated `@Async` task executor, provisioned in Phase 1 before anything uses it | **confirmed** (2026-07-24) | needed by the DSP demo (7d); built early so it's not retrofitted under time pressure |
| Feature rollout | Config-based feature flags per extension | **confirmed** (2026-07-24) | ship the core CMS live while Phase 7 extensions are still half-built |

**Backend hosting override, explained:** chosen over the TODO's Render/Railway/Fly.io default in favor of a self-managed VPS. Trade-off: no free-tier spin-down-on-inactivity cold starts, but you take on OS patching, TLS renewal, reverse proxy, and process supervision yourself instead of a PaaS handling it. Specific provider not yet chosen.

## Additional decisions

_Add new ADR-style entries below as they arise._

### 2026-07-21 — Backend hosting: self-managed VPS instead of managed PaaS

**Context:** `PROJECT_TODO.md` defaulted to Render/Railway/Fly.io free tier. Reviewed and overridden.

**Decision:** Deploy the Spring Boot backend to a self-managed VPS rather than a managed PaaS. Specific provider not yet chosen.

**Alternatives considered:** Render, Railway, Fly.io (all managed PaaS free tiers, with inactivity spin-down and less operational overhead).

**Consequences:** No free-tier cold-start spin-down, but manual responsibility for OS patching, TLS certificate renewal, reverse proxy configuration, and process supervision/restarts — all otherwise handled automatically by a PaaS. Budget setup time in Phase 5 accordingly.

### 2026-07-21 — Project license: All rights reserved

**Context:** Portfolio repo, solo-maintained, no plan to accept external contributions or explicitly permit reuse.

**Decision:** All rights reserved (no open-source license file).

**Consequences:** Code is visible (if the repo is public) but not licensed for reuse by others. Revisit if you later want to open-source parts of it.

### 2026-07-21 — Baseline JDK/Node versions: JDK 25 + Node 24

**Context:** JDK 21 + Node 20 was floated as "the current LTS pair," which was stale by mid-2026: Node 20 is past its recommended window (Node 24 is the current active LTS as of June 2026; Node 22 is maintenance-only), and JDK 21's permissively-licensed updates end September 2026 (JDK 25, released September 2025, is the current LTS).

**Decision:** Target JDK 25 and Node 24 for local dev and CI as the current LTS pair.

**Consequences:** Newer toolchain with a longer support runway; verify Spring Initializr and Angular CLI tooling support these versions when Phase 1/3 scaffolding actually happens, since tooling support can lag a few months behind a language runtime's own release.

### 2026-07-24 — Data model conventions: UUID PKs, URL-array images, jsonb links

**Context:** `docs/DATA_MODEL.md` had entities drafted with blank field types — needed concrete types before Flyway migrations or the OpenAPI spec can be written. Three sub-decisions were bundled together since they all shape the schema:

1. **Primary keys:** `uuid` on every table vs. auto-increment `bigint`.
2. **Project images:** array of external URL strings vs. a normalized `ProjectImage` table with server-side upload/storage.
3. **Project links:** `jsonb` array of `{label, url}` vs. a normalized `ProjectLink` table vs. a single URL column.

**Decision:** UUID primary keys everywhere; images as a `text[]` of externally-hosted URLs (no upload endpoint); links as a `jsonb` array of `{label, url}` objects on `Project` directly.

**Alternatives considered:** Auto-increment bigint PKs (rejected — sequential IDs are enumerable/guessable once exposed in public API URLs, e.g. `/api/projects/42` vs `/api/projects/f47ac10b-...`). Normalized `ProjectImage`/`ProjectLink` tables (rejected for now — adds joins and, for images, real storage infrastructure the budget-conscious/no-real-scale constraint doesn't justify).

**Consequences:** No file upload/storage backend needed for project images — admin pastes URLs directly, keeping Phase 2 CRUD simple. `links`/`images` are opaque blobs from the DB's perspective (no referential integrity on individual URLs, no per-image ordering/alt-text metadata) — acceptable for a portfolio site with a handful of projects; revisit if per-image metadata is ever needed. UUID PKs mean every table needs `gen_random_uuid()` (Postgres `pgcrypto`/`uuid-ossp` extension, or app-generated UUIDs at the JPA layer) rather than relying on `bigserial`.

### 2026-07-24 — API contract conventions: versioning, pagination, error format, tag filtering

**Context:** Writing `docs/openapi.yaml` required picking conventions that apply across every endpoint, not per-endpoint decisions: URL versioning, pagination shape, error response format, and multi-value tag filtering semantics.

**Decision:**
- All endpoints namespaced under `/api/v1`.
- Pagination via `page`/`size` query params (Spring Data `Pageable`-compatible), wrapped in a custom `PageMeta` response (`content`/`page`/`size`/`totalElements`/`totalPages`) rather than Spring Data's raw `Page<T>` serialization.
- Errors as RFC 7807 Problem Details (`application/problem+json`) — Spring Boot 3's native `ProblemDetail` support, extended with a `ValidationProblemDetail.errors[]` array for field-level Bean Validation failures.
- Multiple `?tag=` query params on `GET /projects` are OR'd together (any matching tag), not AND'd (intersection).

**Alternatives considered:** No version prefix (rejected — cheap to add now, breaking to add later). Exposing Spring Data's raw `Page<T>` JSON directly (rejected — couples the public contract to an internal Spring type and leaks unused `pageable`/`sort` metadata). A hand-rolled error shape (rejected — RFC 7807 is Spring Boot 3's default, so fighting it costs more than adopting it). AND semantics for multi-tag filtering (rejected — a stricter default that's easy to loosen later if needed, but OR matches how tag-filter UIs typically behave).

**Consequences:** `docs/openapi.yaml` reflects all four; the generated Angular client (Phase 3) and backend `@ControllerAdvice` (Phase 1) should both target this shape from the start, avoiding a contract-mismatch patch later.

### 2026-07-24 — Auth flow: login-only JWT, no refresh token, no self-service registration

**Context:** `docs/openapi.yaml` needed a concrete `/auth/login` contract. Two related scope questions came up: whether to support token refresh, and whether `AdminUser` accounts are created via the API or provisioned another way.

**Decision:** `POST /auth/login` is the only auth endpoint. No refresh-token flow — the frontend re-prompts login once the JWT expires. No `POST /admin-users` or self-service registration — the single `AdminUser` row is seeded via a Flyway migration (or manual DB insert), not the API.

**Alternatives considered:** Refresh-token endpoint (rejected — real complexity for a single-admin, low-security-stakes portfolio site; re-login is a non-issue at this scale). Self-service admin registration (rejected — directly contradicts the "no multi-user support" non-goal in `SPEC.md`; an API-exposed way to create admin accounts is also a bigger attack surface than a migration-seeded row).

**Consequences:** Simpler backend (`auth` sub-package needs only login + JWT issuance/validation, not refresh/rotation). Provisioning the first admin account is a manual step to document in Phase 1/2 setup instructions (e.g. a Flyway seed migration with a bcrypt-hashed password, or a one-off script) — not yet written, flag if Phase 1 setup docs are missed later.

### 2026-07-24 — JWT expiry (1 hour) and password reset flow via transactional email API

**Context:** Two gaps surfaced during the pre-Phase-1 review: `docs/openapi.yaml`'s `LoginResponse.expiresAt` had no actual duration behind it, and there was no way to recover a forgotten `AdminUser` password (the 2026-07-24 "Auth flow" ADR only covered login/no-refresh/no-registration, not reset).

**Decision:**
- JWT session tokens expire after **1 hour**.
- A password reset flow is in scope: `POST /auth/password-reset-request` (always 202, avoids email enumeration) and `POST /auth/password-reset` (token + new password). A new `PasswordResetToken` entity (see `docs/DATA_MODEL.md`) stores a hash of a single-use token with a **30-minute** expiry — shorter than the session token, since a leaked reset token is a higher-risk artifact (email interception) than a session token.
- Reset emails are sent via a **transactional email API (Resend)**, not self-hosted SMTP.

**Alternatives considered:** Longer JWT expiry (24h/7d) — rejected as unnecessarily permissive for a single-admin account with no compensating refresh flow. No password reset at all (manual DB/migration recovery only) — rejected once weighed against the low cost of adding it versus being locked out of content management with no recourse but a database migration. Self-hosted SMTP via the VPS (`JavaMailSender`) — rejected: real deliverability risk (self-hosted mail is easily spam-flagged) and mail-server security overhead, disproportionate to sending one email type at low volume.

**Consequences:** New `password_reset_token` table and two new public endpoints (`docs/openapi.yaml`, `docs/DATA_MODEL.md` both updated). New external dependency: a Resend account and API key, which needs to go through the CI/CD secret store already planned for Phase 5 (`RESEND_API_KEY`, never committed). New checklist item added to `PROJECT_TODO.md` Phase 2 (not in the original plan). A corresponding GitHub issue should be created and added to project #1.

### 2026-07-25 — Frontend hosting: Netlify instead of GitHub Pages or Vercel

**Context:** `PROJECT_TODO.md` defaulted to GitHub Pages. Reviewed 2026-07-24 alongside Netlify and Vercel as alternatives; verified current (2026) pricing/ToS terms before deciding.

**Decision:** Deploy the Angular frontend to Netlify. Netlify's free tier has no non-commercial-use restriction (unlike Vercel's Hobby plan, which technically requires upgrading to Pro the moment the site does anything monetized) and handles SPA routing natively via a one-line `_redirects` file (`/* /index.html 200`), so the GitHub-Pages-specific `404.html` copy-and-serve-a-real-404-status workaround is no longer needed.

**Alternatives considered:** GitHub Pages (rejected — no second account, but static-only with no native SPA rewrite support, forcing the `404.html` workaround; also a GitHub *project* page requires `--base-href /My_Site/`, adding a path-prefix complication Netlify doesn't have). Vercel (rejected — more generous flat 100GB bandwidth, but Hobby tier ToS is explicitly non-commercial-only; Netlify has no equivalent restriction).

**Consequences — real rework required:**
- `--base-href` simplifies from `/My_Site/` to the default `/` (a Netlify subdomain or future custom domain serves from root, not a repo-name subpath).
- CORS allowlist origin changes from `https://tarka1939.github.io` to a `*.netlify.app` subdomain — **exact value TBD until the Netlify site is actually created** (Phase 5); no custom domain planned (see license/domain ADR), so the final origin will be whatever subdomain is chosen then.
- SPA routing: replace the planned `404.html` copy step with a `frontend/public/_redirects` file containing `/* /index.html 200`.
- Phase 5 frontend CI/CD workflow deploys to Netlify (e.g. via the `nwtgck/actions-netlify` GitHub Action) instead of `actions/deploy-pages` — CI/CD tool choice (GitHub Actions) itself is unchanged, just the deploy target.
- `SPEC.md`, `README.md`, `CLAUDE.md`, `PROJECT_TODO.md`, and GitHub issues #31/#32/#38/#39/#40 all referenced GitHub-Pages-specific mechanics and needed updating alongside this decision — see `CHANGELOG.md` for the full list.

### 2026-07-25 — Backend module structure: package-by-feature + Spring Modulith

**Context:** Package-by-feature was already the confirmed directory layout; the open question was whether to add Spring Modulith's enforcement tooling on top of it, discussed 2026-07-24 alongside the classic layered-split alternative. Confirmed current (Spring Modulith 2.0 GA'd November 2025 targeting Spring Boot 4; 1.4 GA'd March 2026 for Boot 3.x — actively maintained either way).

**Decision:** Adopt Spring Modulith on top of the already-confirmed package-by-feature layout. Add `spring-modulith-starter-core` (+ `spring-modulith-starter-test`), each top-level package (`project/`, `contact/`, later `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/`) is auto-recognized as an application module by convention, and a test calling `ApplicationModules.of(MyApplication.class).verify()` fails the build if one module reaches into another's internals instead of going through its public API or an event.

**Alternatives considered:** Plain package-by-feature, no Modulith (rejected — same directory layout, but boundary violations are only caught by code review, not a test; cheaper short-term, weaker guarantee as Phase 7 adds four more packages). Classic layered controller/service/repository split (rejected earlier, 2026-07-24 — shared folders become unwieldy once Phase 7 lands).

**Consequences:** One new dependency and one verification test to write in Phase 1, alongside the already-planned package-by-feature scaffolding — low incremental cost. Optional follow-ons worth considering in Phase 1: `spring-modulith-docs` to auto-generate a module diagram from actual code (a low-effort artifact for the site's own build-process page, Phase 6), and `spring-modulith-events` to make the already-confirmed `ApplicationEventPublisher` pattern durable/transactional instead of fire-and-forget in memory — not decided here, revisit when Phase 1's event-publisher example is actually built.

### 2026-07-25 — GitHub Project organization: milestones per phase + selective parent/sub-issues

**Context:** with all 69 issues flat and only distinguished by a `[Phase N]` title prefix, there was no native progress view per phase and no structural link between Phase 7's four sub-phases (7a–7d) or Phase 5's two deploy targets (frontend/backend) and their individual tasks.

**Decision:** two additions, not a full restructure:
- One GitHub milestone per phase (Phase 0 through 7, plus Ongoing/meta) — populates the project board's already-existing but unused "Milestone" field, gives a native percent-complete view per phase. No due dates (no hard deadline on this project).
- Parent/sub-issue relationships only where a phase already has real two-level structure: six new parent "epic" issues (#70–#75) covering Phase 7a, 7b, 7c, 7d, and Phase 5's Frontend/Backend split, with the corresponding 24 existing issues linked as sub-issues.

**Alternatives considered:** parent issues for every phase (rejected — phases 0–4 and 6 are flat task lists; a milestone already groups those, so parent issues on top would duplicate that view without adding real hierarchy — the same over-engineering discipline already applied to skipping NgRx/Kubernetes elsewhere in this plan). No milestones, labels only (rejected — labels already exist for component (`backend`/`frontend`/`infra`) and repurposing them for phase would collide with that existing use).

**Consequences:** parent/sub-issues are live as of 2026-07-25 (all 6 epics created, 24 sub-issues linked, all added to project #1). Milestones were initially blocked on a manual step — the connected GitHub tooling can assign an issue to an existing milestone but has no way to create one. **Resolved (updated 2026-08-07):** all 9 milestones now exist, created by hand on GitHub's site — Phase 0 through Phase 7, plus `Meta`. Milestone *numbers* do not line up with phase numbers (Phase 4 is milestone `5`, Phase 7 is `8`, `Meta` is `9`), so look them up with `gh api repos/tarka1939/My_Site/milestones` rather than inferring them from the phase — see `CLAUDE.md`'s PR conventions.

### 2026-07-29 — Build tool: Maven

**Context:** never explicitly decided in any project doc (`SPEC.md`, `docs/DECISIONS.md`, `PROJECT_TODO.md` all lacked a build-tool line) despite Spring Initializr requiring a choice on day one of Phase 1. Surfaced ahead of the Phase 1 Claude Code handoff.

**Decision:** Maven for the Spring Boot backend.

**Alternatives considered:** Gradle (rejected — its real advantages are build-cache/incremental-build speed on large or multi-module repos and CI pipelines running builds constantly; `/backend` is a single Spring Boot module with no multi-module structure and no heavy-CI build-speed need, so those advantages don't apply here — the same "you're not getting the benefit, only the complexity" reasoning already used to skip NgRx and Kubernetes elsewhere in this plan. Maven's declarative, fixed-lifecycle POM also has less surface area for an agent-authored build file to introduce a subtle misconfiguration than a scriptable Gradle build, and it's the more heavily-documented option for Spring Boot specifically.).

**Consequences:** Phase 1 Spring Initializr scaffolding selects Maven; `pom.xml` is the build descriptor (`groupId`/`artifactId`/`packaging` to be set at scaffolding time). No multi-module build planned, so this isn't expected to need revisiting.

### 2026-08-01 — Backend framework version: Spring Boot 4.1.0

**Context:** Like the build-tool decision above, no Spring Boot version was ever pinned in `SPEC.md`, `docs/DECISIONS.md`, or `PROJECT_TODO.md`, despite Spring Initializr requiring a choice on day one of Phase 1. Unlike Maven — a two-option choice caught and settled ahead of the Phase 1 handoff — this one wasn't caught in advance: it surfaced mid-scaffold, when `start.spring.io` turned out to no longer offer a 3.x option at all (only 4.0.x/4.1.x), forcing a live decision under implementation time pressure instead of a calm upfront one. Recorded retroactively so the same gap doesn't repeat at the next major-version boundary.

**Decision:** Spring Boot 4.1.0, paired with Spring Modulith 2.1.0 — confirmed via `repo1.maven.org`'s `maven-metadata.xml` to be the first Modulith release targeting Boot 4.1 (`search.maven.org`'s search index was stale and made 2.x look unreleased; don't trust it for "does version X exist" questions, use the Maven Central repository metadata directly).

**Alternatives considered:** Spring Boot 3.x — not a real alternative by the time this was decided; `start.spring.io` had already dropped it as a selectable option, so the "current LTS" reasoning already used for JDK 25 / Node 24 elsewhere in this plan applied by default rather than by comparison.

**Consequences:** Spring Boot 4 turned out to be a bigger jump than a routine minor-version bump, not just a version-number change. Several test-support classes (`@DataJpaTest`, `TestEntityManager`, `AutoConfigureTestDatabase`, `@AutoConfigureMockMvc`) were relocated out of `spring-boot-test-autoconfigure` into separate per-feature Maven modules with new packages; `spring-boot-starter-flyway` became required (`flyway-core` alone no longer triggers Flyway autoconfiguration — migrations just silently never run, no error); and Testcontainers 2.x (paired for compatibility) renamed several artifacts and removed generics from `PostgreSQLContainer`. All were hit and fixed during Phase 1 — see `AGENT_LOG.md`'s 2026-08-01 entries for the specifics. Future major-version bumps (Boot 5 and beyond) should budget time for equivalent surprises rather than assuming a routine dependency bump; see `PROJECT_TODO.md`'s Definition of Done for the broader lesson this and the Phase 1 PR review rounds prompted.

### 2026-08-02 — Autonomous execution workflow: Senior Dev session + independent PR review

**Context:** Phases 1-3 were each run from a hand-written kickoff prompt per phase, with the user driving every step. Phase 4's original premise (build backend and frontend blind to each other, then integrate for the first time) didn't survive contact with reality — Phase 3 was built and smoke-tested against the real, running backend from the start (see `AGENT_LOG.md`'s Phase 3 entries, including a real CORS gap caught only by that live integration), so there was no "first integration" left for Phase 4 to test. Separately, the user wants to shift from hands-on prompting to a product-owner role for the remainder of the project (Phase 4's tail through Phase 6).

**Decision:** One persistent "Senior Dev" session the user talks to directly, acting as coordinator and task dispatcher rather than implementer: it breaks phase work from `PROJECT_TODO.md` into discrete tasks, dispatches each to a fresh implementation agent ("junior") session, checks the resulting changes against spec before accepting them, and itself maintains `AGENT_LOG.md`, `CHANGELOG.md`, `PROJECT_TODO.md`, and READMEs. Every PR then goes to a further fresh, independent Claude Code session for review (no shared context with the implementation), and escalates only on genuine blockers rather than stalling all work on one open question. Full model, escalation triggers, and the Phase 5 pre-flight checklist are in `docs/AGENT_WORKFLOW.md`'s companion doc, `docs/AUTONOMOUS_WORKFLOW.md`. Phase 4 itself is adapted: the backend/frontend isolation exercise moves to Phase 7 (new, not-yet-built extensions are a real contract-first venue for it), and Phase 4 becomes formally documenting the mismatches already caught in Phases 2-3 plus building the Playwright E2E tests.

**Alternatives considered:** Keep hand-writing a kickoff prompt per phase (rejected — real friction the user explicitly wants to move past, and doesn't scale to "run autonomously unless problems arise"). Force the original Phase 4 isolation exercise onto the current, fully-integrated codebase anyway (rejected — there's no new feature left to build blind; rebuilding an already-built site blind to itself would be theater, not a real test). Full unattended autonomy including Phase 5 infrastructure (rejected — account creation, payment, and first-deploy secrets/DNS/TLS going live together are a different risk class than pure code changes; these get explicit human checkpoints regardless of how autonomous earlier phases were).

**Consequences:** `docs/AUTONOMOUS_WORKFLOW.md` is the operative spec going forward for Phase 4's tail through Phase 6. `PROJECT_TODO.md`'s Phase 4 checklist is annotated with the adaptation rather than silently reinterpreted. GitHub Copilot's review continues alongside the new independent-session review, not replaced by it — both have independently caught real defects so far. **Amended 2026-08-08:** Copilot is temporarily suspended from the merge gate — its quota is exhausted until 2026-08-25 and it answers review requests with a quota error. PRs #81, #82, #83 and #84 merged on the independent review alone. The intent of this ADR is unchanged: restore Copilot as a required layer when quota returns, because a quota error is not the same claim as "the reviewer found nothing."

### 2026-08-07 — Playwright E2E lives in a top-level `/e2e`, and provisions its own admin account

**Context:** Phase 4's E2E suite (issue #37) needed a home, and a way to authenticate. Neither was settled by any existing doc. Two sub-decisions, bundled because the second only arises once the first is made:

1. **Location:** inside `frontend/` (reusing its `package.json` and `node_modules`) vs. a new top-level `/e2e` package.
2. **Authentication:** the suite has to log in as an admin to seed fixtures and exercise the admin journey, but `docs/DECISIONS.md`'s "Auth flow" ADR deliberately rules out a registration endpoint, and the plaintext password behind `V2__admin_user_email_and_seed.sql`'s bcrypt hash was never committed — it was generated once and shared out of band, so it is unavailable from a clean checkout.

**Decision:** A top-level `/e2e` package with its own `package.json`. `frontend/package.json` is left untouched.

For auth, the suite provisions a **separate, test-only** admin row (`e2e-admin`) directly in Postgres during global setup, then does everything else — login, fixture seeding, read-back assertions, cleanup — through the real HTTP API. Because the password it inserts is committed in plain text, every target the suite can mutate is guarded by one localhost allowlist in `e2e/support/locality.ts`, which explicitly forbids adding a force-override: the direct database write in `e2e/support/db.ts`, and `E2E_BACKEND_URL` / `E2E_FRONTEND_URL`, which the setup and teardown purges aim `DELETE` requests at. The credentials are also revoked unconditionally at teardown — both the `e2e-admin` row and the cached JWT, since the backend is a stateless resource server that never re-checks a token's subject, so removing the account alone would leave a working admin credential on disk for the rest of its hour.

**Alternatives considered:**

- *Playwright inside `frontend/`* (rejected — Phase 5 deploys `frontend/` to Netlify, so every production build would install a browser-automation framework for no benefit; the suite is also cross-cutting by nature, driving the backend as much as the frontend, so filing it under one side misrepresents it).
- *Reusing the seeded `admin` account* (rejected — impossible, not merely inconvenient: the password does not exist in the repository by design).
- *Adding a test-only registration endpoint or seeding profile to the backend* (rejected — production attack surface, or production code paths existing only for tests, to avoid one guarded fixture insert).
- *Seeding fixture projects directly via SQL too* (rejected — the suite's value is exercising the real contract; bypassing the API for convenience would test the database, not the application).

**Consequences:** Running the suite needs its own `npm install` plus `npx playwright install` (~115 MB browser download) — a prerequisite documented in `e2e/README.md`, and the exact step whose omission made the suite fail on its first real run (see `AGENT_LOG.md`, 2026-08-07). Postgres is deliberately *not* managed by Playwright's `webServer`, so the runner can never drop a developer's database on exit; the two application servers are, since they're stateless. The suite spends two of `AuthService`'s five-logins-per-fifteen-minutes budget per run — the admin journey's real UI login, which can't be cached, plus setup's API login, which deliberately isn't: teardown discards the cached token, so roughly the third full run inside fifteen minutes trips the limiter. Acceptable at normal cadence, and the limiter is in-memory so restarting the backend clears it; both noted in `e2e/README.md`. When Phase 5 adds CI, this suite needs Postgres, a JDK, Node, and a browser in the runner image — a heavier job than the existing backend/frontend test steps.

### 2026-08-08 — Project dates: a start/end period at day precision, rendered month/year

**Context:** `SPEC.md` line 11 has listed "dates" among a project detail's fields since Phase 0, but the `Project` entity was designed with only `created_at`/`updated_at` — *record* timestamps, not dates describing the work. The gap survived the data-model design, the OpenAPI contract, and four PR review rounds, and only surfaced during Phase 6 content drafting (#49), when the drafted entries had nowhere to record when anything was built. So the choice was either to implement what the spec already promised or to correct the spec; the owner chose to implement (issue #85).

Two sub-decisions, bundled because the second only matters once the first is settled: the *shape* (single date vs. a period vs. free text) and the *precision*.

**Decision:** `started_on` plus a nullable `completed_on`, both `date`.

- **Null `completed_on` means ongoing** — a meaningful value, not missing data. This is the case the drafted content actually needs; several entries are live work.
- **Null `started_on` means unspecified.** Both columns are nullable so the migration is additive and non-destructive against existing rows.
- **`completed_on` must not precede `started_on`**, and cannot be supplied without it. Enforced twice: cross-field validation at the DTO layer for a clean 400, and a table `CHECK` constraint so the invariant holds regardless of how a row is written.
- **Stored at day precision, rendered month/year.** The convention is the 1st of the month.

**Alternatives considered:**

- *A single date* (rejected — cannot express an ongoing project or a span, so a multi-year piece reads the same as a weekend utility, which is exactly the signal a portfolio exists to convey).
- *A free-text period string like "2024–2025"* (rejected — no sorting, no filtering, no validation, and guaranteed formatting drift across entries; the flexibility is not worth losing an orderable field, especially with #88 open on portfolio ordering).
- *Year-only integers* (rejected — two projects from the same year become unorderable, and the field is meant to give a meaningful sort).
- *Full date precision in the UI* (rejected as **false precision**: the source repos' git history does not reflect when the work happened — folder names say 2024 while first commits are Feb 2026 — so presenting a day would assert something unknowable. Day precision is retained in storage only because `date` is the natural Postgres type and month/year is a rendering concern, not because the day is trusted.)
- *Reusing `created_at`* (rejected — it records when the row was typed in. The two diverge by years for migrated content, and conflating them would make the portfolio sort by data-entry order.)

**Consequences:** A cross-cutting change touching contract, backend and frontend together: `docs/openapi.yaml` (`Project` and `ProjectWriteRequest`), a Flyway migration adding two nullable columns plus the `CHECK`, the JPA entity and DTOs with cross-field validation, the regenerated Angular client, and the admin form plus list/detail rendering. Because `ProjectWriteRequest` is also the PUT body, **omitting either field on update clears it** rather than preserving the stored value — consistent with the existing full-replacement semantics, and called out explicitly in the contract so it isn't discovered by accident. Unblocks #49 (content migration) and feeds #88 (portfolio ordering), which may be satisfied by sorting on these rather than needing a separate ordering field.

### 2026-08-10 — SEO: static tags plus runtime per-route tags; prerendering deferred

**Context:** Phase 6's SEO item (#50) needs meta tags, `sitemap.xml` and `robots.txt`. The frontend is a **client-rendered** Angular SPA served as a static build from Netlify, which constrains what is actually achievable. Per-route `title`s already work via Angular's built-in title strategy; `index.html` carries only `charset` and `viewport` — no description, no Open Graph, no Twitter card. There are no SSR dependencies.

The decisive fact: **Googlebot executes JavaScript, but the social scrapers do not.** LinkedIn, Twitter/X, Slack, Discord and Facebook fetch the HTML and read what is in it. For a portfolio, those are the sharing surfaces that matter — a link posted to LinkedIn is the realistic distribution path, not a search result.

**Decision:** Do both of the cheap things, and defer the expensive one.

1. **Static tags in `index.html`** — description, Open Graph and Twitter card, one set describing the site. These are in the served HTML, so *every* crawler sees them without exception.
2. **Runtime per-route tags** via Angular's `Meta` service, alongside the existing title strategy. Googlebot renders JS, so search indexing gets per-route accuracy, and it costs almost nothing on top of a mechanism already in place.

`sitemap.xml` and `robots.txt` are drafted with a placeholder origin and the checklist item stays **flagged incomplete** until the canonical domain exists — per `PROJECT_TODO.md`'s explicit instruction not to guess it.

**Alternatives considered:**

- *Runtime tags only* (rejected). It optimises for the one crawler that already works. Social scrapers would keep showing whatever is in `index.html`, so the previews people actually see would be empty — the exact case this item exists to fix.
- *Static tags only* (rejected as insufficient, kept as the foundation). Correct everywhere but identical on every route, and it forgoes per-route accuracy that is nearly free given the title strategy already exists.
- *Prerendering / SSR via `@angular/ssr`* (**deferred, not rejected** — see below).

**Why prerendering is deferred rather than dismissed.** It is the technically best answer: real HTML per route, correct for every crawler, faster first paint, and the only way per-project link previews genuinely work. Three things make it the wrong trade *today*:

1. **It contradicts a standing decision.** `/projects/:id` needs the project list at build time, so the Netlify build would have to reach the VPS API. The generated API client was committed to the repo specifically so the Netlify build never depends on the backend (2026-08-02, Phase 3). Prerendering reintroduces that coupling and makes a backend outage a frontend build failure.
2. **Content staleness needs more machinery.** Previews would not update until a rebuild, so it wants a deploy webhook — which overlaps Phase 7a's GitHub sync work rather than standing alone.
3. **It buys per-project previews for projects that are not live.** The five drafted entries (#49) are not applied anywhere, and Phase 5 is paused. This would be the largest complexity increase in the frontend so far, bought before there is anything to preview.

**Revisit when** real content is live *and* per-project link previews are actually wanted. At that point the sequence is: add `@angular/ssr`, prerender the static routes, and decide separately how `/projects/:id` gets its route list — a build-time API call, a committed manifest, or on-demand rendering at the edge. Until then, a shared link to a project page shows the site-level preview, which is a known and accepted limitation rather than a bug.

**Consequences:** Frontend-only; no contract, backend or data-model change. `index.html` gains static tags, and route components set their own description/OG at runtime. Two of the three checklist deliverables complete; `sitemap.xml`/`robots.txt` remain open on the domain. If prerendering later lands, the runtime tags become redundant for crawlers but stay correct for in-app navigation, so nothing here needs unwinding.

**One further consequence, to settle when the real origin lands** (added 2026-08-14 from the PR #103 review — the decision above is unchanged, this is a knock-on effect it did not spell out). The static `og:url` is a single site-level value, and because Netlify returns the same `index.html` for every path, a non-JS scraper sees it on `/projects/<id>` too. Facebook and LinkedIn do not treat `og:url` as decoration: it is the shared object's *identity*, so they key their share cache and engagement counts on it and point the preview card's link at it. The ADR already accepts that a shared project link previews with the site-level **content**; the part not stated is that its **identity and destination** are the site root as well, so two different project links can collapse into one cached object and the card sends the reader to the landing page rather than the project. This is inert today — `.invalid` cannot resolve, so nothing is being cached — and becomes live the moment the placeholder is replaced. It is called out at the placeholder in `frontend/src/index.html` for whoever does that. Three options at that point, cheapest first: accept it (a portfolio's realistic share is the site itself, and the runtime `SeoService` already rewrites `og:url` per route for anything that executes JS); drop the static `og:url` so scrapers fall back to the URL they actually fetched, which is per-page correct but forgoes a stable identity for the root; or land prerendering, which fixes this and the preview content together, and whose deferral conditions are set out above.

### 2026-08-18 — Phase 7a webhook sync: never writes curated copy, and auto-created repos arrive unpublished

**Context:** #54 says a verified push/release webhook should "sync repo metadata into the Project service." Read naively that destroys the site's content: the portfolio's prose is hand-written and was signed off on 2026-08-17 (#49), so copying GitHub's repo description into `Project.description` would overwrite curated copy on every push — a data-loss path of the same class as #92, arriving automatically and on someone else's schedule.

**Decision:** Three rules.

1. **Sync never writes a curated field.** `title`, `description`, `tags`, `links`, `images`, `startedOn` and `completedOn` are the owner's and are never touched by an inbound webhook. This is a hard boundary, not a default.
2. **Sync writes only fields GitHub is authoritative for** and the admin never edits — `lastPushedAt`, `defaultBranch`, `archived`. These are facts about the repository, not statements about the work.
3. **A repo with no matching Project creates one, unpublished.** It is a draft for the owner to write and publish, never a live portfolio entry. Matching is by a new `Project.repoFullName` (`user/repo`, unique, nullable).

**Alternatives considered:**

- *Record deliveries only, write nothing to `Project`.* Zero content risk and the infrastructure still gets built, but it under-delivers #54 and produces nothing visible — the webhook would be machinery with no observable effect, which is hard to know is working.
- *Full metadata sync (description, topics → tags).* Rejected. It is the naive reading, and it is the one that destroys #49's content.
- *Auto-create as immediately-live entries.* Rejected. A curated portfolio that publishes whatever repos exist stops being curated, and the failure is public.

**Consequences, and the third is the one that costs:**

- **`Project` gains a `published` flag, and the public listing changes meaning.** Unpublished drafts must never appear on the site, so `GET /projects` and `GET /projects/{id}` filter to published while the admin endpoints see everything. That is a semantic change to the contract of the same kind as #124's tag filter, and it needs saying in `docs/openapi.yaml` rather than being implied by behaviour.
- **The migration must default existing rows to published.** Every project currently in the database was put there deliberately. A migration defaulting `published` to false would blank the live site on deploy — this is the single most dangerous line in the change and it wants an explicit `DEFAULT true` for existing rows with the column's *application* default being false for auto-created ones.
- **An ignore mechanism is required, not optional.** A webhook installed at organisation scope means every repo the owner touches becomes a draft, including private ones, experiments, and forks. Without one the admin list fills with noise, and "just delete it" does not work — the next push recreates it.

  *Amended 2026-08-21, on implementing #54:* this originally said "denylist" and shipped as an **allowlist** (`app.github-sync.synced-repositories`, empty by default). The polarity matters more than the mechanism, and the deciding argument is what happens when the config is blank — the state of a fresh environment or a forgotten variable. An empty allowlist syncs nothing; an empty denylist syncs everything. The set sizes point the same way: repositories a portfolio tracks are few and known, repositories to exclude are unbounded. No wildcards, since `owner/*` reintroduces fail-open.
- **The admin UI needs a publish control**, and the project list needs to show draft status. Auto-created rows are invisible on the site but must be obvious in the admin.
- **`archived` is stored but not yet rendered.** Recorded so that a later phase deciding to grey out or hide archived repos has the data already, rather than needing a backfill.

**Not decided here:** whether `lastPushedAt` is rendered on the public site, and whether an archived repo is hidden or merely marked. Both are presentation questions that want seeing on screen before being settled, and neither blocks the sync work.

### 2026-08-22 — Visual direction: generated artwork per project, self-hosted type, tokens flipped per scheme

**Context:** the site had no visual design. It had browser defaults plus accessibility repairs — every colour decision to date was driven by a contrast defect (#116) rather than by an aesthetic intent, and the measurable state was: no type scale (`h2` at 1.1× body; `17.6px` and `13.3333px` are unset UA values), headings inheriting body leading at 1.5, the tag chips rendering in Arial 13.3px against `system-ui` 16px, and `--color-border: #ccc` — a hairline at 1.6:1 on white and **11.7:1 on the near-black canvas**, used as a stroke in 15 places across 10 stylesheets. Recorded as #152. (This ADR and #152 both said 16 when written; the count was corrected in #159 — 16 is the 15 `var(--color-border)` usages plus the declaration itself.) Three directions were mocked with the real content and compared on both grounds; the owner chose the third.

**Decision:**

1. **Direction C, "Spectrum".** A card grid where **each project renders its own generated artwork** — a deterministic spectrum derived from that project's own title and tags, so it is stable across reloads and distinct per project. Display face `Archivo` at heavy weights and tight tracking, `IBM Plex Sans` for body, `IBM Plex Mono` for metadata and tags. Cool near-black ground, single warm accent.
2. **Generated art is a fallback, not the goal.** Where a project has a real image, the image wins. The generator exists because two of five projects have none and a third has architecture diagrams rather than screenshots — it removes the empty-card problem without shipping stock placeholders.
3. **Typefaces are self-hosted, not loaded from Google Fonts.** Three reasons, in order: the audience is substantially EU, and embedding the Google Fonts CDN sends visitor IPs to a third party — a decision that should not be made silently on a personal site; #122 will add a Content-Security-Policy, and a self-hosted face keeps `font-src` at `'self'` instead of allowlisting two more origins; and the deployment (Netlify static) serves the files at no cost or complexity.
4. **Every new colour is defined per scheme with its computed ratio recorded**, following the pattern `--color-text-muted` and `--color-error` already set — unless a single value is *demonstrated* to clear its bar on both grounds, with both ratios written down. Twelve of the fourteen tokens flip. `--color-surface-muted` is a translucent grey and resolves per ground by construction; `--color-on-danger` is a plain `#ffffff` that could flip and does not need to, because it measures 10.28:1 and 5.45:1 on the two danger fills. Neither is a token declared once and *inherited* without checking, which is how #116 and the border defect happened, twice — that remains forbidden. (Clause reworded 2026-08-27: it briefly read "every new colour **that can carry two values**", which is untrue of `--color-on-danger` and would have exempted the one token needing justification.)

**Alternatives considered:**

- *Direction A, "Instrument"* — a dense ledger with dates as a tabular column. Strong, and free: it needs no images at all. Lost because it commits the portfolio to carrying itself on typography alone.
- *Direction B, "Editorial"* — a printed contents page, warm neutrals, serif display. Also needs no images, and reads well against long descriptions. Lost to C on the same axis it won on: it accepts having no imagery rather than solving it.
- *Google Fonts CDN* — one line, browser-cached, zero build work. Rejected on the privacy and CSP grounds above.
- *`system-ui` with a proper scale and no webfonts* — the cheapest possible improvement, and genuinely most of the measurable win in #152. Rejected because a portfolio's typography is part of what it is demonstrating, and `system-ui` is the one choice that cannot be read as a choice.

**Consequences, and the first two are the ones that cost:**

- **Webfonts reintroduce font-swap reflow, which the E2E suite currently relies on not existing.** `projects.spec.ts` asserts a rendered line count to prove the CSS line clamp is laying out — the only check in the project that would fail if `-webkit-box-orient` were deleted again. Its stability argument rests explicitly on `system-ui` with no webfonts, so there is no swap to race. That assumption dies here. **The test must await `document.fonts.ready` before measuring**, and the faces should carry fallback metric overrides (`size-adjust`, `ascent-override`) so a swap moves as little as possible. Getting this wrong turns the project's most valuable layout test flaky, which teaches people to re-run rather than to look.
- **Two component stylesheets are already over the 2kB budget warning** — `admin-project-form` at 2967 bytes and `projects-list` at 2454, against a 4kB error ceiling — and the card work lands on the second. Either the card styling stays lean or the budget is revisited deliberately; silently raising a budget to fit is how the previous budgets stopped meaning anything (#51 replaced the stock ones for exactly that reason).
- **Font bytes count against the initial budget** (320kB warn / 400kB error). Subset to Latin, `woff2` only, preload only the face used above the fold.
- **`--color-border` is replaced rather than patched.** It is a light-mode value drawing every dark-mode box; a per-scheme hairline token supersedes it across all 15 usages.
- **The generator becomes real code with a real cost** — it must be deterministic, must not run for cards that have an image, and must degrade to a plain surface if canvas is unavailable rather than leaving a blank hole.

**Not decided here:** whether `lastPushedAt` or archived state surface visually, and the treatment of the admin area, which is not public and does not need the same investment. Both wait until the public pages are done and can be seen.

### 2026-08-27 — `dev` is the integration branch and GitHub's default; `main` is production only

**Context:** every PR to date has merged into `main`, which was simultaneously the integration branch and the thing a fresh clone gets. That was fine while nothing was deployed. It stops being fine the moment Phase 5 lands: with Netlify building the frontend and a VPS running the backend, **every merge to `main` becomes a release**, and there is nowhere for a batch of finished work to sit and be looked at before it ships to a public URL.

**Decision:**

1. **`dev` is the integration branch.** Feature and fix branches are cut from `My_Site/dev` and their PRs target `dev`. This replaces `main` everywhere in the existing workflow — worktree creation, `gh pr create`, and the "one task, one worktree, one branch, one session" rule are otherwise unchanged.
2. **`main` is production.** The only thing that merges into it is a `dev` → `main` promotion PR. Nothing is cut from `main`.
3. **`dev` is GitHub's *default* branch.** This is the half that is not obvious, and it is forced rather than chosen — see below.
4. **Netlify's production branch is `main`**, which is a separate setting from GitHub's default branch and is configured in Netlify's own UI. `dev` gets a branch deploy, which is what turns it into a real staging URL rather than just a ref.
5. **Promotion PRs carry no closing keywords.** Their issues closed already, when the feature PR merged into `dev`.

**Why `dev` has to be the default branch, and this is not a preference:**

GitHub auto-links a PR's issues in the Development sidebar, and auto-closes them on merge, **only when the PR's base is the repository's default branch.** This project has already paid for that once. `PROJECT_TODO.md`'s 2026-08-02 note records that the default branch was a stale `master` from repo creation onward while every real PR targeted `main` — so `Closes #N` on PRs #76, #77 and #79 silently did nothing, invisible unless someone specifically queried `closingIssuesReferences`. (#80 was the one caught in time — still open when the default was fixed, so it closed its ten issues on merge.)

Introducing `dev` while leaving `main` as the default would recreate that exact failure, on every feature PR, permanently. Making `dev` the default keeps `Closes #N` working unchanged and costs only that a fresh clone checks out `dev` — which is the correct branch to start from anyway.

**Alternatives considered:**

- *Keep `main` as the default and merge features into `dev`.* Rejected on the grounds above. The semantics are arguably nicer — an issue would close when its work reached production rather than when it was merged — but paying for that with a silent, invisible failure on every PR is not a trade this project can make twice.
- *No `dev` branch; keep merging to `main` and deploy from tags.* Rejected: it makes every merge a release-or-not decision taken at merge time, and tags do not give Netlify a staging deploy to look at. The recurring lesson here is that a test cannot see appearance; a staging URL is the cheapest way to actually look before shipping.
- *Full git-flow, with `release/*` and `hotfix/*` branches.* Rejected as disproportionate for a single-maintainer portfolio. Two long-lived branches is the smallest thing that separates "merged" from "live".

**Consequences:**

- **`gh pr create` now defaults to `dev`,** so feature PRs need no `--base`. A promotion PR needs `--base main` explicitly, and that is the one place the flag matters.
- **Phase 5's CI must deploy from `main`, not `dev`.** `PROJECT_TODO.md`'s two "deploy on merge to `main`" bullets were written before this split and happen to be correct — but they are now correct *deliberately*, and a workflow that deploys on merge to the default branch would silently publish every feature.
- **`.claude/hooks/block-protected-branch-ops.sh` now denies checking out `dev`** alongside `main`/`master`, since `dev` is the branch a session is most likely to reach for by reflex.
- **Both `PreToolUse` hooks were found to be dead while making this change**, and were rewritten. They parsed their input with `jq`, which is not installed on the machine this repo is worked on, so both fell through to `exit 0` and permitted everything they were written to deny — from `7bd9b86` (2026-08-07, partway through Phase 4) until now, while `README.md` and `docs/AGENT_WORKFLOW.md` described them as always active. That is CLAUDE.md's "fails closed, never open" rule broken inside the mechanism meant to enforce the branch rules. Both now parse with Python, deny when they cannot parse, and `check-worktree-scope.sh` additionally compares real paths rather than string prefixes.
- **`closingIssuesReferences` must still be checked before merging.** On a promotion PR the field is structurally always empty, because GitHub ignores keywords entirely on a non-default base — so that check is belt-and-braces against the default changing, not a live risk. The live risk it does not cover is a **commit message** keyword, which closes an issue on merge into the default branch without ever appearing in `closingIssuesReferences`; scan those separately.
- **A stale local `dev` is now the likeliest footgun**, the way a stale local `main` used to be. Fast-forward it explicitly rather than trusting the branch name.

### 2026-09-03 — Backend exposure: the provider's subdomain and proxy, not our own TLS

**Context:** Phase 5's plan assumed a VPS with its own IPv4 address and its own ports 80 and 443, on
which Caddy would obtain a Let's Encrypt certificate. The host actually provisioned is a **NAT'd LXC
container on shared infrastructure** (Mikrus), and that invalidates the plan rather than complicating
it. Measured on the host:

- Ports **80 and 443 belong to the provider**. They answer with a certificate for `CN=srv73.mikr.us`
  and redirect to the provider's own page. They cannot be bound, and neither HTTP-01 nor TLS-ALPN-01
  can validate through them.
- IPv4 is NAT'd behind `192.168.1.x`, with three forwarded ports: `10159` (SSH), `20159`, `30159`.
- The container has a **public, routable IPv6 address**, reachable directly from the internet on any
  port the firewall permits.
- The provider's HTTP proxy reaches the container **over that IPv6**, not over the private IPv4.

**Decision:** expose the backend through the provider's subdomain feature — `tarka1939.bieda.it`,
mapped to container port 8080 — and let the provider terminate TLS. No Caddy, no Let's Encrypt, no
certificate management of our own.

Two rules follow and are not optional:

1. **`ufw` permits 8080 only from the provider's proxy addresses**, not the internet. The observed
   nodes are `2a01:4f8:c012:8ba::/64` and `2a01:4f9:c012:f2aa::/64`. A blanket allow exposes the app
   in plaintext on the public IPv6, bypassing the provider's TLS entirely.
2. **#168 becomes part of the deployment**, not a follow-up. See consequences.

**Alternatives considered:**

- *Caddy on a forwarded port (20159) with a DNS-01 challenge.* The only self-managed option that can
  work, since DNS-01 needs no inbound port. Rejected on two counts: it puts a port number into every
  API URL forever, on a site whose purpose is to look competent; and DNS-01 requires a registrar API
  token — a new long-lived secret to store and rotate, for a certificate the provider already issues
  for free.
- *Cloudflare Tunnel.* Genuinely elegant here: an outbound connection means **no inbound ports at
  all**, which is exactly the shape of a NAT'd container, and it is the only option that is
  **provider-independent** — the tunnel follows the app to a different host unchanged. Rejected for
  now on cost of moving parts: it needs a domain purchase, a Cloudflare account, and a daemon to keep
  running, to replace a panel field. Revisit if this arrangement becomes limiting, and note the
  migration is cheap by design — the backend host appears in exactly three places:
  `frontend/src/environments/environment.ts`, the production `servers:` entry in
  `docs/openapi.yaml`, and the `<link rel="preconnect">` in `frontend/src/index.html`.
  **Corrected 2026-09-03:** this originally named the CORS allowlist as the third, which is wrong
  — that holds the *frontend* origin, not the backend host — and omitted `index.html`, one of the
  two that break the deployed site. A subdomain change the next day proved the undercount.
- *Binding the public IPv6 directly and serving TLS ourselves.* Works, and Let's Encrypt can validate
  over IPv6. Rejected because **IPv4-only visitors would not reach the API at all**, which a
  portfolio cannot accept.

**Consequences:**

- **Two proxies are now in the request path**, because the provider fronts its own domains with
  Cloudflare: `visitor → Cloudflare → provider nginx → container IPv6:8080`. Verified by the
  `Server: cloudflare` and `CF-RAY` headers on the live subdomain.
- **Cloudflare sees contact-form submissions.** This is a third-party processor handling personal
  data, and it is worth stating plainly because it was not chosen — it came with the host. It is also
  the answer to an argument made while deciding this, that the provider's subdomain avoided
  introducing a new third party: **it does not, and that argument was wrong.** The decision stands on
  its other merits. Anyone re-examining the 2026-08-22 fonts ADR's privacy reasoning should know that
  the API path already crosses Cloudflare regardless.
- **#168 is mandatory.** With any proxy in front, `request.getRemoteAddr()` returns one address for
  the entire internet and both rate limiters collapse into a single bucket: a stranger can lock the
  owner out of the admin panel for 15 minutes and silence the contact form for an hour. The `ufw`
  restriction above is also what makes the fix *safe* — a forwarded-for header is trustworthy only if
  nothing can reach the app except through the proxy.
- **Provider lock-in, deliberately accepted.** The subdomain, the proxy behaviour and the firewall
  rule are all Mikrus-shaped. The Cloudflare Tunnel alternative exists precisely for the day that
  matters.
- **A new failure mode to recognise:** if the subdomain starts returning 502, the first suspect is a
  provider proxy node outside the two `/64`s currently allowed, not the application.

### 2026-09-03 — Security posture: what this project defends against, and what it deliberately does not

**Context:** three sections of `docs/DEPLOYMENT.md` handled credentials three different ways — §4.3
prompted with psql's `\password`, §4.6 pasted the database password into a heredoc, §6 pasted the
admin password into an `UPDATE`. The owner caught the second and third separately, *after* the first
had already been established as the pattern. That is not three mistakes; it is one missing document.
Each section was reasoned about from instinct because there was nothing to reason from.

The same gap produced a worse error one layer up. An argument was made to never enable
`RESEND_API_KEY`, on the grounds that email password reset adds an attack surface to solve a problem
SSH already solves. That reasoning is sound and the conclusion was wrong, because the 2026-07-24 ADR
records the reset flow as *operational recovery* when its actual purpose is **capability
demonstration** for the portfolio. A rationale that lives only in the author's head cannot survive
contact with anyone else, including a future reader of this file.

Measured on the deployed host, because the numbers change the answer:

- `/var/log/auth.log` is **0 bytes** — sudo's command-line logging, cited repeatedly as a reason for
  the above measures, does not apply on this container at all.
- **One** login user exists. There is no low-privilege local attacker to defend against.
- `krzysztof.tarka1939@gmail.com` appears in **roughly four commits in five** of this public
  repository (measured 2026-09-03). Deliberately a proportion: an exact count drifts with every
  push, including the pushes that carry this entry, so restating it is the thing the rule about
  timestamped facts warns against. Changing `user.email` is the response, not recounting.
- Postgres listens on `127.0.0.1` only; `/etc/mysite/env` is `600 root:root`.

**Decision:**

**1. What this project defends against, in priority order:**

- **Accidental disclosure.** A secret in a commit, a paste, a screenshot, a backup, an AI
  conversation. This is the one that actually happens: it happened during the deployment itself,
  when the password went into a heredoc, and terminal output was pasted into a chat session a dozen
  times over the following hours.
- **Automated abuse.** Contact-form spam, and a bot sweeping the login endpoint from one address.
  The per-IP limiters are live and cap exactly that. They do **not** cap the case they get
  credited with. `ClientIpResolver`'s own javadoc records that an IPv6 visitor holds a `/64` or
  larger, so rotating the low bits gives unlimited buckets with no forgery at all — "login is
  rate-limited at 5 per 15 minutes" **has never been true for IPv6 clients**, on this design or
  the one before it. Note also that the limiters predate #168: that issue is a bug report about a
  proxy collapsing them into a single bucket, not the reason they exist.
- **Admin session takeover via XSS** (#123). The JWT is readable from JavaScript, so any injection
  is a full session. Its compensating control is a content security policy — **#122, still open**
  — and #123's own body says that keeping `sessionStorage` without #122 is "a trade-off with
  nothing on the other side of it". Treat the two as one item.

**2. What it explicitly does not defend against, and will not try to:**

**A live root compromise of the VPS.** Nothing on the host can. An attacker with root has the
environment file, the JVM's heap, the loopback socket to Postgres, and the ability to modify the
running code. Encryption at rest does not help, because the key must be present for the app to boot.

This is not resignation, it is scoping. It has a direct operative consequence: **a secret-handling
measure is judged by whether it reduces accidental disclosure, never by whether it would stop an
attacker who already has the box.** Measures that fail that test are hygiene at best and theatre at
worst, and should be argued as hygiene rather than dressed as security.

**2a. Not every secret here has the same blast radius, and the rule should not pretend otherwise.**

- `DB_PASSWORD` is useless to anyone who cannot reach `127.0.0.1:5432` — i.e. to anyone who does
  not already have the host, at which point they do not need it.
- **`JWT_SECRET` works from anywhere on the internet.** It is an HS256 *symmetric* signing key:
  a holder mints a valid admin token offline and presents it to the public API, never calling
  `/auth/login` and so never meeting the login limiter. Every write endpoint is then reachable.
  `docs/DEPLOYMENT.md` §8 already says to rotate it if it is ever pasted somewhere a password
  should not go, and that instruction only makes sense on this reading.
- **`RESEND_API_KEY` also works from anywhere.** A holder can send mail through the project's
  Resend account. Today that is `onboarding@resend.dev`, because no custom sender domain is
  verified; if one ever is, this becomes sending *as* the owner with valid SPF and DKIM.

So **two** of the three are remotely exploitable, and both are worth rotating on suspicion rather
than on schedule. Only `DB_PASSWORD` genuinely depends on host reachability, and it alone is
protected mainly against the operator. An earlier draft of this clause put `JWT_SECRET` in that
second group — which would have licensed treating a signing key as hygiene, in the one clause
future arguments get settled with.

**3. The operative rule, which replaces per-section instinct:**

A secret must not reach **shell history**, **process arguments** (`ps`), **any log file**, or **a
terminal whose scrollback gets pasted**. It may live in a `600 root:root` file on the host, because
that is the boundary the application itself requires.

Applied consistently, that yields `\password` in §4.3, `IFS= read -rsp` piped through stdin in §4.6
and §6, and `SET log_statement = 'none'` where a statement would otherwise carry a credential into
Postgres's own log. Those are now the same decision three times, rather than three decisions.

**4. Password reset is a showcase feature, not an admin tool.** This revises the 2026-07-24 ADR,
and that entry deserves more credit than an earlier draft of this clause gave it. It did not
merely record that "there was no way to recover a forgotten `AdminUser` password" — it *weighed
and rejected* the alternative this clause now adopts, "no password reset at all (manual
DB/migration recovery only)", on the grounds that being locked out with no recourse but a
migration cost more than building the flow. **What changed is the premise, not the reasoning:** in
Phase 0 there was no deployed host, no SSH, and no documented recovery procedure. All three now
exist, and §6 is the procedure. Its real purpose is to demonstrate a complete flow — single-use
tokens, a hash at rest, 30-minute expiry, enumeration-safe responses, per-IP limiting — as
portfolio evidence.

Three things follow:

- **The real admin account does not need it.** SSH plus the direct `UPDATE` in §6 is a strictly
  stronger recovery path: it requires host access rather than mailbox access.
- **The demo sandbox is where `RESEND_API_KEY` most belongs** — meaning a public demo instance
  with throwaway admin accounts, which **does not exist and has no issue yet**; it is named here
  as a destination, not as a plan of record — because there the flow is exercised
  by anyone evaluating the project, against throwaway accounts, with no bearing on the real admin.
  Setting it for the real admin *before* that exists is a reasonable choice and not forbidden by
  this ADR — it is what makes an untested integration tested — provided clause 5's unpublished
  recovery address is used. The cost is that the owner's mailbox becomes a recovery path for the
  live admin account; the benefit is a showcase feature that has actually run. Either way the
  unset state is a designed no-op rather than an unfinished one.
- **A showcase feature is not finished until it has run where it is shown.** The token logic is
  tested, and the Resend integration *has* fired: `PROJECT_TODO.md` records delivery verified
  end to end on 2026-08-01, a real email received via `onboarding@resend.dev`, with the reset
  link pointing at `localhost:4200` because no frontend was deployed yet. An earlier draft of
  this clause said it had never executed, which two documents in this repository contradict.
  What remains true is narrower and still worth acting on: it has never run in a deployed
  environment, so the half that a visitor could exercise is the untested half.

**5. The admin recovery address is a distinct address that has never been published.** Not a secret
— it cannot be, when an author email sits in most of this repository's public commits — but a real
layer nonetheless,
because `POST /auth/password-reset-request` returns 202 whether or not an address is registered
(`ifPresent` with no `else`). An attacker attacks the weaker of bcrypt and the mailbox; knowing
*which* mailbox is most of that work, and an unpublished address withholds it.

**Alternatives considered:**

- *Treating the recovery email as a secret.* Rejected: it cannot be one if it is also the git author
  address. The answer is to make it a different address, not to guard the wrong one.
- *`systemd-creds` with TPM binding for `/etc/mysite/env`.* Genuinely stronger than `600 root:root`
  — but against an **offline** disk, a stolen snapshot or a copied backup, not against live root.
  Disproportionate for a single-operator container today; recorded as the upgrade path if the
  backup story ever changes.
- *Postgres `peer` authentication over the unix socket, eliminating the database password entirely.*
  The only option here that removes a class rather than protecting an instance. Rejected for now
  because JDBC needs `junixsocket` — a real dependency change, not a configuration one.
- *Rewriting git history to remove the author email.* Rejected: the cost is the entire history of
  a repository whose value is its documented record, to redact an address already scraped.
  Setting `git config user.email` to GitHub's noreply stops it growing and is the recommended
  action; at the time of writing it is still the real address, so this is a recommendation
  rather than a record.

**Consequences:**

- **Some of what this project does about secrets is hygiene, and should say so.** The §4.6 rewrite
  does not protect against an attacker with the box; it protects against the operator pasting
  scrollback. That is a real and common failure mode, and a weaker claim than "security".
- **`#123` rises in priority relative to secret handling**, and carries **#122** with it. It is the
  shortest attack path into the data that does not require the host, and its compensating control
  is the CSP that #122 has not delivered. Both are open.
- **The deployment runbook's three credential sections now agree**, and a fourth will inherit the
  rule rather than re-derive it.
- **§6 of the runbook needs two edits to match clause 5 and clause 3**, and they are made in the
  same change as this entry: it told the operator to set "your real address", which clause 5
  forbids; and the verify step both passed the new password to `curl` on a command line, which
  clause 3's first two prohibitions forbid, and printed the bearer token that came back into a
  pasteable scrollback, which its fourth does. An ADR that claims the runbook agrees with it
  should not leave the disagreements in place.
- **Three things are deliberately outside the scope above, and saying so is the point of the
  document.** *Cloudflare fronts every API request and terminates the visitor-facing TLS*: the
  sibling exposure ADR above records the `visitor → Cloudflare → provider nginx → container`
  path and that Cloudflare therefore sees contact-form submissions. A third-party processor of
  personal data that was not chosen but came with the host; accepted, not defended against. *There
  are no
  backups* (§9), which means the `systemd-creds` alternative above currently protects an artifact
  that does not exist. *`GITHUB_WEBHOOK_SECRET`* is inert while sync is flagged off, so §2a's
  three-secret list is a list of the live ones rather than an exhaustive inventory.
- **This ADR is the thing to cite when a future change looks like security.** If it does not reduce
  accidental disclosure, limit blast radius, or close an abuse path, it is decoration, and saying so
  is cheaper than implementing it.

### 2026-09-03 — Contact-form notification, and what it does to `RESEND_API_KEY`

**Context:** `ContactService.submit` persisted a `ContactMessage` and notified nobody (issue #186).
The visitor was told *"I'll get back to you soon"*, and the only thing making that true was the
owner remembering to open `/admin/messages`. This was never scoped — `SPEC.md` promises "Contact
form, with basic rate limiting" and the visitor-side user story is satisfied — so it is a hole
nobody wrote down rather than a regression.

**Decision:** `ContactService.submit` publishes a `ContactMessageReceivedEvent`; a
`ContactNotificationListener` in the same module emails the owner via `ResendEmailClient`. The
destination is a new environment variable, `CONTACT_NOTIFICATION_EMAIL`.

Three things about the listener are load-bearing rather than stylistic:

- **`@TransactionalEventListener(phase = AFTER_COMMIT)`**, so the row is durable before anything is
  sent and a send failure has no transaction left to roll back.
- **`@Async("taskExecutor")`**, the executor `AsyncConfig` has provisioned since Phase 1, so a slow
  or hanging Resend call cannot hold the visitor's response open.
- **The listener catches its own `RuntimeException`s and logs them.** Notification is best-effort;
  persistence is not. A contact message is the product, and losing one because a third party had a
  bad minute is the worst outcome available here.

`AGENT_LOG.md` (2026-08-01) records this exact shape shipping once already, in
`PasswordResetService.requestReset`: an uncaught Resend call inside a `@Transactional` method, where
a non-2xx propagated out and changed the HTTP response.

**Alternatives considered:**

- *Send inline in `submit`.* Rejected outright — it is the bug above, with the visitor's message at
  stake instead of an enumeration side channel.
- *Carry only the message id in the event and re-read the row in the listener.* Rejected: the admin
  can delete a message between commit and listener, and the notification would silently vanish for
  the one message the owner most needs to see. The event carries the submitted values instead.
- *Leave `ResendEmailClient` in `auth/`.* Rejected. See consequences.

**Consequences:**

- **`RESEND_API_KEY` is no longer demo-only.** Password reset is a showcase feature the real admin
  does not need, which is why `docs/DEPLOYMENT.md` treats the key as optional and sandbox-shaped.
  Contact notification is an operational need for the live site, so the key is now load-bearing.
  It stays *optional* — unset still degrades to warn-and-skip, and the message is still saved and
  still answered with 201 — but "unset" now means the owner is not told about real enquiries, not
  merely that a demo is unavailable.
- **`ResendEmailClient` moved from `auth/` to the application's base package.** It now has callers
  in two modules. Leaving it in `auth` would have made `contact` depend on the auth module purely to
  send mail — a dependency `ApplicationModules.verify()` *permits* (it is a base-package type of
  that module, hence part of its API), which is exactly why the boundary had to be fixed by design
  rather than left for the test to catch. Email delivery is shared infrastructure, and the base
  package is already where this project keeps that: `ClientIpHasher` and `InMemoryRateLimiter` are
  there for the same reason. No new Spring Modulith module was introduced.
- **The notification email contains visitor-submitted content**, which is escaped where it is
  interpolated: HTML-escaped in the body, and all control characters stripped from the subject,
  since the subject is the one value that becomes a MIME header and a smuggled CRLF is the classic
  header-injection primitive.
- **Nothing about the visitor is logged, at any level** — not the name, email or message body. The
  message's UUID is logged instead, which points at a row the admin panel can already show.
- **A dangling cross-reference was found, not fixed.** `docs/DEPLOYMENT.md` says "See
  `docs/DECISIONS.md`, 2026-09-03, for why the reset flow exists at all — it is a showcase feature
  rather than an admin tool". No such text exists in this file; the only other 2026-09-03 entry is
  the backend-exposure ADR above, which is about TLS. The reasoning it cites is real and is stated
  in `DEPLOYMENT.md` itself, but the ADR it points at was never written. Flagged rather than
  invented, since guessing at what an absent decision said is worse than an obviously broken link.

### [YYYY-MM-DD] — [Decision title]

**Context:**

**Decision:**

**Alternatives considered:**

**Consequences:**
