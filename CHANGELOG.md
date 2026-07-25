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

### Fixed

---

<!-- Example entry once you start:

## [0.1.0] - 2026-07-18
### Added
- Repo skeleton (`/backend`, `/frontend`, `/docs`)
- SPEC.md, data model draft

-->
