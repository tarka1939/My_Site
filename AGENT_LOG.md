# Agent Log

Running log of agent sessions on this project — what was run, what each agent got wrong, and how it was caught/fixed. This is the actual differentiation artifact for Phase 4 (more valuable than the app itself), so keep entries specific and dated.

Convert relative dates to absolute (YYYY-MM-DD) when logging.

---

## Index — the cases worth reading (Phase 4 deliverable, issue #36)

`PROJECT_TODO.md` Phase 4 asks for "at least 3 concrete cases where an agent's output was subtly
wrong and how you caught and fixed it." Phases 1-3 produced far more than three. This index is the
deliverable: the cases below are grouped by **which layer of verification failed to catch them**,
because that's the transferable part — chronology isn't.

The through-line across every case: **each bug got past whatever verification was actually in place
at the moment it shipped.** The *shape* of that gap varies, and the variation is most of the value
here:

- **A test existed, ran green, and was structurally incapable of failing on it** — a mock that
  cannot simulate flush timing; an unsorted `Pageable` that never emits an `ORDER BY`. Section 1 is
  mostly this class.
- **No test existed at all**, because the thing had never been framed as testable — a real email
  hardcoded in a migration, a reset token logged at WARN, a `Closes #N` keyword nobody had ever
  confirmed did anything, a `@Profile` predicate with no coverage of its own default case. For
  several of these, writing the first test *was* the fix.
- **The tooling reported success without having performed the check** — a clean `git merge` with no
  conflict markers, a Flyway migration that silently never executed, a build that hides deprecation
  warnings unless asked. Section 5 is entirely this class.

So "we forgot to write a test" is the honest diagnosis for a decent share of these, and it's said
where it applies rather than dressed up. Where a test suite *did* do the catching, that's said too:
the clean-merge case in section 5 was exposed by `mvn test` going red on a trial merge, after git
and the compiler had both stayed quiet. The claim isn't that testing doesn't work — it's that every
one of these slipped past the specific signal that was being trusted at the time.

Each case cites the `AGENT_LOG.md` entry it comes from (date, and PR number where there is one) so
the full writeup is one search away, and says how it was fixed, not just how it was found.

### 1. Bugs that mocked tests structurally cannot catch (needed real infrastructure)

- **`save()` vs `saveAndFlush()` returned null timestamps.** `POST /projects` returned 201 with
  `"createdAt":null`. Hibernate's `@CreationTimestamp` populates at *flush*, which `@Transactional`
  defers to commit — after the method already built its response. The mocked unit test could never
  fail: Mockito echoes back the same Java object, simulating no flush timing at all. Caught by a
  manual `curl` against real Postgres *after* `mvn test` was fully green. **Fixed** by switching to
  `saveAndFlush`, plus a new integration test calling `ProjectService` against real Postgres and
  asserting both timestamps are non-null, so it can't regress silently.
  *(2026-08-01, "Docker came up, closed out #16 and found a real bug" — PR #76.)*
- **`SELECT DISTINCT ... ORDER BY` broke every tag-filtered request.** Postgres requires `ORDER BY`
  expressions to appear in the `DISTINCT` list. The integration test used an *unsorted*
  `PageRequest.of(0, 10)`, so it never emitted an `ORDER BY` at all — it passed while the real
  endpoint (which always sorts by `createdAt`) was broken for every tag filter. **Fixed** by
  rewriting the query as an `IN` subquery, which needs no `DISTINCT` at all, and changing the test
  to use the same sorted `Pageable` shape the controller actually builds.
  *(2026-08-01, "Phase 2 core domain features" — PR #77.)*
- **Two services shared one rate-limit bucket.** `AuthService.login` copied
  `rateLimiter.tryAcquire(ipHash, ...)` verbatim from `PasswordResetService`, missing that the
  limiter is a shared singleton. Five failed logins then blocked password reset for up to an hour —
  breaking exactly the "I forgot my password" recovery path. The unit test mocked the limiter, so it
  verified login's limit in isolation and could not observe two services colliding on real state.
  **Fixed** by namespacing both keys (`"login:" + ipHash`, `"password-reset:" + ipHash`) and adding
  an integration test that wires the real Spring singleton rather than a mock.
  *(2026-08-01, "Shared rate-limiter key collision on PR #77" — PR #77.)*

**Lesson:** a mock verifies the code does what it was told. It cannot verify the system works. Where
a bug lives in *timing*, *dialect*, or *shared state*, the mock is the thing hiding it.

### 2. Bugs no test outside a real browser can catch

- **The backend had zero CORS configuration**, which broke all local dev the first time the app was
  opened in an actual browser. Every component and interceptor test passed — Vitest/jsdom and
  `HttpClientTestingModule` don't enforce browser origin rules. A green `ng test` and a clean
  `ng build` give exactly zero signal on this class of bug. Caught only by a live browser smoke test
  against a running backend. **Fixed — and be clear about what the fix is not: the backend still
  has no CORS configuration.** The fix was frontend-only: an `ng serve` proxy
  (`frontend/proxy.conf.json` forwarding `/api` to `localhost:8080`, wired into `angular.json`) plus
  switching `environment.development.ts`'s `apiBaseUrl` to a relative `/api/v1`, so local dev
  requests are same-origin and the browser never invokes CORS enforcement at all. Real CORS config
  for the deployed Netlify origin is still an open Phase 5 item; `/backend` was not touched.
  *(2026-08-02, "Phase 3 frontend foundation" — PR #80.)*

**Lesson:** this is the frontend's exact analogue of the Testcontainers lesson above.

### 3. Bugs that only appear under adversarial, malformed, or concurrent input

- **A record's compact constructor silently defeated `@NotNull`.** `tags = tags == null ? List.of() : tags`
  runs *before* Bean Validation inspects the object, so a request omitting `tags` became an empty
  list instead of a 400 — contradicting the OpenAPI contract. Needed a request with a **missing key**,
  not an empty array, to expose. **Fixed** by dropping `tags` from the compact constructor's
  defaulting (`links`/`images` keep theirs — those are genuinely optional in the contract), verified
  by hand that an omitted `tags` now returns 400.
  *(2026-08-01, "GitHub Copilot review of PR #76".)*
- **`X-Forwarded-For` was trusted unconditionally**, letting any caller spoof their IP past the
  per-IP rate limiter. Needed an *adversary*, not a well-formed request. **Fixed** by dropping the
  header entirely and using `getRemoteAddr()` only, until Phase 5 puts a real trusted proxy in front.
  *(2026-08-01, "GitHub Copilot review of PR #77".)*
- **Three separate check-then-act races**: tag upsert, `listProjects`' concurrent-delete NPE, and
  reset-token double-confirm. Each needed *concurrency* to expose; each passed single-request testing.
  **Fixed** one per race, each by removing the gap rather than narrowing it: a native
  `INSERT ... ON CONFLICT ((lower(name))) DO NOTHING` upsert plus re-fetch (tag); filtering nulls
  before mapping (`listProjects`); and an atomic `UPDATE ... WHERE used_at IS NULL AND expires_at >
  :now` returning rows-affected, replacing find-then-check-then-write (reset token).
  *(2026-08-01, in order: "GitHub Copilot review of PR #76", "GitHub Copilot review of PR #77",
  "Independent cross-review of PR #77" — PRs #76 and #77.)*

**Lesson:** happy-path testing with well-formed, single-threaded, non-hostile input is a narrow slice
of the input space. These bugs share one shape — they live everywhere outside that slice.

### 4. Security and config that fails *open* while looking correct

- **An inverted `@Profile("!prod")` predicate made permit-all the default** for any profile that
  wasn't literally `prod` — including no profile set at all. Documented as a "temporary placeholder,"
  which is not the same claim as "safe if deployed." The sharpest detail in this whole index: **that
  fail-open default was introduced by the fix for an earlier fail-open finding on the same file**,
  about 25 minutes earlier in the same review round. Two profiles were named in the code, those two
  profiles were tested, and the default case the split had just created fell between them. **Fixed**
  by inverting the polarity — permit-all became opt-in via `@Profile("dev")`, and `@Profile("!dev")`
  (prod, any other profile, or none) got the locked-down chain; a no-`@ActiveProfiles` test asserting
  the default is locked down followed in PR #79.
  *(2026-08-01, "`SecurityConfig` failed open by default, not closed" — PR #76. That entry is the one
  case here that was never logged live; it was reconstructed from commit history on 2026-08-07 and
  says so at the top.)*
- **The JWT secret's length was validated lazily**, so a misconfigured `JWT_SECRET` booted looking
  perfectly healthy and only failed when someone first tried to log in. **Fixed** by checking the key
  length in the `jwtSecretKey` bean factory itself, turning it into an immediate boot failure, with
  `SecurityConfigTest` covering it. *(2026-08-01, "GitHub Copilot review of PR #77".)*
- **A raw password-reset token was logged at WARN** — a credential-equivalent secret, readable by
  anyone with log access. **Fixed** by keeping the reset link out of the WARN entirely and moving it
  to DEBUG, which is off by default in prod. *(2026-08-01, "GitHub Copilot review of PR #77".)*
- **A real personal email was hardcoded into a Flyway migration**, which would be permanent in git
  history on merge and seeded into every environment that ran it, including CI's throwaway databases.
  **Fixed** by switching to the RFC 2606 reserved `admin@mysite.invalid`, with a comment flagging the
  out-of-band update needed before password reset can reach a real inbox.
  *(2026-08-01, "GitHub Copilot review of PR #77".)*

**Lesson:** this class is why `PROJECT_TODO.md`'s Definition of Done now requires that placeholder
security config fail *closed*, and that absence-of-configuration be its own test case.

### 5. Tooling that reports success while silently doing nothing

The most dangerous class, because the feedback signal is actively misleading:

- **Every PR's `Closes #N` had silently linked nothing since Phase 1.** Two stacked causes: the repo's
  default branch was a stale `master` (GitHub only auto-links against the *default* branch), and a
  comma-separated `Closes #24, #25, ...` only ever links the first issue. The rendered PR body looks
  identical either way — the only way to see it is querying `closingIssuesReferences` via GraphQL.
  No test was ever in play here; nobody had thought to check the mechanism at all. **Fixed** by
  switching the default branch to `main` and deleting `master` (after confirming it was an ancestor),
  rewriting the PR body to one `Closes #N` per line, re-verifying via `gh api graphql` that all ten
  issues appeared, and writing both rules into `CLAUDE.md`'s PR conventions.
  *(2026-08-02, "PR #80's `Closes #N` list never actually linked anything" — PR #80.)*
- **Flyway silently never ran.** `flyway-core` alone compiles fine under Boot 4 but doesn't trigger
  autoconfiguration — no error, no log line, just an empty schema and a confusing "relation does not
  exist" from the first query. **Fixed** by depending on `spring-boot-starter-flyway` instead, which
  is what pulls in the relocated `FlywayAutoConfiguration`.
  *(2026-08-01, "Docker came up, closed out #16 and found a real bug" — PR #76.)*
- **A clean git merge left a test asserting things that were no longer true.** Zero conflict markers,
  because there was no textual overlap: one branch rewrote `SecurityConfig` while another wrote tests
  against its old behavior. The layers that reported success were `git merge` and `mvn test-compile`;
  the test suite is what actually caught it, going red on a trial merge (1 wrong-status assertion, 4
  context-load failures). It belongs in this section for what stayed silent, not for what the tests
  missed. **Fixed** by deleting `SecurityConfigProfileTest` — its premise (behavior varies by profile)
  no longer existed after the JWT rewrite, and `SecurityIntegrationTest` already covered
  "unauthenticated writes rejected" for the new model — then replaying the identical resolution on the
  real branch and re-verifying green there.
  *(2026-08-01, "Merging PR #79 into PR #77, and a test that git couldn't tell was broken" — PRs #77
  and #79.)*
- **Two warnings the default build output swallows, from two different layers.** `mvn test-compile`
  hides deprecation warnings unless `-Dmaven.compiler.showDeprecation=true` is passed — which is what
  surfaced three test files still importing the deprecated
  `org.testcontainers.containers.PostgreSQLContainer` after an earlier PR had already "fixed" that
  (it could only fix files that existed when it was written). Separately, a Hibernate Validator
  **runtime** warning (HV000271, about `@Valid`'s pre-3.1 placement on `ProjectWriteRequest.links`)
  had been printing into `mvn test`'s console output the whole time, where a green suite gives nobody
  a reason to look. Worth stating precisely, because it's easy to inflate: **cascade validation never
  stopped working.** HV000271 is a deprecation notice about *where* the annotation sits, not a
  behavior change — a `curl` after the move confirmed `links[0].label: must not be blank` still fires,
  i.e. cascade validation survived it. The real gap was that no test exercised an invalid `LinkDto` at
  all. **Fixed** by moving `@Valid` onto the type argument (`List<@Valid LinkDto> links`), switching
  the three imports to the non-generic `org.testcontainers.postgresql.PostgreSQLContainer`, and adding
  `ProjectWriteRequestValidationTest` as the first coverage of an actually-invalid link.
  *(2026-08-01, "Two deprecation gaps found by actually running `-Dmaven.compiler.showDeprecation=true`
  and reading test output" — PR #77.)*

**Lesson:** "it ran and didn't complain" is not evidence it did anything. For anything whose success
is invisible (issue linking, migrations, merges), verify the *effect* directly, not the exit code.
The last bullet is the near-miss variant and is worth separating out: sometimes the tool *did*
complain, into output nobody was reading because the summary line said green.

### 6. What the review process itself taught

Every independent review round on this project has found real defects — Copilot twice (3/6 and 5/6
comments valid), an independent agent session once (4/4 valid), and direct user review twice. Self-review,
even careful and test-covered, reliably misses a whole class of bug that a cold second pass catches.
*(2026-08-01: "GitHub Copilot review of PR #76", "GitHub Copilot review of PR #77", "Independent
cross-review of PR #77", "Shared rate-limiter key collision on PR #77", "a self-introduced regression,
caught by the user's own review of PR #79".)*

The counterweight matters just as much: **one Copilot finding was factually wrong** — it claimed
`gen_random_uuid()` requires the `pgcrypto` extension, true before Postgres 13 but not since. It was
disproved empirically (spin up a vanilla container, check `\dx`, run the actual SQL) rather than argued
from memory, in under a minute. Another was simply stale. Accepting all six uncritically would have
added a pointless extension; dismissing them defensively would have shipped three real bugs. The
resolution in both directions is the same move: **reply on the thread with the verdict and the
evidence** — the fix commit where it was real, the container transcript where it wasn't — rather than
silently implementing or silently ignoring. *(2026-08-01, "GitHub Copilot review of PR #76" — PR #76.)*

**Lesson, and the one this project actually runs on:** verify each finding independently. Neither
deference nor defensiveness — evidence.

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

## 2026-08-07 — Senior Dev session: Phase 4 (E2E suite + this index), first run of the dispatcher model

**Task given:**

First session run under `docs/AUTONOMOUS_WORKFLOW.md`'s Senior Dev model — coordinator and
dispatcher, explicitly *not* implementer. Close out Phase 4: the Playwright E2E suite (#37) and the
agent-mistake index (#36).

**Agent(s) used:**

This session as Senior Dev; one `general-purpose` junior dispatched into a dedicated worktree
(`D:\repos\My_Site-e2e-playwright`, branch `phase4/playwright-e2e`) for the E2E implementation.
Issue #36 was kept in-house — `AGENT_LOG.md` is the Senior Dev's file to own, not a junior's.

**What went right:**

- **Worktree isolation held under a real test.** The junior's entire 1,370-line diff landed under
  `/e2e` with zero changes to `backend/` or `frontend/`, verified by `git diff --stat` after the
  fact rather than trusted from the instruction. Manual `git worktree add` was chosen over the
  CLI's `isolation: "worktree"` specifically because the auto-managed variant picks its own branch
  name and auto-cleans — neither compatible with a branch that has to survive into a PR.
- **The junior's code was genuinely good** where it counted: a structural non-localhost guard on the
  one DB write, purge-before-seed for rerunnability, and a real discovery that login is rate-limited
  5/15min (so it caches and revalidates the JWT rather than logging in every run).
- **Re-running the gate personally is what caught the headline problem below.** Reviewing the diff
  alone would not have.

**What went wrong (be specific):**

1. **The junior's suite had never been executed once.** It hit an API session limit mid-verification,
   and its final output was a truncated "Cold-start verification run:" with no results. The code was
   articulate, heavily commented, and cited `PROJECT_TODO.md` by section — and the Playwright browser
   binary was never installed, so all four browser-driven tests failed instantly with
   `Executable doesn't exist`. Its own `e2e/README.md` correctly lists `npm run install:browsers` as
   a prerequisite; it documented the step it hadn't performed.
2. **Senior Dev error — a worktree cleanup that made things worse.** Four merged-PR worktrees were
   removed after checking each had a clean `git status`. `git worktree remove` then failed with
   `Permission denied` (files locked), but the registrations were already gone. Result: four
   directories still on disk with broken `.git` links, where `git status` now silently resolves to
   the *main checkout* instead of failing. A session sitting in one would believe it was isolated
   while operating on `D:\repos\My_Site` — the exact collision worktrees exist to prevent. "Clean
   working tree" was read as "dead session"; the permission error was the evidence otherwise.
3. **Senior Dev error — a verification gate that couldn't fail.** The regression gate was written as
   `(cd backend && mvn -q test 2>&1 | tail -35); echo "BACKEND_EXIT=$?"`. `$?` after a pipeline is
   the exit status of the *last* command — `tail` — which succeeds unconditionally. `BACKEND_EXIT=0`
   was therefore guaranteed regardless of whether Maven passed, and `-q` plus `tail -35` had also
   discarded the "Tests run:" summary that would have provided independent evidence. Caught by
   grepping the log for an actual result line, finding none, and re-running with the exit code
   captured directly.

**How it was caught:**

(1) By running the suite personally as the pre-review gate, rather than accepting the branch on the
strength of how well-written it was. (2) By the `Permission denied` output, which was noticed but
initially under-weighted. (3) By refusing to treat `EXIT=0` as evidence and going looking for the
underlying "Tests run:" line — which did not exist.

**Fix applied:**

Installed the missing browser, then ran the suite three times: 4 failed / 3 passed (browser absent),
then 7/7, then 7/7 again immediately with no database wipe to prove rerunnability. Teardown removed
exactly its own rows both times. Backend and frontend suites re-run with exit codes captured
correctly. The orphaned worktree directories were escalated to the user rather than force-deleted,
since something holding a file lock is evidence of a live process, not an obstacle to route around.

**Takeaway for next time:**

- **Fluent, well-reasoned, spec-citing code is not evidence that the code runs.** Every prior entry
  in this log warns that green tests don't imply correct code. This is the inverse and it is
  sharper: prose quality reads as a *proxy* for verification, and here it was inversely correlated
  with it — the comments described passing behavior no one had observed. The dispatcher model makes
  this the single most important thing the Senior Dev does: re-run the gate, never accept on polish.
- **A verification gate has to be able to fail.** A gate whose success is structurally guaranteed is
  worse than no gate, because it produces a false record of having checked. `set -o pipefail`, or
  capture the exit code before piping. Notably this project's own log already had a section on
  tooling that reports success while doing nothing — and the same mistake was made anyway, one hour
  after writing it. Knowing the pattern is not the same as applying it.
- **A failed destructive operation can leave worse state than either doing it or not doing it.**
  Partial success is the dangerous outcome, and "the resource is locked" is information about the
  world, not friction to overcome.

## 2026-08-02 — claude (main session): PR #80's "Closes #N" list never actually linked anything

**Task given:** User noticed PR #80's "Development" sidebar had no linked issues, despite the PR
body listing `Closes #24, #25, #26, #27, #28, #29, #30, #31, #32, #33`.

**What went wrong (be specific):** Two independent, stacked causes, both silent (the rendered PR
body text looked correct either way -- neither is visible without querying the API/GraphQL
directly):

1. **The repo's default branch was `master`**, not `main` -- a stale artifact from before the
   project standardized on `main` (confirmed: `master` was an ancestor of `main`, 57 commits
   behind, just the original 5-commit skeleton). GitHub only auto-populates a PR's linked-issues
   sidebar, and only auto-closes on merge, when the PR's base is the repo's *default* branch.
   Every prior PR (#76, #77, #79) had also silently gotten zero linked issues for this exact
   reason, not just PR #80.
2. **Even after fixing (1), a comma-separated `Closes #24, #25, #26, ...` only linked the first
   issue** (#24) -- confirmed via `gh api graphql` querying `closingIssuesReferences` directly,
   which is the only way to see this; the rendered body text gives no indication. This contradicts
   GitHub's own documented syntax for closing multiple issues in one line.

**How it was caught:** User manually checked the PR's "Development" section on GitHub's UI.

**Fix applied:**
1. `gh api repos/tarka1939/My_Site -X PATCH -f default_branch=main`, then deleted the now-pointless
   `master` branch (`git push My_Site --delete master`) -- confirmed safe first via
   `git merge-base --is-ancestor My_Site/master My_Site/main`.
2. Rewrote PR #80's body to use one `Closes #N` per line instead of the comma-separated list.
   Re-verified via `gh api graphql` that all 10 issues now appear in `closingIssuesReferences`.
3. Updated `CLAUDE.md`'s PR conventions section with both findings so future phases don't repeat
   either mistake.

**Takeaway for next time:**

- **Never trust the rendered PR body to confirm closing keywords worked.** Query
  `closingIssuesReferences` via `gh api graphql` (or check the PR's own "Development" sidebar on
  GitHub's site, which is what actually surfaced this) before assuming a multi-issue "Closes"
  list did anything. A comma-separated list after one keyword is silently wrong; one keyword per
  issue, one per line, is the only form confirmed to work.
- **A stale default branch is invisible until you specifically check for it** (`gh api
  repos/OWNER/REPO --jq '.default_branch'`) -- everything else about the repo (PRs, merges, CI if
  it existed) can look completely normal while this quietly breaks issue auto-linking/auto-closing
  for every single PR.

## 2026-08-02 — claude (main session): Phase 3 frontend foundation

**Task given:**

Scaffold Phase 3 (frontend foundation) per `PROJECT_TODO.md` and issues #24-33: standalone Angular
app, lazy-loaded routing, a typed API client generated from `docs/openapi.yaml`, an HTTP
interceptor for auth + centralized error handling, signals-based state, component tests, an
accessibility pass, and Netlify-specific build config (`--base-href`, `_redirects`). Explicitly out
of scope: `/backend`, Phase 4.

**Agent(s) used:**

Main Claude Code session, no subagent dispatch — `docs/AGENT_WORKFLOW.md` calls for sequential
single-agent work on Phase 3, not a dispatcher, and this worktree was already dedicated to the
frontend for this task.

**What went right:**

- A live browser smoke test (throwaway Docker Postgres + the real backend running locally, not
  just mocked component tests) caught a real integration gap the whole mocked test suite
  structurally could not: see the CORS finding below. Same lesson Phase 1 already learned with
  Testcontainers — mocked/unit-level testing verifies the code does what it's told, not that the
  whole system actually works together.
- Found the exact frontend route the backend's password-reset email link expects
  (`PasswordResetService.java`: `frontendUrl + "/reset-password?token=" + rawToken`) by reading the
  already-built backend code, instead of interrupting the user to ask — the user's task message
  had explicitly flagged this as something to "check with me before changing," but reading
  confirmed no change was needed at all: the route just had to match what already exists.

**What went wrong (be specific):**

1. **The backend has zero CORS configuration**, confirmed via `grep -rn -i cors backend/src/main`
   (no matches at all). `docs/DECISIONS.md`/`CLAUDE.md` only scope CORS work to Phase 5, for the
   deployed Netlify origin — nothing in any doc flagged that **local dev** (`ng serve` on :4200
   talking to a locally-run backend on :8080) would be broken by the same gap. Every API call
   failed with a browser-level `net::ERR_FAILED` (confirmed via `curl -H "Origin: ..."` showing no
   `Access-Control-Allow-Origin` header at all) the first time the actual app was loaded in a
   browser — every mocked component/interceptor test had passed because none of them go through a
   real browser's CORS enforcement.
2. **Angular CLI's newest stable version (22.x) requires Node `^24.15.0`**, and the environment's
   installed Node was `24.14.0` — one patch version short. `docs/DECISIONS.md` had already flagged
   this exact risk category ("verify Angular CLI tooling support these versions... tooling support
   can lag a few months behind a language runtime's own release") but for the JDK/Node pairing in
   general, not this specific gap.

**How it was caught:**

1. Live browser smoke test via the Claude Browser tool against a real backend (Docker Postgres +
   `mvn spring-boot:run -Dspring-boot.run.profiles=dev`), not just `ng test`/`ng build`.
2. `npx @angular/cli@latest new` failing immediately with an explicit Node-version error message
   before any code was written.

**Fix applied:**

1. Added `frontend/proxy.conf.json` (forwards `/api` to `http://localhost:8080`) and wired it into
   `angular.json`'s `serve.options.proxyConfig`, and changed `environment.development.ts`'s
   `apiBaseUrl` from an absolute `http://localhost:8080/api/v1` to a relative `/api/v1` — this
   makes `ng serve` requests same-origin (proxied, not cross-origin), so the browser never invokes
   CORS enforcement at all for local dev. Entirely a frontend-only change; `/backend` was not
   touched, and this doesn't replace or scope-creep into Phase 5's real CORS config for the
   deployed Netlify origin, which is a separate, still-open item.
2. Used Angular CLI `21.2.19` (the latest version whose `engines.node` (`^20.19.0 || ^22.12.0 ||
   >=24.0.0`) the installed Node actually satisfies) instead of upgrading the system's Node
   install — verified via `npm view @angular/cli@21 engines` before committing to it. Chose this
   over a Node upgrade because upgrading system Node is a bigger, permission-gated action
   (installing/replacing a system tool) for what's only a one-patch-version gap; falling back one
   Angular major version needed no such action and 21.x is still actively receiving patches (last
   published 2026-07-09), not legacy/EOL.

**Takeaway for next time / non-obvious judgment calls made:**

1. **A CORS gap is invisible to every test that runs inside Node (Vitest/jsdom) or via
   `HttpClientTestingModule`** — none of those enforce browser-origin rules, so a fully green
   `ng test` run and a clean `ng build` give zero signal on this class of bug. The only thing that
   catches it is an actual browser making an actual cross-origin request. Budget for a real
   browser smoke test against a real backend before calling any frontend phase done, not just
   `ng build`/`ng test` — this is the frontend-side equivalent of Phase 1's Testcontainers lesson.
2. **The generated `typescript-angular` API client has its own built-in bearer-token mechanism**
   (`Configuration.credentials.bearerAuth`, used internally by every generated service method via
   `addCredentialToHeaders`) — deliberately left unconfigured (`provideApi(environment.apiBaseUrl)`
   is called with a bare string, not a `ConfigurationParameters` object) so that a single custom
   `authInterceptor` is the one place deciding whether a token is attached, instead of two
   overlapping mechanisms. Worth knowing before wiring auth into a generated client: passing a
   `ConfigurationParameters` object with `credentials.bearerAuth` set would have silently attached
   a *second*, redundant `Authorization` header source.
3. **Angular 21's `ng generate environments` schematic inverted the file-naming convention**
   `PROJECT_TODO.md`/issue #33 assumed: `environment.ts` is now the production default (used
   unless a build configuration's `fileReplacements` swaps it), and `environment.development.ts`
   (not `environment.prod.ts`) is the override used by `ng serve`. Followed the current tool's
   actual default rather than fighting it to match the older `environment.ts`/`environment.prod.ts`
   naming the issue text assumed.
4. **The committed-vs-gitignored question for generated code isn't settled by "generate a typed
   client" alone.** Chose to commit `frontend/src/app/core/api` (with a `generate:api` npm script
   to regenerate on demand) rather than gitignore-and-regenerate-in-CI, specifically so the
   Netlify build in Phase 5 never needs a JVM on its build image just to run
   `openapi-generator-cli`. Flag this in Phase 5 planning if Netlify build minutes/complexity ever
   make regeneration-in-CI look more attractive than a committed, occasionally-stale client.

## 2026-08-01 — Two deprecation gaps found by actually running `-Dmaven.compiler.showDeprecation=true` and reading test output

**Task given:** User ran the build with `-Dmaven.compiler.showDeprecation=true` (the same flag
PR #79's own AGENT_LOG entry recommended running periodically) and reported two findings: three
test files still importing the deprecated `org.testcontainers.containers.PostgreSQLContainer`
(PR #79 fixed this in `ProjectRepositoryIntegrationTest` but that fix predates the three
Phase 2 test files, which didn't exist yet), and a Hibernate Validator HV000271 runtime warning
("Using `@Valid` on a container ... is deprecated") logged during `SecurityIntegrationTest`.

**Agent(s) used:** Main Claude Code session.

**What went right:** Verified both against source before fixing (unnecessary here — both were
unambiguous once confirmed present) but still worth the ten seconds: grepped the exact import
lines and read `ProjectWriteRequest.java` directly rather than assuming the report's framing
was complete. Also verified the fix didn't just make the warning disappear but that the
behavior it protects (cascade validation into each `LinkDto` element) still actually works --
compile-clean and warning-free isn't the same claim as "still validates correctly."

**What went wrong (be specific):**

1. **Three Testcontainers imports missed by PR #79's fix.** `SecurityIntegrationTest`,
   `AuthIntegrationTest`, `ContactRepositoryIntegrationTest` (all written this session, after
   PR #79's `ProjectRepositoryIntegrationTest` fix) still used the deprecated generic
   `org.testcontainers.containers.PostgreSQLContainer<?>` / `new PostgreSQLContainer<>(...)`.
   Two parallel PRs fixing the same underlying issue in different files is an easy gap to leave
   -- PR #79 could only fix files that existed when it was written.
2. **`ProjectWriteRequest.links` used the pre-3.1 `@Valid` placement.** `@Valid @Size(max = 10)
   List<LinkDto> links` put `@Valid` on the container; Jakarta Bean Validation 3.1+ wants it on
   the type argument (`List<@Valid LinkDto> links`) to cascade into each element -- the same
   pattern the same record already used correctly for `images`/`tags`
   (`List<@Size(max = 500) String>`, `List<@NotBlank @Size(max = 50) String>`). One field in
   the record followed the old convention while its siblings followed the new one.

**How it was caught:** Not by `mvn test-compile`'s default output (deprecation warnings are
suppressed unless explicitly requested) and not by a diff review -- only by actually running
the build with the verbose flag and reading `mvn test`'s console output for runtime warnings,
which a passing test suite doesn't surface on its own.

**Fix applied:** Switched all three test files to `org.testcontainers.postgresql.
PostgreSQLContainer` (non-generic), matching PR #79's established fix exactly. Moved `@Valid`
to `List<@Valid LinkDto> links`. Verified live via `curl`: a project create with a malformed
link (`{"label":"","url":"..."}`) still returns 400 with `links[0].label: must not be blank`,
confirming cascade validation survived the move. Added
`ProjectWriteRequestValidationTest` (a `@WebMvcTest(ProjectController.class)` slice, following
PR #79's `GlobalExceptionHandlerTest` pattern -- no DB needed) so this can't silently regress
again; no existing test exercised an actually-invalid `LinkDto` before this. `mvn test-compile
-Dmaven.compiler.showDeprecation=true`: zero warnings. `mvn test`: 53 green (was 52, +1 new).

**Takeaway for next time:**

- **A merge closing one deprecation gap doesn't mean the gap is closed everywhere it exists** --
  it closes it in the files that PR touched. New files written in a parallel branch after the
  original fix inherit the *old* pattern by default (copy-paste from existing code, or an
  agent's own prior habit) unless something actively checks for it. Worth grepping for a known-
  deprecated pattern across the whole tree after a merge, not just trusting the merge resolved
  it.
- **`-Dmaven.compiler.showDeprecation=true` and reading `mvn test`'s console output for runtime
  warnings are both compile-clean-and-tests-green-blind** -- this project's default `mvn test`
  output had already swallowed both of these. PR #79's own AGENT_LOG entry already made this
  exact point about `PostgreSQLContainer`; worth actually running that flag as a habit, not
  just having written down that it's worth running.
- **When two record fields validate a `List` element with different annotation placements
  (one correct-per-current-convention, one not), that inconsistency is itself worth noticing**
  -- `images`/`tags` already showed the right pattern two lines below the wrong one in the same
  file.

## 2026-08-01 — Merging PR #79 into PR #77, and a test that git couldn't tell was broken

**Task given:** User asked for a review of PR #77's conflicts with `main` after PR #79 (a
separate, parallel post-merge review pass on Phase 1) merged. Two git conflicts, plus one
non-conflicting file whose *assertions* silently stopped matching the codebase.

**Agent(s) used:** Main Claude Code session, working alongside a separate session's PR #79 (not
directed by this session — a parallel review track on Phase 1, merged to `main` independently).

**What went right:**

Did the whole investigation on an isolated scratch branch first (`git merge-tree
--write-tree` for a read-only conflict preview, then a real trial merge on a throwaway local
branch) before touching the actual PR branch — meant the real merge, once approved, was a
known-good replay rather than a live experiment. Caught the important part (see below) *before*
proposing a resolution, not after.

**What went wrong (be specific):** Not a bug in the merged code, but a trap worth documenting:
git reported exactly 2 conflicts (`AGENT_LOG.md`, `GlobalExceptionHandler.java`), both trivial.
`SecurityConfigProfileTest.java` (new in PR #79) merged with **zero conflict markers** — but it
tests the Phase 1 placeholder `SecurityConfig`'s premise (permit-all in `dev`, deny-all
elsewhere, behavior varies by profile), which this PR's real-JWT rewrite replaced with one
uniform chain for every profile. Git had no way to flag this: it's not a textual collision,
it's two *different, non-overlapping* pieces of code where one's test assertions quietly
stopped being true about the other. Compiled clean; failed at test-run time (1 wrong-status
assertion, 4 context-load failures from `app.jwt.secret` being unresolvable in profiles this
test predates needing).

**How it was caught:** Not by `git merge` (silent), not by `mvn test-compile` (silent) — only
by actually running `mvn test` on the trial-merged branch and reading which tests broke and
why, rather than assuming "no conflict markers" meant "safe."

**Fix applied:** Resolved both real conflicts by keeping both sides' additions (no logical
overlap in either case — see the merge commit for the reasoning per file). Deleted
`SecurityConfigProfileTest.java`: its premise no longer exists in the codebase, and
`SecurityIntegrationTest` (already in this PR) covers the equivalent "unauthenticated writes
rejected" ground for the real-JWT model. Verified `mvn test` green (52) on the trial branch
*before* proposing this to the user, then replayed the identical resolution on the real branch
and re-verified green there too. PR #77's `mergeable_state` confirmed `clean` against `main`
post-push.

**Takeaway for next time:**

- **A clean git merge is not the same claim as "the merged code is still correct."** Two
  branches can each be internally consistent and still merge into a codebase where one
  branch's tests no longer mean what they did when written — with no conflict marker anywhere,
  because there was no textual overlap to conflict on. When two PRs touch the same subsystem
  from different starting points (here: `SecurityConfig`, rewritten by one PR while another
  wrote tests against its old behavior), treat "no conflicts" as "not yet disproven," not "safe."
  Actually running the test suite on the trial merge is what caught this, not reading the diff.
- **Investigate merges in an isolated scratch branch before touching the real one.** `git
  merge-tree --write-tree` (a read-only trial merge, no working-directory changes) for the
  first pass, then a real throwaway local branch for the second (compile + test the actual
  resolution) — neither touches the branch anyone else can see until the resolution is known
  good and approved.

## 2026-08-01 — Shared rate-limiter key collision on PR #77 (fourth external finding, self-introduced this same PR)

**Task given:** User reported a bug they'd found in `AuthService`/`PasswordResetService`:
both call `rateLimiter.tryAcquire(ipHash, ...)` against the same singleton
`InMemoryRateLimiter` with an unnamespaced key, so the two logically-independent rate limits
(login: 5/15min, password-reset: 5/1hour) share one bucket per IP.

**Agent(s) used:** User (direct report, not a tool-generated review this time); main Claude
Code session as verifier/fixer.

**What went wrong (be specific):** This bug was introduced *by this session*, in the same
cross-review round that added login rate limiting (see the entry above) — `AuthService.login`
copied `PasswordResetService.requestReset`'s `rateLimiter.tryAcquire(ipHash, ...)` call
verbatim, missing that `InMemoryRateLimiter` is a shared singleton bean and the bare IP hash
collides across both call sites. Traced through: since password-reset's window (1 hour) is
longer than login's (15 min), and `tryAcquire`'s pruning cutoff is based on the *calling*
method's own window, a shared bucket exhausted by 5 failed logins would then reject
password-reset-request for up to the *longer* of the two windows (1 hour) — breaking exactly
the "I forgot my password, let me reset it" recovery path a real admin would take right after
failing to log in a few times.

**How it was caught:** User inspection of the diff, reported directly (not via an automated
review tool this round). Verified by tracing `tryAcquire`'s pruning logic against both call
sites' actual key values before fixing — confirmed the collision was real and the described
failure mode (blocked for the *longer* window, not just the shorter one) was accurate.

**Fix applied:** Namespaced both keys (`"login:" + ipHash`, `"password-reset:" + ipHash`).
Added `AuthIntegrationTest.loginRateLimitAndPasswordResetRateLimitAreIndependentPerIp` — real
Spring-wired singleton `InMemoryRateLimiter`, not a mock, so this actually exercises the
shared-bean collision a unit test with per-test-mocked components structurally cannot catch.
Re-verified live: exhaust login's 5-attempt limit, then confirm password-reset-request from
the same IP still returns 202. `mvn test`: 49 green.

**Takeaway for next time:**

- **Copying a working pattern (`rateLimiter.tryAcquire(ipHash, ...)`) to a second call site
  against a *shared singleton* needs a namespace, not just the same shape.** The pattern was
  correct in isolation at each site; the bug only exists because both sites reach the same
  mutable state. Any time a new caller is added against an existing shared/singleton
  component, ask "does this collide with an existing caller's keys?" before copying the call.
- **A test that mocks the shared component can't catch a shared-component collision bug** —
  `AuthServiceTest`'s mocked `InMemoryRateLimiter` verified the *login* rate limit worked in
  isolation and would never have caught two services stepping on each other's real state.
  Only a test wiring the actual singleton (an integration test, in this codebase's terms)
  exercises that. Worth remembering when a bug involves a component two+ services share.
- **Four rounds of external review/report on one PR now (Copilot ×1, independent-agent
  cross-review ×1, direct user report ×1, plus this session's own manual-verification bug) —
  every round found something real**, including one bug this same session introduced two
  commits earlier while fixing a different reviewer's finding. Fixing review feedback is not
  risk-free; a fix itself needs the same scrutiny as the original code, not a pass because it
  was "just responding to review."

## 2026-08-01 — Independent cross-review of PR #77 (third external review of agent output)

**Task given:** User ran an independent review of PR #77 in a separate chat session (after
their own diff/branch-history pull) and pasted the findings back for verification and fixes —
same "verify before accepting" discipline as the two prior review rounds this project.

**Agent(s) used:** An independent Claude Code session (different chat, same PR) as reviewer;
main Claude Code session (this one) as author/responder.

**What went right:**

A reviewer with no memory of *why* each line was written, looking at the finished diff cold,
caught 4 more real issues — a third consecutive round with genuine findings, after the Copilot
round (3/6, then 5/6) and this session's own manual-verification bug. The two "Should Fix"
items are the more interesting kind of bug: each one is a *consequence of a fix already made
elsewhere in this same PR*, not a fresh mistake:

1. **`requestReset`'s anti-enumeration guarantee breaks the moment Resend has a hiccup.**
   `resendEmailClient.sendPasswordResetEmail(...)` ran uncaught inside the `@Transactional`
   method, inside the branch that only executes when the email *does* match an account. Any
   non-2xx from Resend or a network failure propagates straight out, producing a different
   response (500, or — per this same session's earlier `/error`-dispatch discovery — possibly
   401 for an unauthenticated caller) than the unconditional-202 path an unknown email takes.
   Latent today (no `RESEND_API_KEY` in any live environment until this session verified it
   locally), but would fire the moment a real deploy hits any Resend hiccup. The reviewer
   explicitly connected this to a mechanism (`/error` dispatch → 401) this project had already
   documented from its *own* bug hunt earlier in this same PR cycle, and we still missed
   applying that lesson here.
2. **`POST /auth/login` had no rate limiting**, despite `InMemoryRateLimiter` already existing
   and already being used for the contact form and password-reset-request — the one endpoint
   guarding the entire admin write surface was the one left unprotected. Not a new pattern to
   invent, just a miss in applying an existing one everywhere it belonged.
3. **`PasswordResetTokenRepository.findByTokenHash` had no supporting index** — the table
   shipped in Phase 1's `V1__init.sql` with an index on `admin_user_id` but not on
   `token_hash`, and Phase 2 is what makes that column an actual per-request hot path.
4. **`PasswordResetService.confirmReset` had the same check-then-act shape** this project has
   now fixed three separate times (Phase 1's tag-upsert race, this session's `listProjects` NPE
   from the Copilot round, and now this): read `usedAt`/`expiresAt`, decide, *then* write, with
   no atomic guard between. Two concurrent requests racing the same leaked token could both
   pass validation before either commits.

Also flagged (correctly) but left as-is: `InMemoryRateLimiter`'s key map never evicts entries
for IPs that stop being queried — real, but genuinely low-priority for this project's traffic
scale and would need scheduling infrastructure this codebase doesn't have yet. Filed as issue
#78 rather than fixed inline, matching the CORS-deferral precedent from the Copilot round
(explain and track, don't silently drop *or* over-build for load this site will never see).
`ContactService.submit`'s equivalent check-then-act rate-limit gap was flagged by the reviewer
themselves as acceptable given it's an explicitly "basic" abuse guard — agreed, no change.

**What went wrong (in the review, not the code):** Nothing to correct this round — all four
"Should Fix"/"Minor" correctness findings held up against the source, and the one deferred
item was already correctly scoped as low-priority by the reviewer, not something we had to
push back on.

**How it was caught:** A second, independent AI reviewer (not the same session that wrote the
code, not the same tool as the Copilot round) reading the finished diff with no context on
implementation intent. Each finding was re-verified against current source before any fix, per
this project's now three-times-demonstrated practice.

**Fix applied:** Four fixes:
- `PasswordResetService.requestReset`: wrapped the Resend call in try/catch, logs on failure,
  never lets the exception escape — the 202 response is now genuinely unconditional again.
- `AuthService.login`: added the same `ClientIpHasher`/`InMemoryRateLimiter` pattern already
  used elsewhere (5 attempts / 15 minutes per IP hash), threaded `HttpServletRequest` through
  `AuthController`. Verified live: 5 wrong-password attempts return 401 each, the 6th (and a
  subsequent *correct*-password attempt) both return 429.
- `V3__password_reset_token_hash_index.sql`: unique index on `token_hash` (unique, not just
  indexed — tokens are meant to be single-use).
- `PasswordResetTokenRepository.markUsedIfValid`: atomic conditional `UPDATE ... WHERE
  used_at IS NULL AND expires_at > :now`, replacing the find-then-check-then-write shape in
  `confirmReset`. Returns rows-affected so the caller can distinguish "already consumed" from
  "never existed" without a second query.

Also cleaned up a minor code-quality note from the same review: several files mixed
fully-qualified inline references (`java.util.Objects::nonNull`, `org.springframework.http.
HttpMethod.GET`, etc.) with normal imports elsewhere in the same file — added the missing
imports for consistency.

`mvn test`: 48 tests green (2 new: a login-rate-limit unit test, an atomic-double-confirm
integration test). Manually re-verified against real Postgres: all 3 migrations apply cleanly
in order, login rate limiting trips exactly as designed.

**Takeaway for next time:**

- **Three independent review rounds on one PR, three rounds of real findings.** This is now a
  firm pattern for this project, not a coincidence: self-review (even careful, test-covered
  self-review) reliably misses a class of bug that a second pass — human, Copilot, or another
  agent instance — catches close to every time. Budget for at least one independent review pass
  as a standing part of the PR workflow here, not an optional nice-to-have.
- **A fix made in one place can leave the identical gap unfixed somewhere else the same
  pattern applies.** `InMemoryRateLimiter` existed and was already used twice in this PR before
  the reviewer had to point out it wasn't used a third, more important time. When adding a
  cross-cutting utility (rate limiter, hasher, exception type), grep for every call site that
  *should* use it, not just the one that motivated writing it.
- **Fixing bug A can create the exact conditions for bug B if the interaction isn't traced
  through.** The `/error`-dispatch-produces-401-for-unauthenticated-callers behavior this
  session discovered and documented earlier in this PR is the *same* mechanism the reviewer
  flagged as a way finding #1 could manifest — we'd already learned this lesson once this PR
  cycle and it still didn't get connected to the reset-request code path until an outside
  reader pointed it out.

## 2026-08-01 — GitHub Copilot review of PR #77 (second external review of agent output)

**Task given:** Requested a Copilot review on PR #77 per the Phase 2 kickoff instructions
(same practice as Phase 1's PR #76), then responded to and fixed what was valid.

**Agent(s) used:** GitHub Copilot (automated PR reviewer) as reviewer; main Claude Code
session as author/responder.

**What went right:**

Copilot found **five genuine issues** across correctness, security, and operability that
`mvn test` (46 tests) and manual `curl` verification against real Postgres both missed —
consistent with the Phase 1 finding that an independent reviewer with no context on the
author's intent catches a different class of problem than self-review or tests do, even after
real-infra testing already caught one bug this same session (the tag-filter DISTINCT/ORDER BY
issue, see the entry above):

1. **`ProjectService.listProjects` NPEs on a concurrent-delete race.** `byId::get` on the
   id→entity map can return null if a project is deleted between the id-page query and the
   `findAllById` re-fetch, and `ProjectResponse.from(null)` would NPE into an unhandled 500.
   Fixed by filtering nulls before mapping.
2. **`ClientIpHasher` trusted `X-Forwarded-For` unconditionally.** With no reverse proxy in
   front of the app yet (that's Phase 5, not decided), any caller could set the header
   themselves and spoof their way past the per-IP rate limiter on both the contact form and
   password-reset-request. Fixed by dropping the header entirely and using `getRemoteAddr()`
   only, until Phase 5 wires up real trusted-proxy handling.
3. **`ResendEmailClient` logged the raw reset token at WARN** when `RESEND_API_KEY` wasn't
   configured (`log.warn(... resetLink ...)`, and `resetLink` embeds the raw token). A 30-minute
   password-reset token is a credential-equivalent secret; logging it means anyone with log
   access could reset the admin password. Fixed by keeping the link out of the WARN entirely
   and moving it to DEBUG (off by default in prod).
4. **`V2__admin_user_email_and_seed.sql` hardcoded a real personal email address.** Permanent
   in git history the moment this merges, and gets seeded into every environment that runs the
   migration — including CI's throwaway Testcontainers databases. Fixed by switching to the
   RFC 2606 reserved `admin@mysite.invalid` placeholder, with a comment flagging the manual
   out-of-band update needed before password-reset can reach a real inbox.
5. **`SecurityConfig`'s JWT secret wasn't length-validated.** HS256 needs >=32 bytes; Nimbus's
   signer/verifier do reject a shorter key, but only lazily on first login/token-validation —
   a misconfigured `JWT_SECRET` would look like a healthy boot and only fail once someone
   actually tried to log in. Fixed by validating length in the `jwtSecretKey` bean factory
   method itself, failing fast at startup instead. Added `SecurityConfigTest` to cover it.

**What went wrong (in the review, not the code):** None this round — the sixth comment (add
CORS configuration) was a fair, technically correct observation, not a mistake, but it's
explicitly out of scope: `PROJECT_TODO.md` places CORS under Phase 5, and there's no concrete
origin to allowlist yet (no frontend until Phase 3, no Netlify site until Phase 5). Replied on
the thread explaining the deferral rather than silently ignoring it or guessing a placeholder
origin now.

**How it was caught:** Automated PR review, then per-comment verification against the actual
source before accepting or rejecting each one (read the flagged code first, confirmed the
failure mode was real, then fixed) — same discipline as the Phase 1 Copilot round.

**Fix applied:** Five fixes, one commit (d7e48bc), each re-verified with the full `mvn test`
suite (46 tests, all green) before pushing. Replied individually on each of the six review
threads with the verdict and, where fixed, the commit hash.

**Takeaway for next time:**

- **Two rounds of Copilot review now, two rounds of real findings (3/6 and 5/6 respectively)
  neither test suite nor manual verification caught.** This is no longer a one-off — treat the
  post-implementation Copilot review as a standard, expected source of real bugs for this
  project, not a formality to satisfy before merging.
- **A concurrency-race NPE, a spoofable trust-boundary assumption, a secret logged at the
  wrong level, PII in a migration, and a lazily-validated config value are all in the same
  "passes every happy-path test" category** as Phase 1's findings (missing-field validation,
  a check-then-act race, a shadowed exception name) — none of them show up under well-formed,
  single-request, no-adversary testing. Worth deliberately red-teaming write paths (concurrent
  requests, spoofed headers, malformed/adversarial input, secrets in logs) rather than relying
  on an external reviewer to be the only line of defense for this class of bug.
- **Not every valid comment should be fixed immediately** — the CORS finding was correct but
  premature (no origin exists yet to configure). Distinguishing "wrong" from "right but not yet
  actionable" and saying so explicitly on the thread is different from, and better than, either
  blindly implementing it with a guessed placeholder or silently ignoring the comment.

## 2026-08-01 — claude (main session): Phase 2 core domain features

**Task given:**

Scaffold Phase 2 (Project CRUD, tags, contact form, JWT admin auth, password reset) per
`PROJECT_TODO.md`, following `docs/DECISIONS.md` and the Phase 1 gotchas already logged below.
Explicitly out of scope: Phase 3 (frontend), Phase 4.

**Agent(s) used:**

Main Claude Code session, sequential single-agent (per `docs/AGENT_WORKFLOW.md` — Phase 2 has
real dependencies between checklist items, no genuine parallelism to exploit with a dispatcher).

**What went right:**

- Read all Phase 1 AGENT_LOG.md entries and the Copilot-review entry before writing code, per
  the kickoff instructions — avoided re-discovering the `saveAndFlush` timestamp trap on the
  new PUT endpoint (which the kickoff specifically flagged as likely to reintroduce it) and
  reused the existing tag upsert-by-name pattern rather than reintroducing the check-then-act
  race.
- Manual `curl` verification against a real Docker Postgres (not just `mvn test`) caught a
  genuine production bug the test suite missed — see below. Consistent with the Phase 1
  pattern where real-infra testing (Testcontainers, then manual boot) found bugs mocks
  structurally couldn't.

**What went wrong (be specific):**

1. **`SELECT DISTINCT p.id ... ORDER BY p.createdAt` — Postgres rejects it.** The tag-filter
   query (`ProjectRepository.findIdsByTagNamesIgnoreCase`) used `SELECT DISTINCT p.id FROM
   Project p JOIN p.tags t WHERE ...` to collapse a project matching multiple tags back to one
   row. Postgres requires every `ORDER BY` expression to appear in the `SELECT DISTINCT` list —
   `ProjectController` always builds a `createdAt`-sorted `Pageable`, so any tag-filtered list
   request threw `InvalidDataAccessResourceUsageException` (surfaced as a **401**, not a 500,
   for *unauthenticated* requests specifically — Spring's error dispatch to `/error` isn't
   itself permitted by the security filter chain's `authorizeHttpRequests` rules, so an
   unauthenticated caller saw a misleading 401 instead of the real 500; an authenticated caller
   saw the actual 500). The integration test for this query (`ProjectRepositoryIntegrationTest`)
   originally used an *unsorted* `PageRequest.of(0, 10)`, which never exercises an `ORDER BY`
   clause at all — it passed while the real endpoint was broken.
2. **Spring Modulith cycle: root ↔ auth.** `GlobalExceptionHandler` (root package) needed to
   catch `auth`-specific exceptions (`InvalidCredentialsException`, `InvalidResetTokenException`),
   while `PasswordResetService` (in `auth`) needed root-package shared infra
   (`ClientIpHasher`, `InMemoryRateLimiter`, `RateLimitExceededException`) — a genuine two-node
   cycle (root → auth → root), caught immediately by `ApplicationModules.verify()` in
   `ModularityTests` exactly as the Phase 1 ADR intended it to.
3. **`RestClient.Builder` autoconfiguration didn't resolve in this Boot 4.1.0 setup.**
   Injecting `RestClient.Builder` into `ResendEmailClient` (the standard, documented Spring Boot
   pattern) failed application context startup with `NoSuchBeanDefinitionException` — another
   instance of the test/autoconfig-artifact fragmentation Phase 1 already hit for
   `@DataJpaTest`. Similarly, Boot's `TestRestTemplate` convenience class wasn't resolvable
   from `spring-boot-starter-test`'s declared dependencies at all.

**How it was caught:**

Bug 1: manual `curl "GET /api/v1/projects?tag=dsp"` against a real Docker Postgres, after
`mvn test` had already gone fully green — the exact class of gap Phase 1's AGENT_LOG already
called out (tests passing ≠ endpoint working). Bugs 2 and 3: `mvn test` itself (Modulith
verification test and Spring context bean-wiring failures respectively), before any manual
verification was needed.

**Fix applied:**

1. Rewrote the tag-filter query to use an `IN` subquery (`WHERE p.id IN (SELECT p2.id FROM
   Project p2 JOIN p2.tags t WHERE ...)`) instead of `JOIN` + `DISTINCT` — no `DISTINCT` needed
   at all since the outer query is a plain `FROM Project p`. Updated the integration test to
   use the same sorted `Pageable` shape `ProjectController` actually builds, so this class of
   bug can't silently regress again.
2. Moved `InvalidCredentialsException`/`InvalidResetTokenException` out of `auth/` into the
   root package, alongside the already-root-package `ResourceNotFoundException` — modules throw
   them, only the root `GlobalExceptionHandler` catches them, so the dependency only ever runs
   one direction (module → root), matching the existing `ResourceNotFoundException` pattern.
3. Built the `RestClient` directly via the static `RestClient.builder()` factory instead of an
   injected `RestClient.Builder` bean. For the one HTTP-level security test
   (`SecurityIntegrationTest`), used `@LocalServerPort` + a plain `RestTemplate` configured with
   a non-throwing `DefaultResponseErrorHandler`, sidestepping `TestRestTemplate` entirely.

**Takeaway for next time / non-obvious judgment calls made:**

1. **An integration test's `Pageable`/query shape has to match production usage, not just be
   "a valid Pageable."** An unsorted `PageRequest.of(page, size)` in a test can pass while the
   real endpoint (which always adds a default sort) is broken — DISTINCT+ORDER BY interactions,
   in particular, only surface with an actual `ORDER BY` clause present. Prefer a small test
   helper that mirrors the controller's actual `Pageable` construction over ad hoc
   `PageRequest.of()` calls in each test.
2. **An unauthenticated request hitting a server error can surface as 401, not 500** — masking
   the real failure — because the error-dispatch path itself isn't `permitAll`'d and Spring
   Security intercepts it before the true status code reaches the client. When debugging an
   unexpected 401 on a route that's supposed to be public, retry the same request *with* a
   valid token before assuming the security config's matcher rules are wrong; the number that
   comes back (500 vs. 401) tells you which layer actually failed.
3. **Spring Boot 4.1.0's test/autoconfig fragmentation (already flagged in Phase 1 for
   `@DataJpaTest`) extends further than expected** — `RestClient.Builder` autoconfiguration and
   `TestRestTemplate` itself. Default to constructing framework objects via their own static
   factories (`RestClient.builder()`, `PathPatternRequestMatcher`, etc.) rather than assuming a
   Boot Starter registers a convenience bean, and verify with a real `mvn test-compile`/`mvn
   test` before designing further code around an assumed-available bean.
4. **A cross-cutting root-package exception type (thrown by many modules, caught only by the
   shared `GlobalExceptionHandler`) is the correct home for it — don't put it in whichever
   module happens to throw it first.** `ResourceNotFoundException` already established this
   pattern in Phase 1; `InvalidCredentialsException`/`InvalidResetTokenException` should have
   followed it from the start instead of being added to `auth/` and needing a follow-up move.

## 2026-08-01 — claude (main session): a self-introduced regression, caught by the user's own review of PR #79

**Task given:**

User reviewed PR #79 (the post-merge followups PR below) and found 2 problems with it: a real regression in the `GlobalExceptionHandler` catch-all fix, and a coverage gap in the new `SecurityConfigProfileTest`.

**What went wrong (be specific):**

**The `GlobalExceptionHandler` catch-all fix I shipped in PR #79 was itself broken.** Adding `@ExceptionHandler(Exception.class)` without extending `ResponseEntityExceptionHandler` meant it caught *everything*, including exceptions Spring's own default resolution already handles correctly — a malformed JSON body (`HttpMessageNotReadableException`, correctly 400), an unsupported HTTP method (`HttpRequestMethodNotSupportedException`, correctly 405), an unsupported media type (`HttpMediaTypeNotSupportedException`, correctly 415). All three got misreported as 500. My own PR's test plan even *demonstrated* this bug ("malformed JSON body → clean ProblemDetail 500") and I read it as proof the fix worked, without checking whether 500 was the *correct* status for that case. I traded "inconsistent error shape" for "consistent shape, wrong status code" on a request pattern (malformed bodies) that happens constantly in real traffic — arguably a worse bug than the one I was fixing, since it's silent (still returns valid-looking JSON) rather than obviously broken.

**How it was caught:** Not by me, and not by any test I wrote — by the user reading the actual `@ExceptionHandler` resolution mechanics of the code I shipped.

**Fix applied:** `GlobalExceptionHandler` now extends `ResponseEntityExceptionHandler`, overriding its protected `handleMethodArgumentNotValid` hook (same signature, not a new `@ExceptionHandler`-annotated method — declaring a second handler for a type the base class's `handleException` already lists causes an "Ambiguous @ExceptionHandler" startup failure) rather than declaring my own separately. The `Exception.class` catch-all now only ever matches what neither the base class nor my other handlers cover. Verified directly: malformed JSON → 400, wrong method → 405, unsupported media type → 415, all correctly shaped `ProblemDetail`, while a normal request and a validation failure both still behave exactly as before. Added a `@WebMvcTest`-sliced `GlobalExceptionHandlerTest` (no database needed — these are all rejected before the request would reach the service layer) so this can't silently regress again.

**Second finding (test coverage gap, not a bug):** `SecurityConfigProfileTest` only exercised `@ActiveProfiles("prod")` and `@ActiveProfiles("dev")` explicitly — the actual motivating scenario in `SecurityConfig`'s own Javadoc ("a deploy that forgets to pass `-Dspring-boot.run.profiles=prod`... still ends up locked down") had no test at all. Added a third `@Nested` class with no `@ActiveProfiles`, asserting the lockdown applies by default. Note: this is a *better* test than my own earlier manual verification of the same scenario — that manual check (`mvn spring-boot:run` with no profile flag) "passed" only because the app failed to boot entirely (no datasource configured outside dev/prod profile YAMLs), an unrelated reason. The `@Nested`-with-`@ServiceConnection` test gets a real datasource regardless of active profile, so it actually exercises `SecurityConfig`'s own `@Profile("!dev")` predicate rather than accidentally succeeding for the wrong reason.

**Takeaway for next time:**

1. **When a "before/after" test plan shows a status code changed, verify the new code is *correct*, not just *different from the raw default page*.** "No longer falls through to Boot's Whitelabel error" and "returns the right status code" are two different claims — I only checked the first.
2. **A test that reproduces the bug's own motivating scenario is stronger evidence than a test that only checks the two profiles you happened to name in code.** The no-profile gap here is the second time in this project a "the obvious two cases" test missed the actual deploy-mistake scenario the fix was meant to prevent (see the 2026-08-01 "`SecurityConfig` failed open by default, not closed" entry — the `!prod`-vs-`!dev` bug — at the end of this log).
3. Extending Spring's own `ResponseEntityExceptionHandler` rather than hand-rolling a broad catch-all is the textbook pattern here for a reason — worth defaulting to it from the start next time this shape of problem comes up, instead of arriving at it via a shipped regression.

## 2026-08-01 — claude (main session): post-merge code review followups

**Task given:**

User presented 6 code review findings (source: a review pass after PR #76 merged to main) and asked to fix the valid ones.

**What went right:**

Triaged before fixing rather than implementing all 6 blindly: 4 were real and fixed, 2 (tag-upsert batching cost, missing `Location` header) were explicitly scoped by the reviewer themselves as fine to defer, so left alone rather than gold-plating beyond what was asked.

While fixing, discovered `org.testcontainers.containers.PostgreSQLContainer` (used in the existing `ProjectRepositoryIntegrationTest` from the original Phase 1 PR) is deprecated in Testcontainers 2.x in favor of `org.testcontainers.postgresql.PostgreSQLContainer` — a real API redesign, not just a package move (the new class isn't generic anymore, so `PostgreSQLContainer<?>` / `new PostgreSQLContainer<>(...)` both fail to compile against it). Only surfaced because `-Dmaven.compiler.showDeprecation=true` was run explicitly; the default `mvn test` output doesn't show it. Fixed in both the new and pre-existing test.

**Fixes applied (each independently verified, not just re-tested):**

1. **`GlobalExceptionHandler` had no catch-all.** Added `@ExceptionHandler(Exception.class)` → 500 `ProblemDetail`, logging the full exception server-side but not echoing `ex.getMessage()` to the client (an unanticipated exception's message could contain internals). Verified with a malformed-JSON request: got back `{"detail":"An unexpected error occurred","status":500,...}` instead of Boot's default Whitelabel/JSON error page, and confirmed the real `HttpMessageNotReadableException` + stack trace landed in the server log.
2. **`Tag` had no `equals`/`hashCode`.** Added natural-key equality (case-insensitive `name`, matching `ux_tag_name_lower`) with a constant `hashCode()` (Vlad Mihalcea's recommended JPA pattern — an entity's hashCode must stay stable for its lifetime in a hash-based collection, but a natural key can be null pre-persistence). The reviewer was right that this only "worked" before by accident: within one persistence context, Hibernate's identity map returns the same Java instance for repeated loads by primary key, but a query-derived lookup like `findByNameIgnoreCase` doesn't carry that guarantee across a persistence-context boundary.
3. **No test for `SecurityConfig`'s profile behavior.** Added `SecurityConfigProfileTest` (`@Nested` classes per profile, sharing one Testcontainers Postgres) asserting prod denies `POST /api/v1/projects` (403) but allows `/actuator/health` (200), and dev's permit-all still lets requests reach validation (400 on an empty body, not 403). This is exactly the regression class from the `!prod`-vs-`!dev` bug earlier the same day (the 2026-08-01 "`SecurityConfig` failed open by default, not closed" entry, at the end of this log) — now caught by `mvn test`, not by remembering to curl it by hand.
4. **`Project.getLinks()`/`getImages()`/`getTags()` returned live internal references.** Changed to defensive copies (`List.copyOf`, `array.clone()`, `Set.copyOf`). Confirmed safe against Hibernate's dirty-checking: all JPA annotations are on the fields, not the getters, so Hibernate uses field access and never goes through these methods at all.

**Deferred (per the reviewer's own scoping, not silently dropped):**

- `resolveTags`' 2-round-trips-per-tag cost (native upsert + re-fetch) — fine at Phase 1 write volume, worth batching once it isn't.
- No `Location` header on `POST /api/v1/projects`'s 201 — blocked on `GET /api/v1/projects/{id}` existing, which is Phase 2.

**Takeaway for next time:**

`-Dmaven.compiler.showDeprecation=true` is worth running periodically, not just when something visibly breaks — it caught a real API compatibility issue (`PostgreSQLContainer`'s redesign) that `mvn test`'s default output had been silently swallowing since the original Phase 1 PR.

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

## 2026-08-01 — `SecurityConfig` failed open by default, not closed (PR #76)

> **Reconstructed 2026-08-07 from evidence, not written live.** This one never got an entry at the
> time, even though three places already refer back to it as if it had: `CLAUDE.md`'s "Security
> defaults" rule, and the "`!prod` vs `!dev`" cross-references in the two PR #79 entries above.
> Sources used, all still checkable: commits `6453007` and `e5f07ef` (messages + diffs), the PR #76
> review threads on `SecurityConfig.java` (`gh api repos/tarka1939/My_Site/pulls/76/comments`), and
> the current `SecurityConfig` source. Nothing here is recalled. Where the record is silent, this
> entry says so instead of filling the gap in.

**Task given:**

Not recorded. The trigger the evidence does show: a GitHub Copilot *follow-up* comment on PR #76's
`SecurityConfig.java` review thread, posted 2026-08-01 11:59:59Z — roughly 12 minutes after the fix
for that thread's *original* comment had been pushed and replied to.

**Agent(s) used:**

GitHub Copilot as reviewer (a second comment on the same file/thread); main Claude Code session as
author/responder — the same pairing as the rest of the PR #76 review round logged above.

**What went wrong (be specific):**

`SecurityConfig`'s permit-all filter chain was annotated `@Profile("!prod")`. That predicate is
active for *anything* that isn't literally the `prod` profile — including the default, no-profile-set
case. A run that forgot `-Dspring-boot.run.profiles=prod` got `anyRequest().permitAll()` with no auth
of any kind, since Phase 2's real JWT work hadn't landed yet.

The part worth keeping is where it came from: **this fail-open default was introduced by the fix for
an earlier fail-open finding on the same file, ~25 minutes earlier in the same review round.**
Copilot's original comment (11:01:10Z) flagged that the single `permitAll()` chain applied in every
profile, prod included. Commit `6453007` ("Harden SecurityConfig: deny by default in prod, permitAll
only outside it", 11:46:45Z) fixed exactly that, splitting it into `@Profile("!prod")` permit-all and
`@Profile("prod")` deny-all-but-`/actuator/health` — and verified it by booting under `dev` and under
`prod`, both of which behaved correctly. Two profiles were named in the code, those same two profiles
were tested, and the case the split had just created — no profile named at all — fell through the gap
between them. The response on the thread (12:11:57Z) names it directly: "a genuine regression in the
previous fix, not a restatement of the original finding."

**How it was caught:**

By Copilot's follow-up review comment, quoted here in full because it is the entire record of the
catch:

> `@Profile("!prod")` makes the permit-all chain active for the default profile (and any non-`prod`
> environment), so an accidental deploy without `prod` explicitly enabled would expose all
> endpoints. To actually "fail closed" unless explicitly running `dev`, scope permit-all to `dev`
> only and apply the deny-all (except health) chain for all non-dev profiles.

Nothing in the build was capable of failing on it — both chains compile, both wire up, the app boots.
There was no test on `SecurityConfig`'s profile behavior at all at this point; the first one
(`SecurityConfigProfileTest`) came later, in PR #79 — see "post-merge code review followups" above.
It no longer exists: Phase 2's real-JWT rewrite removed the profile split entirely, so the test's
premise went with it and it was deleted at the PR #79 → PR #77 merge (see "Merging PR #79 into
PR #77" above). Don't go looking for it in `backend/src/test`.

**Fix applied:**

Commit `e5f07ef` inverted the polarity: permit-all became opt-in via `@Profile("dev")`, and
`@Profile("!dev")` — prod, any other profile, or none at all — got the locked-down chain. The class
Javadoc was rewritten to record the inverted-predicate mistake explicitly rather than only describing
the new behavior, so the next reader sees the trap and not just the result.

Verified by booting all three cases (per the commit message and the thread reply): `dev` → `POST
/api/v1/projects` 201; `prod` → 403; no profile at all → the app fails to start, because no datasource
is configured outside the dev/prod profile YAMLs. That third check is weak evidence and was flagged as
such on the thread at the time — it's fail-closed for an unrelated reason. The PR #79 entry above
sharpens the same point: `SecurityConfigProfileTest`'s no-`@ActiveProfiles` case is a real test of the
predicate precisely because `@ServiceConnection` hands it a datasource regardless of profile, so it
cannot "pass" by failing to boot.

**Takeaway for next time:**

- **A fix for a fail-open bug can ship a different fail-open bug**, and the review round that found
  the first one is where the second is least likely to be scrutinized — the finding already reads as
  "closed." This project hit the general form of that twice more afterwards: PR #79's
  `GlobalExceptionHandler` catch-all regression, and the rate-limiter key collision introduced while
  fixing a reviewer's finding on PR #77. A fix earns the same scrutiny as original code, not a pass
  for being a fix.
- **Naming two profiles in code does not mean there are two cases.** `@Profile("!x")` is a *default*,
  not a branch. When a config predicate is written as a negation, the first case to test is the one
  nobody named.
- **The absence of configuration deserves its own test case.** `CLAUDE.md`'s "Security defaults" rule
  and `PROJECT_TODO.md`'s Definition of Done both trace to this.

**Deliberately not reconstructed:** what the session was actually asked to do, and anything about how
the problem was noticed beyond the review comment itself — the record doesn't say, so this entry
doesn't either. Two things that *are* checkable and worth stating so nobody infers worse: the
`@Profile("!prod")` state existed for about 25 minutes on the PR branch only, and `e5f07ef` is an
ancestor of PR #76's merge commit (`752965c`), so `main` never had a tree in that state. There was
also no deployment target at Phase 1 — hosting is Phase 5 — so the practical blast radius was zero.
