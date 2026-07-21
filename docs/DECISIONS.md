# Decisions

Log of locked-in decisions and the reasoning behind them. Pre-seeded with the defaults proposed in `PROJECT_TODO.md` — review each, confirm or override, and record the final call. Add new entries below as they come up.

## How to use this file

Each row is a decision. `Status` is one of: `proposed`, `confirmed`, `overridden`. If overridden, add a line explaining why under the table. `PROJECT_TODO.md` itself frames all of these as "reviewable assumptions, not settled facts" — leave `Status` at `proposed` until you've actually made the call, don't mark `confirmed` by default.

## Foundational decisions (from PROJECT_TODO.md)

| Decision | Default | Status | Notes |
|---|---|---|---|
| Repo structure | Monorepo (`/backend`, `/frontend`, `/docs`) | proposed | |
| Database | PostgreSQL | proposed | |
| ORM | Spring Data JPA + Hibernate | proposed | |
| Schema migrations | Flyway | proposed | never `hibernate.ddl-auto=update` outside local scratch experiments |
| API contract | OpenAPI 3.0, written before implementation | proposed | shared contract for independent backend-agent/frontend-agent sessions (Phase 4) |
| Auth | JWT-based admin login | **confirmed** (2026-07-21) | see SPEC.md → Auth scope decision |
| Angular architecture | Standalone components, signals for state | proposed | no NgRx |
| Frontend hosting | GitHub Pages (static Angular build) | proposed | **hard constraint, not a setting:** static-only, no server-side execution — cannot run Spring Boot |
| Backend hosting | Render, Railway, or Fly.io free tier | **overridden** (2026-07-21) | replaced by a self-managed VPS — see note below table; specific provider still TBD, pick before Phase 5 |
| Cross-origin setup | CORS on Spring Boot, allowlisting the GitHub Pages origin (`https://username.github.io`) | proposed | frontend/backend now live on different domains — every API call fails without this |
| SPA routing on Pages | `404.html` fallback (copy of built `index.html`) | proposed | Pages has no server-side URL rewriting; without this, Angular route refresh/deep-links 404 |
| CI/CD | GitHub Actions — separate workflows for Pages deploy (frontend) and container build/deploy (backend) | proposed | two distinct deploy targets, not one pipeline |
| Task tracking | GitHub Projects board (Backlog → Ready → In Progress → In Review → Done), linked to Issues | proposed | tag issues by phase/component and by agent-assigned vs. self-reviewed |
| Backend module structure | Package-by-feature: `project/`, `contact/`, `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/` | proposed | replaces a single global controller/service/repository split |
| Cross-feature communication | Spring `ApplicationEventPublisher` for internal events (e.g. `ProjectCreatedEvent`) | proposed | lets Phase 7 extensions react to core CMS actions without direct coupling |
| Async/background jobs | Dedicated `@Async` task executor, provisioned in Phase 1 before anything uses it | proposed | needed by the DSP demo (7d); built early so it's not retrofitted under time pressure |
| Feature rollout | Config-based feature flags per extension | proposed | ship the core CMS live while Phase 7 extensions are still half-built |

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

### [YYYY-MM-DD] — [Decision title]

**Context:**

**Decision:**

**Alternatives considered:**

**Consequences:**
