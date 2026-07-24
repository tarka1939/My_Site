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

### Fixed

---

<!-- Example entry once you start:

## [0.1.0] - 2026-07-18
### Added
- Repo skeleton (`/backend`, `/frontend`, `/docs`)
- SPEC.md, data model draft

-->
