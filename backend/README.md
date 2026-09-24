# /backend

Spring Boot 4.1.0 app (Maven, JDK 25). See `PROJECT_TODO.md` for the phase plan and root
`CLAUDE.md` → Commands for build/run/test.

## Status

Package-by-feature under `io.github.tarka1939.mysite`, with boundaries enforced by Spring Modulith
(`ModularityTests` runs `ApplicationModules.verify()`):

| Package | Endpoints (`/api/v1/...`) |
|---|---|
| `project/` | `projects` (public list/detail; admin create/update/delete), `admin/projects` (drafts included), `tags` |
| `contact/` | `contact` (public, rate-limited), `contact-messages` (admin) |
| `auth/` | `auth/login`, `auth/password-reset-request`, `auth/password-reset/validate`, `auth/password-reset` |
| `about/` | `about` (public GET, admin PUT) |
| `githubsync/` | `webhooks/github` — Phase 7a, off unless `GITHUB_SYNC_ENABLED=true` |

Cross-cutting pieces (security config, the exception handler, the shared rate limiter, client-IP
resolution behind proxies, the async executor, the Resend client) live in the root package.
Schema is Flyway-only, `src/main/resources/db/migration`.

`mvn test` runs unit tests, Spring Modulith verification, and Testcontainers integration tests
against real Postgres — those need a running Docker daemon, and fail rather than skip without one.

See `CLAUDE.md` (repo root) for the locked-in architecture conventions and `AGENT_LOG.md`
for the judgment calls made while building it.
