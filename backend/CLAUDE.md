# backend/CLAUDE.md

The backend's commands, and the local database it runs against. They moved here from the root
`CLAUDE.md` (#188), which every agent is given in full, so that work outside `/backend` stops paying
for them. This file adds to the root one, which still holds every rule, and it arrives with the
first file read under `backend/`.

## Commands

### Backend (`/backend`)

Requires JDK 25 and Maven on `PATH` (or `JAVA_HOME`/`MAVEN_HOME` set). Requires a running
PostgreSQL instance for anything beyond `compile`/`test`. **`docker compose up -d` provides one**
(#42) with the values the dev profile already defaults to, so no `DB_*` variables are needed —
see "Local database (Docker Compose)" below.

```bash
# Build (compile only, no DB needed):
cd backend && mvn compile

# Run locally (dev profile, needs Postgres reachable — see above):
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev

# Run all tests (unit tests + Spring Modulith ApplicationModules.verify() — no DB needed;
# Testcontainers integration tests additionally need a running Docker daemon):
cd backend && mvn test

# Run a single test:
cd backend && mvn test -Dtest=ProjectServiceTest

# Lint: none for the backend, by decision (docs/DECISIONS.md, 2026-10-01) — nothing to run.

# Package an executable jar:
cd backend && mvn clean package
```

### Local database (Docker Compose)

Postgres only, not the backend. Production runs a plain jar under systemd on purpose
(`docs/DECISIONS.md`, 2026-09-04) and the Dockerfile is deferred, so there is no image to run the
app from — and building one solely for local use would be the one place nobody deploys from.

The image is **`postgres:16-alpine`, matching production**, not the `17-alpine` the Testcontainers
suite uses. Local development should reproduce what ships. That does mean tests run against a
different major version than production, which is a real if narrow risk: a migration valid on 17
and not on 16 would pass CI and fail the deploy.

```bash
docker compose up -d --wait      # --wait returns when Postgres can answer, not when it starts
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev

docker compose down              # stop, keeping the data
docker compose down -v           # and discard it, which is how you re-run Flyway from empty
```
