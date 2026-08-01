# Agent Log

Running log of agent sessions on this project — what was run, what each agent got wrong, and how it was caught/fixed. This is the actual differentiation artifact for Phase 4 (more valuable than the app itself), so keep entries specific and dated.

Convert relative dates to absolute (YYYY-MM-DD) when logging.

---

## Log format

Copy this block per entry:

```
## [YYYY-MM-DD] — [Session label, e.g. "backend-agent: Project CRUD"]

**Task given:**

**Agent(s) used:**

**What went right:**

**What went wrong (be specific):**

**How it was caught:** (test failure, manual review, integration mismatch, etc.)

**Fix applied:**

**Takeaway for next time:**
```

---

## Entries

<!-- Add entries below, most recent first -->

## 2026-08-01 — claude (main session): Phase 1 backend foundation

**Task given:**

Scaffold Phase 1 (backend foundation) per `PROJECT_TODO.md`, following the locked decisions in `docs/DECISIONS.md`. Explicitly out of scope: Phase 2 (domain CRUD), `/frontend`.

**Agent(s) used:**

Main Claude Code session (no subagent dispatch — `docs/AGENT_WORKFLOW.md` calls for sequential single-agent work on Phase 1, not a dispatcher).

**What went right:**

- Caught the local-environment gap (no JDK 25, no Maven, Docker not running) before writing any code, rather than discovering it mid-build.
- Verified the Spring Boot / Spring Modulith version pairing against live sources (Maven Central `maven-metadata.xml`, not a stale `search.maven.org` index which incorrectly suggested no 2.x Modulith existed) before committing to a version in `pom.xml`.

**What went wrong (be specific):**

N/A yet — this entry is being written as scaffolding work is still in progress.

**How it was caught:**

N/A

**Fix applied:**

N/A

**Takeaway for next time / non-obvious judgment calls made:**

1. **Spring Boot 4.1.0, not 3.x.** No Spring Boot version was locked in any doc. `start.spring.io` no longer offers a 3.x option at all — 4.1.0 is the only current default. Paired with Spring Modulith **2.1.0** (confirmed via `repo1.maven.org/.../spring-modulith-bom/maven-metadata.xml`, since `search.maven.org`'s search index was stale and undercounted — it showed 1.4.1 as latest when 2.1.0 is actually current). Flag if `docs/DECISIONS.md` should get an explicit ADR for this.
2. **JDK 25 + Maven were not installed locally** (only JRE 8 present, no Maven at all). Asked for and got explicit confirmation before installing either, since downloading files/modifying system PATH are permission-gated actions. Maven 3.9.16 came from a manual download of `dlcdn.apache.org`'s binary zip (winget has no Maven package), SHA-512-verified against the published checksum. The JDK started via `winget install EclipseAdoptium.Temurin.25.JDK`, but the underlying MSI hung indefinitely (10+ minutes, `msiexec` unkillable from a non-elevated shell) — almost certainly stuck on an unattended UAC elevation prompt with no one to click it. Killed the `winget` process and re-installed from Adoptium's official portable zip distribution instead (same checksum-verify-extract pattern as Maven), which sidesteps installer elevation entirely and is the more reliable approach for headless/agent environments generally.
3. **Docker isn't running.** Per explicit user instruction, proceeding with every Phase 1 checklist item except Testcontainers integration tests (#16), stopping there rather than silently swapping in H2.
4. **Project vertical slice deliberately minimal (create-only).** Phase 1's checklist items #9 (layered architecture) and #19 (`ApplicationEventPublisher` example) need *some* working create flow to demonstrate the pattern against, but the user explicitly excluded Phase 2 ("domain CRUD"). Resolved by building only `POST /api/v1/projects` (controller → service → repository → DTO, with tag upsert-by-name since `tags` is a required contract field) and deliberately not building `GET`/`PUT`/`DELETE`, pagination, or filtering — those are Phase 2's "Project CRUD" line item verbatim. `contact/` package gets only the entity + repository (no controller/service at all), since Phase 1 has no checklist item that needs a working contact flow.
5. **No admin user seeded in `V1__init.sql`.** `docs/DATA_MODEL.md`'s migration notes list `admin_user` as one of the six V1 tables, so the schema is created — but seeding the single admin row needs a bcrypt hash, and generating one meaningfully needs a running app (Phase 2's job, per the Auth Flow ADR). V1 creates an empty `admin_user` table; seeding is deferred to Phase 2 alongside the actual login endpoint.
6. **`SecurityConfig` is a permit-all placeholder.** The Security starter is wired in now (per the confirmed JWT auth scope), but real JWT filters/`@PreAuthorize` guards are explicitly Phase 2. Phase 1's `SecurityConfig` permits every request so the app is functional without a login flow that doesn't exist yet — clearly commented as a placeholder to replace, not a real security posture.

## 2026-08-01 — claude (main session): Docker came up, closed out #16 and found a real bug

**Task given:**

User turned on Docker Desktop after the above session ended. Picked up the one remaining Phase 1 item — Testcontainers integration tests (#16) — and used the opportunity to also close the "app never booted against real Postgres" gap flagged in the PR.

**What went right:**

- Doing a real manual boot + `curl` against the actual endpoint (not just `mvn test`) caught a genuine bug that no amount of mocked unit testing would have found — see below.

**What went wrong (be specific):**

**Bug: `ProjectService.createProject` returned `createdAt`/`updatedAt` as `null`.** `POST /api/v1/projects` worked and returned 201, but the JSON body had `"createdAt":null,"updatedAt":null`. Root cause: the service called `projectRepository.save(project)` (not `saveAndFlush`). Hibernate's `@CreationTimestamp`/`@UpdateTimestamp` generators populate those fields at *flush* time; a plain `save()` inside a `@Transactional` method defers that flush to transaction commit, which happens *after* the method body — including the `ProjectResponse.from(saved)` call — has already returned. The mocked `ProjectServiceTest` unit test could never have caught this: Mockito's stub just echoes back the same Java object with whatever fields were already set, so it doesn't simulate flush timing at all. This is exactly the class of bug `PROJECT_TODO.md` warns Testcontainers/real-infra testing catches and unit tests can't.

**How it was caught:** Manual `curl -X POST http://localhost:8080/api/v1/projects` against the app running with a real (throwaway, Docker-run) Postgres instance, after `mvn test` had already gone fully green.

**Fix applied:** Changed `ProjectService.createProject` to `projectRepository.saveAndFlush(project)`. Updated `ProjectServiceTest`'s mocks to stub `saveAndFlush` instead of `save`. Added a new integration test (`createProjectThroughService_populatesTimestampsInResponse`, in `ProjectRepositoryIntegrationTest`) that calls `ProjectService` directly against real Postgres and asserts both timestamps are non-null, so this can't regress silently again.

**Takeaway for next time / non-obvious judgment calls made:**

1. **Spring Boot 4 fragmented `spring-boot-test-autoconfigure` into per-feature `-test` artifacts and relocated their packages.** `@DataJpaTest`, `AutoConfigureTestDatabase`, and `TestEntityManager` no longer live where Boot 3 had them (`org.springframework.boot.test.autoconfigure.orm.jpa` / `.jdbc`). They're now spread across separate Maven modules (`spring-boot-data-jpa-test`, `spring-boot-jpa-test`, `spring-boot-jdbc-test`) under new packages (`org.springframework.boot.data.jpa.test.autoconfigure`, `org.springframework.boot.jpa.test.autoconfigure`, `org.springframework.boot.jdbc.test.autoconfigure`). None of this is discoverable from compiler errors alone beyond "class not found" — had to `unzip -l` the actual jars in `~/.m2` to find the new locations. Ended up sidestepping the whole `@DataJpaTest` slice-test complexity by using plain `@SpringBootTest` + injected `jakarta.persistence.EntityManager` instead, which is simpler and also verifies full app boot (Flyway included) as a side effect.
2. **Flyway needs `spring-boot-starter-flyway` in Boot 4, not just `flyway-core`.** Adding `org.flywaydb:flyway-core` directly (the old Boot 3 pattern) compiles fine but Flyway silently never runs — no error, no log line, just an empty schema and a confusing "relation does not exist" from the first query. `FlywayAutoConfiguration` moved into its own `spring-boot-flyway` module, and the `spring-boot-starter-flyway` starter is the one that pulls it in correctly alongside `spring-boot-starter-jdbc`.
3. **Testcontainers 2.x renamed its artifacts** — `org.testcontainers:junit-jupiter` → `testcontainers-junit-jupiter`, `org.testcontainers:postgresql` → `testcontainers-postgresql` (all module artifacts gained a `testcontainers-` prefix). Also needed to import `testcontainers-bom` explicitly in `dependencyManagement`, since Spring Boot 4.1.0's own BOM didn't manage a version for these.
4. **`search.maven.org`'s search index cannot be trusted for "does version X exist" questions** — confirmed twice this session (Spring Modulith 2.x, and again implicitly here). `repo1.maven.org/.../maven-metadata.xml` is the authoritative source; use it, not the search UI's backing index, when a version decision matters.

## 2026-08-01 — GitHub Copilot review of PR #76 (first external review of agent output)

**Task given:** User asked for a response to Copilot's automated review on PR #76, then to fix what was valid.

**Agent(s) used:** GitHub Copilot (automated PR reviewer, "Lite" effort) as reviewer; main Claude Code session as author/responder.

**What went right:**

Copilot found **three genuine defects** that neither the test suite (7 passing tests, including Testcontainers against real Postgres) nor manual endpoint verification had caught. This is the clearest evidence so far in this project that green tests ≠ correct code, and that an independent reviewer with no context on the author's intent catches a different *class* of problem than self-review does:

1. **`ProjectWriteRequest` compact constructor defeated `@NotNull` on `tags`.** `tags = tags == null ? List.of() : tags` runs during record construction, *before* Bean Validation inspects the object — so a request omitting `tags` entirely silently became an empty list instead of failing validation, contradicting `docs/openapi.yaml`'s `required: [title, description, tags]`. Verified the fix by hand: omitting `tags` now returns 400 with `{"field":"tags","message":"must not be null"}`.
2. **`resolveTags()` had a check-then-act race.** `findByNameIgnoreCase(...).orElseGet(() -> save(...))` — two concurrent creates of the same new tag would both miss the find and both insert, tripping `ux_tag_name_lower` and surfacing as an unhandled 500. Replaced with a native `INSERT ... ON CONFLICT ((lower(name))) DO NOTHING` upsert + re-fetch.
3. **`EntityNotFoundException` shadowed `jakarta.persistence.EntityNotFoundException`.** Same simple name, different semantics, and the JPA one isn't handled by `GlobalExceptionHandler` — an IDE auto-import picking the wrong one compiles fine and fails confusingly at runtime. Renamed to `ResourceNotFoundException`.

Also raised a fair hardening point: `SecurityConfig`'s `permitAll()` applied in *every* profile including prod. It was documented as a Phase 1 placeholder, but "documented as risky" isn't "safe if deployed" — now profile-split so prod permits only `/actuator/health` and denies everything else (verified: 200 on health, 403 on `POST /api/v1/projects` under `-Dspring-boot.run.profiles=prod`).

**What went wrong (in the review, not the code):**

One of Copilot's six comments was **factually incorrect**: it claimed `gen_random_uuid()` requires the `pgcrypto` extension and that `V1__init.sql`'s header comment was therefore inaccurate. That was true pre-Postgres 13, but `gen_random_uuid()` has been a core built-in since v13 specifically to remove that dependency. Disproved it empirically rather than arguing from memory — spun up a vanilla `postgres:17-alpine` (only `plpgsql` installed, per `\dx`) and ran the exact `DEFAULT gen_random_uuid()` pattern from the migration: worked, no extension. A second comment was simply stale (flagged missing Testcontainers deps that had been added in a later commit than the one reviewed).

**How it was caught:** Automated PR review, then per-claim verification before accepting or rejecting each point.

**Fix applied:** Four fixes (three defects + the prod lockdown), each with test coverage: the `tags` validation gap and prod denial verified by hand via curl; the tag upsert covered by a new integration test (`upsertByNameIsIdempotentAndCaseInsensitive`) asserting three different-cased upserts collapse to one row against real Postgres. Suite now 7 tests, all green.

**Takeaway for next time:**

- **Do not accept review claims uncritically, and do not reject them defensively either — verify each one.** 3 of 6 comments were real defects worth fixing, 1 was a reasonable hardening call, 1 was factually wrong, 1 was stale. Uncritically accepting all six would have meant a pointless `pgcrypto` extension in the migration; uncritically dismissing them would have shipped three real bugs. The empirical check (spin up a container, run the actual SQL) took under a minute and settled the disputed one definitively.
- **The bugs Copilot found share a shape: they're all invisible to tests that only exercise the happy path with well-formed input.** The `tags` gap needed a request with a *missing key* (not an empty array); the race needed *concurrency*; the exception-name collision needed a *future* wrong import. Worth deliberately testing malformed/omitted input and adversarial ordering in Phase 2, not just valid-input paths.
