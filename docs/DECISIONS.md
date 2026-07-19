# Decisions

Log of locked-in decisions and the reasoning behind them. Pre-seeded with the defaults proposed in `PROJECT_TODO_1.md` — review each, confirm or override, and record the final call. Add new entries below as they come up.

## How to use this file

Each row is a decision. `Status` is one of: `proposed`, `confirmed`, `overridden`. If overridden, add a line explaining why under the table.

## Foundational decisions (from PROJECT_TODO_1.md)

| Decision | Default | Status | Notes |
|---|---|---|---|
| Repo structure | Monorepo (`/backend`, `/frontend`, `/docs`) | proposed | |
| Database | PostgreSQL | proposed | |
| ORM | Spring Data JPA + Hibernate | proposed | |
| Schema migrations | Flyway | proposed | |
| API contract | OpenAPI 3.0, written before implementation | proposed | |
| Auth | JWT-based admin login (optional) | proposed | see SPEC.md → Auth scope decision |
| Angular architecture | Standalone components, signals | proposed | |
| Deployment platform | Render / Railway / Fly.io / VPS — undecided | proposed | pick before Phase 5 |
| CI/CD | GitHub Actions from day 1 | proposed | |

## Additional decisions

_Add new ADR-style entries below as they arise._

### [YYYY-MM-DD] — [Decision title]

**Context:**

**Decision:**

**Alternatives considered:**

**Consequences:**
