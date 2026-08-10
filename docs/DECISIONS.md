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

### [YYYY-MM-DD] — [Decision title]

**Context:**

**Decision:**

**Alternatives considered:**

**Consequences:**
