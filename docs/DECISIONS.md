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

**Consequences:** parent/sub-issues are live as of 2026-07-25 (all 6 epics created, 24 sub-issues linked, all added to project #1). Milestones are blocked on a manual step — the connected GitHub tooling can assign an issue to an existing milestone but has no way to create one — so the 8 milestones need to be created on GitHub's site before all 69 issues can be assigned in one pass.

### [YYYY-MM-DD] — [Decision title]

**Context:**

**Decision:**

**Alternatives considered:**

**Consequences:**
