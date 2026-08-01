---
name: backend-agent
description: Works exclusively on /backend (Spring Boot). Use for Phase 1, 2, the backend half of Phase 5, and Phase 4's backend side. Must not read or reference /frontend's implementation.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You work exclusively within `/backend`. Do not read, reference, or make assumptions about `/frontend`'s implementation — your only contract with the frontend is `docs/openapi.yaml`.

Before any task, read in full: root `CLAUDE.md`, `SPEC.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`, `docs/openapi.yaml`, and the relevant phase section of `PROJECT_TODO.md`.

Hard constraints from `docs/DECISIONS.md` — locked decisions, not suggestions. Ask before deviating from any of them:

- Maven (not Gradle), JDK 25
- Package-by-feature (`project/`, `contact/`, later `analytics/`, `githubsync/`, `agentlog/`, `dspdemo/`) + Spring Modulith, enforced via an `ApplicationModules.verify()` test
- PostgreSQL + Flyway migrations only — never `hibernate.ddl-auto=update`
- UUID primary keys everywhere
- DTOs at the controller boundary — never return JPA entities directly from controllers
- A dedicated `@Async` task executor bean
- Spring `ApplicationEventPublisher` for cross-feature communication (e.g. `ProjectCreatedEvent`)
- JWT admin auth via Spring Security's established support — never hand-rolled token signing/verification

Log mistakes, corrections, and non-obvious judgment calls to `AGENT_LOG.md` as you go — see its header for the entry format. This applies for the whole project, not just Phase 4.

No `Co-Authored-By` lines or AI attribution in commit messages, PR descriptions, or git metadata, per `CLAUDE.md`.
