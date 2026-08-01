# /backend

Spring Boot 4.1.0 app (Maven, JDK 25). Phase 1 (backend foundation) is scaffolded — see
`PROJECT_TODO.md` for the phase plan and root `CLAUDE.md` → Commands for build/run/test.

## Status

Phase 1 scope only. `project/` and `contact/` are the initial package-by-feature modules,
enforced by Spring Modulith (`ModularityTests` runs `ApplicationModules.verify()`). The
`project/` package has a deliberately minimal **create-only** vertical slice
(`POST /api/v1/projects`) to demonstrate the controller → service → repository → DTO
layering and the `ProjectCreatedEvent` publish/listen example — full CRUD (list/pagination/
filtering, update, delete) is Phase 2, not built here. `contact/` has only the entity +
repository for the same reason.

Verified end-to-end: `mvn test` runs unit tests, Spring Modulith verification, and a
Testcontainers integration test against real Postgres (Flyway migration included). The app
has also been booted manually against a real Postgres instance and exercised via
`POST /api/v1/projects` and `/actuator/health`.

See `CLAUDE.md` (repo root) for the locked-in architecture conventions and `AGENT_LOG.md`
for the judgment calls made while scaffolding this.
