# SPEC — My Site

Source of truth for scope. Update this **before** changing code, not after.

## Purpose

Personal portfolio site (Angular + Spring Boot) that hosts your project portfolio, doubling as a deliberate practice ground for multi-agent development workflows (spec-first, parallel agents, documented review). Built solo, agentic-tool-assisted, budget-conscious (free/cheap hosting tiers), no real scale requirements — a portfolio, not a product. Full priority-ordered goals and constraints: `PROJECT_TODO.md` §Goals/Constraints.

## In scope

- [x] Portfolio: browse projects, view project detail (title, description, tags, links, images, dates), with pagination/filtering built in from the start
- [x] Tag/category system (many-to-many with Project)
- [x] Contact form, with basic rate limiting
- [x] Admin content management (login-gated) — JWT admin auth confirmed in scope, see Auth scope decision below
- [x] Four sequenced backend extension features (Phase 7, one shipped before the next starts):
  - 7a. GitHub webhook auto-sync (repo metadata → `Project` records)
  - 7b. Rendered agent build-log page (reads `AGENT_LOG.md` or a DB-backed equivalent)
  - 7c. Custom analytics (privacy-respecting: no fingerprinting, no third-party trackers, hashed/no-store IPs)
  - 7d. Live DSP/audio demo (async, polling or WebSocket response — last in sequence, highest hosting risk)

## Explicit non-goals

- No multi-user support
- No real-time features, beyond what 7d specifically needs (polling/WebSocket for async job results)
- No NgRx — Angular signals are sufficient at this scale
- No microservices — a single Spring Boot monolith is correct here
- No Kubernetes — Docker Compose locally / a PaaS free tier is enough
- No hand-rolled auth/crypto — use Spring Security's established JWT support if auth is in scope at all
- No fingerprinting or third-party trackers in analytics (Phase 7c)
- Not built for real scale — free/cheap tiers, solo maintenance
- No blog/writeups — confirmed out of scope 2026-07-21 (was floating in the data-model draft as `BlogPost`/`Writeup`; cut to keep scope to portfolio + contact form + Phase 7 extensions)

## User stories

Draft, based on the feature list above — **review and edit these**, they're inferred, not dictated by you:

1. As a visitor, I want to browse and filter projects by tag, so I can find relevant work quickly.
2. As a visitor, I want to view a project's detail page, so I can evaluate it in depth.
3. As a visitor, I want to send a message via a contact form, so I can reach out directly.
4. As the site owner, I want new GitHub repos/releases to sync into my project list automatically, so I don't re-enter metadata I already maintain on GitHub.
5. As a visitor, I want to see a rendered log of what agents got wrong during development, so I can evaluate the multi-agent workflow directly, not just take your word for it.
6. As the site owner, I want basic privacy-respecting analytics per project, so I can see engagement without third-party trackers.
7. As a visitor, I want to try a live DSP/audio demo, so I can interact with your signal-processing work directly.

## Auth scope decision

**Decision (confirmed 2026-07-21):** Include JWT-based admin login. Write endpoints (Project CRUD, Tag management, and any admin-facing views) are gated behind it via Spring Security's established JWT support — no hand-rolled token signing/verification.

**Reasoning:** Kept for interview/learning value and as a multi-agent-orchestration test case — auth logic is exactly where agents get subtly wrong, so it's a deliberate practice target. This does add real scope/risk versus the "edit a config file and redeploy" alternative `PROJECT_TODO.md` floated; if Phase 2 timelines slip, this is the first thing to reconsider cutting.

## Entities (high level)

See `docs/DATA_MODEL.md` for the full data model. Core:

- `Project`
- `Tag`
- `ContactMessage`
- `AdminUser`

Phase 7 extensions add entities of their own (analytics events, GitHub sync records, agent log entries, DSP job records) — see `docs/DATA_MODEL.md`, marked there as inferred and not yet confirmed against actual implementation needs.

## API contract

The full OpenAPI 3.0 spec lives at `docs/openapi.yaml` (write this before backend/frontend code — not written yet). Link it here once created:

- `docs/openapi.yaml`

## Open questions

- Which VPS provider — decided to self-host (see `docs/DECISIONS.md`) but the specific provider isn't picked; pick before Phase 5 (affects secrets/config structure in earlier phases)

Resolved from the repo's own git remote (`git@github.com:tarka1939/My_Site.git`): frontend is a GitHub *project* page at `https://tarka1939.github.io/My_Site/` — so `--base-href` is `/My_Site/` and the CORS allowlist origin is `https://tarka1939.github.io`.
