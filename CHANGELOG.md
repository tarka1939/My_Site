# Changelog

All notable changes to this project are documented here, in reverse chronological order.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Filled in `SPEC.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `README.md`, `CLAUDE.md` from the revised `PROJECT_TODO.md` (2026-07-21)
- Draft Phase 7 extension entities in `docs/DATA_MODEL.md`: `GithubSyncRecord`, `AgentLogEntry`, `AnalyticsEvent`, `DspJob` (inferred, not yet confirmed)

### Changed

- Project plan (`PROJECT_TODO.md`) revised: split frontend/backend hosting (GitHub Pages + Render/Railway/Fly.io), CORS + SPA-fallback requirements, package-by-feature backend structure, `ApplicationEventPublisher` + `@Async` executor + feature flags, GitHub Projects task tracking, and a new sequenced Phase 7 (GitHub webhook sync → agent build-log page → analytics → live DSP demo)
- Project name confirmed as "My Site" across `README.md`, `SPEC.md`, `CLAUDE.md`
- Auth scope confirmed: JWT admin login is in scope (`SPEC.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`)
- Backend hosting overridden from the TODO's Render/Railway/Fly.io default to a self-managed VPS (provider TBD) — see `docs/DECISIONS.md`
- Blog/writeups cut from scope; `BlogPost`/`Writeup` removed from `SPEC.md` in-scope list and struck through in `docs/DATA_MODEL.md`
- License set to "All rights reserved"; no custom domain planned for GitHub Pages
- Baseline dev toolchain set to JDK 25 + Node 24 (corrected from an initially floated JDK 21/Node 20 pair, which was stale as of mid-2026) — see `docs/DECISIONS.md`
- Data model finalized with concrete field types: UUID primary keys throughout, `Project.images` as a `text[]` of external URLs, `Project.links` as a `jsonb` array of `{label, url}` objects, `project_tags` join table, hashed-IP rate limiting on `ContactMessage` — see `docs/DATA_MODEL.md` and `docs/DECISIONS.md` (2026-07-24)
- ER diagram in `docs/DATA_MODEL.md` expanded to cover all core entities (`Project`, `Tag`, `ContactMessage`, `AdminUser`) plus a separate speculative diagram for Phase 7 draft entities
- Wrote `docs/openapi.yaml`: full OpenAPI 3.0 contract for Phase 1–3 core endpoints (Projects, Tags, Contact, Auth), validated with `openapi-spec-validator`. Phase 7 endpoints deliberately excluded until each sub-phase starts. Conventions (`/api/v1` versioning, custom `PageMeta` pagination wrapper, RFC 7807 error format, OR-semantics tag filtering, login-only auth with no refresh/registration endpoints) recorded in `docs/DECISIONS.md` (2026-07-24)
- Softened "no multi-user support" from a hard non-goal to a flagged possible future extension in `SPEC.md`, per review comment (2026-07-24) — not designed or scoped yet; `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, and `docs/openapi.yaml` still assume single-admin
- Pre-Phase-1 review pass (2026-07-24): walked through all 14 foundational decisions in `docs/DECISIONS.md` individually. Confirmed: Database (PostgreSQL), ORM (JPA+Hibernate), Schema migrations (Flyway), API contract (OpenAPI-first), CI/CD (GitHub Actions, split workflows), Task tracking (GitHub Projects board), Cross-feature communication (`ApplicationEventPublisher`), Async/background jobs (`@Async` executor), Feature rollout (feature flags). Still pending, with tradeoffs discussed but not decided: Angular architecture (NgRx vs. signals), Frontend hosting (GitHub Pages vs. Netlify/Vercel), SPA routing (404.html vs. hash routing), Backend module structure (package-by-feature vs. layered vs. Spring Modulith), and Cross-origin/CORS setup (explicitly deferred, depends on the frontend hosting decision)
- Added a password reset flow to scope (2026-07-24, not in the original `PROJECT_TODO.md`): new `PasswordResetToken` entity in `docs/DATA_MODEL.md`, `POST /auth/password-reset-request` and `POST /auth/password-reset` in `docs/openapi.yaml`, JWT session expiry set to 1 hour, reset emails via a transactional email API (Resend) rather than self-hosted SMTP — see `docs/DECISIONS.md` and the new `PROJECT_TODO.md` Phase 2 checklist item
- Resolved all 5 remaining pending foundational decisions (2026-07-25), all 14 now confirmed:
  - Angular architecture: standalone components + signals confirmed, no NgRx
  - **Frontend hosting switched from GitHub Pages to Netlify** (verified current 2026 ToS: Vercel Hobby is non-commercial-only, Netlify has no such restriction) — real rework: `--base-href` simplifies to the Angular default `/` (no more `/My_Site/` subpath), the `404.html` copy trick is replaced by a one-line `frontend/public/_redirects` file, and the CORS allowlist origin changes from `https://tarka1939.github.io` to a `*.netlify.app` subdomain (exact value TBD until the Netlify site is created in Phase 5)
  - Backend module structure: package-by-feature confirmed, **adding Spring Modulith** for enforced module boundaries (verified current: 2.0 GA'd November 2025, 1.4 GA'd March 2026)
  - SPA routing: superseded by the Netlify decision — native `_redirects` handling, no fallback trick needed
  - CORS: confirmed in principle, exact origin deferred to Phase 5 alongside the Netlify site creation
  - See `docs/DECISIONS.md` for full ADRs. Updated for consistency: `SPEC.md` (removed the now-wrong GitHub Pages URL/base-href note), `README.md`, `CLAUDE.md`, `PROJECT_TODO.md` (Phase 3/5 bullets), and GitHub issues #31, #32, #38, #39, #40
- Final Phase 0 verification pass (2026-07-25): fixed 6 more stale GitHub Pages references missed in the earlier round (`docs/openapi.yaml` contact URL, `.github/workflows/README.md`, `frontend/README.md`, issues #42/#44/#47), checked off the 6 completed Phase 0 checklist boxes in `PROJECT_TODO.md`, and confirmed/closed issue #7 after the project board's Status field was manually updated to Todo/In Progress/In Review/Done/Canceled
- GitHub Project organization (2026-07-25): added one milestone per phase (Phase 0–7, Ongoing/meta — not yet created, blocked on a manual GitHub-side step since no tool can create milestones) and six parent/sub-issue "epics" for Phase 7a/7b/7c/7d and Phase 5's Frontend/Backend split (issues #70–#75, 24 sub-issues linked) — see `docs/DECISIONS.md` and the new `PROJECT_TODO.md` section
- Build tool confirmed as Maven (2026-07-29) — never explicitly decided in any prior doc; single-module backend gets no benefit from Gradle's build-speed/multi-module advantages, and Maven's fixed lifecycle is the safer bet for an agent-authored build file. Updated `docs/DECISIONS.md` (new row + ADR), `PROJECT_TODO.md` (decision table + Phase 1 checklist), `backend/README.md`
- Added `docs/AGENT_WORKFLOW.md` and `.claude/agents/backend-agent.md` / `.claude/agents/frontend-agent.md` (2026-08-01) — formalizes SPEC.md's multi-agent-workflow goal as an actual process: when to run agents sequentially (default) vs. via a Task-tool dispatcher (limited use, no filesystem isolation) vs. separate `git worktree`s (required for Phase 4's backend-agent/frontend-agent contract-isolation test). Explicitly flags that Phase 7's four extensions must stay sequential even though dispatcher tooling would make parallel fan-out easy — `PROJECT_TODO.md` already rejected that for quality reasons, not just effort. `CLAUDE.md`'s "Where to look first" updated to reference the new doc

### Fixed

---

<!-- Example entry once you start:

## [0.1.0] - 2026-07-18
### Added
- Repo skeleton (`/backend`, `/frontend`, `/docs`)
- SPEC.md, data model draft

-->
