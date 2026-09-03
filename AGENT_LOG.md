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
  **Correction 2026-08-29:** "linked nothing since Phase 1" is right for #76, #77 and #79, which
  were already merged and stay unlinked. #80 was still open, was repaired, and closed all ten of
  its issues on merge. Both causes recorded here are real — a 2026-08-27 note elsewhere briefly
  claimed the comma cause was never observed locally, which was itself wrong; see
  `docs/AGENT_WORKFLOW.md`'s closing-keyword section.
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

- **A server validation error was reported, received, stored, and displayed nowhere.** The API reports
  a violation inside a collection under the element's key (`links[0].label`, `images[0]`, `tags[2]`);
  the admin form matched only flat keys; and `errorInterceptor`'s three branches (401-while-logged-in,
  rate-limited, *no* field errors) mean a 400 **carrying** field errors takes none of them, so no
  toast fires either. A link label past the server's `@Size(max = 50)` — a limit the client control
  does not check — made **Save do nothing and say nothing**. Every layer behaved as written; the
  message fell through the seams between them. **Fixed** by looking rejections up under the indexed
  key the server actually sends, with a leaf-key fallback so a `tags[i]` violation lands on the single
  comma-separated tags control. Found by cold review of the PR that existed to eliminate exactly this
  appearance. *(2026-08-15, "Admin form (#92)" — PR #105.)*

- **A test runner printed a passing summary and an error count on the same run, and the grep reading
  it showed only the first.** Vitest emitted `Tests 41 passed` alongside `Errors 1 error` (an
  unhandled RxJS error). The filter in use — `grep -E "Test Files|Tests |FAIL"` — matches neither
  `Errors` nor `Unhandled`, and being applied to a *pipe* it also discarded npm's exit status. A
  mutation that had actually been caught read as a survivor. **Fixed** by redirecting the run to a
  file, grepping that for `Errors` and `Unhandled` as well, and reading the real exit code. Found by
  a dispatched agent checking its own mutation result, and the same hole was live in the Senior Dev's
  command for the whole session. *(2026-08-15, "Admin form (#92)" — PR #105.)*

- **Text crossed a process boundary and arrived as a different string, and the hash of it was
  perfectly valid.** PowerShell 5.1 pipes to native commands in the console codepage *and* emits a
  UTF-8 BOM preamble, so node received `U+FEFF` prepended to every password and accented characters
  as `?`. bcrypt then hashed exactly what it was given and reported success; the only symptom was a
  401 two steps later, which looked like a wrong password. Hashing *and verifying* inside node would
  also have passed — it would faithfully round-trip the same corrupted string. **Fixed** by setting
  `$OutputEncoding`, stripping a leading BOM in node, and — the part that generalises — having node
  report back the character count it received so the caller can compare across the boundary.
  *(2026-08-17, "Three defects only a browser could see" — no PR; a local helper script.)*

**Lesson:** "it ran and didn't complain" is not evidence it did anything. For anything whose success
is invisible (issue linking, migrations, merges), verify the *effect* directly, not the exit code.
The **deprecation-warnings** bullet is the near-miss variant and is worth separating out: sometimes
the tool *did* complain, into output nobody was reading because the summary line said green. The
**vitest-grep** bullet is that variant's sharper form — the tool complained in the same summary block
the reader was already reading, a line or two from the count they were checking, and the filter
dropped it.

### 5b. Defects no test can see, because the DOM is correct

- **An error colour at 2.87:1 on the dark canvas.** Every error message on the site, including the
  public contact form, against WCAG AA's 4.5:1. Light mode was fine at 6.54:1, so it failed only in a
  theme that is shipped and never rendered during review. Every other colour in the app had been
  flipped per scheme with the ratio recorded in a comment; this was the one that was not.
- **Developer-facing strings shown to visitors.** `Your message was not sent: honeypot must not be
  blank` — a raw backend field key and a raw Bean Validation default, on the public contact form.
  Every test asserted the text was present; none could judge whether it should be.
- **E2E scaffolding in the public tag filter.** `e2e-alpha`, `e2e-beta` and four more with zero
  projects behind them, offered as filter options on the landing page. Obvious on screen, invisible
  to a suite that only asserted the filter renders.

**Lesson:** these are not testing gaps that better assertions would close. In all three the DOM was
exactly right and something else was wrong — a colour value, an audience, a stale row. The check is to
render it and measure: contrast against the *resolved* canvas, copy read as its actual reader would
read it, lists inspected for what is actually in them. Note also that `textContent` concatenates
`aria-hidden` and `visually-hidden` siblings and so can report text no user ever perceives, which is
its own way of looking wrong while being right.

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

## 2026-09-03 — #186: the contact form notified nobody, and the fix had a documented way to go wrong

**Task given:** Implement issue #186 — publish a domain event from `ContactService.submit` and email
the owner via the existing `ResendEmailClient`, with the destination in a new environment variable.
The brief named the constraint up front: notification is best-effort, persistence is not.

**Agent(s) used:** backend-agent (Opus), in the `My_Site-notify` worktree on
`feat/contact-notification`.

**What went right:**

The brief pointed at `PasswordResetService.requestReset` and the 2026-08-01 entry above *before*
asking for a design, and that is the reason this entry has no bug in it. That entry records
`resendEmailClient.sendPasswordResetEmail(...)` running uncaught inside a `@Transactional` method,
so a non-2xx from Resend propagated out and changed the HTTP response. The same shape was available
here and would have been worse: the visitor's message is the product, and losing one because a third
party had a bad minute is the worst outcome the feature has. Naming the prior incident in the brief
turned "design an event listener" into "do not reproduce this specific failure", which is a much
easier instruction to follow.

**What went wrong (be specific):**

Nothing that reached a commit, but two judgement calls are worth recording because neither was
forced by the brief and both could reasonably have gone the other way.

1. **`ResendEmailClient` lived in `auth/`, and `contact` needed it.** The tempting move was to
   inject it as-is. `ApplicationModules.verify()` would have **passed**: the class sits in the auth
   module's base package, which makes it part of that module's public API, so a `contact → auth`
   dependency is legal. It is also false — email delivery has nothing to do with authentication, and
   the graph would have said the contact form depends on the login system. This is a case where the
   enforcement test cannot be the thing that catches the problem, because the problem is not a
   violation. Moved the class to the application's base package instead, where `ClientIpHasher` and
   `InMemoryRateLimiter` already live for the identical reason: shared infrastructure that outgrew
   one module. No new Modulith module was introduced.
2. **The event carries the submission, not just the id.** `ProjectCreatedEvent` is the precedent and
   carries only a `UUID`. Copying it would have meant re-reading the row in the listener, after the
   commit — a read the admin can race by deleting the message, silently losing the notification for
   the one message the owner most needs. `CLAUDE.md`'s concurrency rule says accepting a race is a
   legitimate answer and not noticing one is not; here the race was avoidable outright, so it was
   avoided rather than accepted. The cost is that the event holds visitor PII, which is fine in
   memory and would **not** be fine if `spring-modulith-events` durable publication is ever adopted
   (`docs/DECISIONS.md` still lists that as undecided). Written on the event's javadoc so the
   trade-off is visible at the point where it would change.

**How it was caught:** Neither by a test. Both were design decisions taken before code, prompted by
re-reading the Modulith ADR and `CLAUDE.md`'s concurrency checklist rather than by anything the
build could report. The Modulith one is the more interesting: a green `ApplicationModules.verify()`
is evidence about *legality*, not about whether the dependency graph describes the system honestly.

**A third thing, found by mutation testing after the work looked finished.** Three mutations were
run against the committed listener:

| Mutation | Result |
|---|---|
| Synchronous `@EventListener` (in-transaction), catch kept | **all tests passed** |
| Synchronous, in-transaction, catch removed — the `requestReset` shape exactly | integration test failed, `expected: 201 CREATED but was: 500`; the listener unit test failed too |
| `@Async` removed, `AFTER_COMMIT` and the catch kept | **all tests passed** |

The two passes are the finding. The suite as first written could prove the message survives a
Resend failure, and could not prove the send was off the request thread at all — so a future edit
dropping `@Async` would have been invisible, and a hanging Resend call would have hung the visitor
while every test stayed green. The catch is load-bearing enough to mask its own siblings.
`slowResend_doesNotHoldTheVisitorsResponseOpen` was added to close that: it blocks the stubbed
client on a latch for 30 seconds and asserts the 201 comes back in under 10. Re-run against the
`@Async`-removed mutation, it fails after the full 30. That test exists because the mutation run
happened, not because anyone thought of the case while writing the feature.

**Fix applied:**

- `ContactMessageReceivedEvent` published from `ContactService.submit` inside the transaction, so
  Spring holds it to `AFTER_COMMIT` and drops it entirely on rollback.
- `ContactNotificationListener`: `@TransactionalEventListener(phase = AFTER_COMMIT)` plus
  `@Async("taskExecutor")` — the executor `AsyncConfig` has provisioned unused since Phase 1, whose
  javadoc said the DSP demo would be its first consumer; this is. It catches its own
  `RuntimeException`s and logs.
- `CONTACT_NOTIFICATION_EMAIL`. Absent is a designed no-op (warn, skip, message still saved and
  still 201); present-but-malformed throws from the listener's constructor and the app refuses to
  start. Both halves of `CLAUDE.md`'s config-validation rule are in play in one variable, and the
  comment says which is which. No default address, and deliberately not an RFC 2606 `.invalid`
  placeholder either: a placeholder that *parses* would make every environment attempt a send to a
  domain that cannot receive, which reads as a delivery bug rather than as "nobody configured this".
- Visitor content in the email is escaped where it is interpolated. The body is HTML-escaped
  (escape first, *then* introduce `<br>`, or a visitor's typed `<br>` survives). The subject has all
  control characters stripped, because it is the one value that becomes a MIME header — Jackson
  would encode a newline safely into the JSON request, but it would arrive at Resend as a literal
  newline in a value bound for `Subject:`, which is the classic header-injection primitive.
- Nothing about the visitor is logged at **any** level — not DEBUG either. The message UUID is
  logged instead, and it points at a row the admin panel already shows.

**Takeaway for next time:**

- **A brief that names the prior incident is worth more than a brief that names the rule.** "Do not
  call a third party inside the transaction" is a rule anyone would agree with and still violate;
  "`requestReset` did exactly this on 2026-08-01 and here is what broke" is not.
- **`ApplicationModules.verify()` passing is not the same as the boundary being right.** Types in a
  module's base package are its API, so the test is silent about whether a legal dependency is a
  sensible one. The verify test catches reaching into internals; it cannot catch a module depending
  on the wrong module correctly.
- **A no-op reference implementation sets a precedent it was never load-tested for.**
  `ProjectCreatedEventListener` logs and returns, so `ProjectCreatedEvent` carrying only an id has
  never had to survive the row being deleted. The first real listener is where that assumption gets
  tested, and copying the shape without re-deriving it would have shipped the race.

**Test count:** 235 → 253. The 18 added break down as 9 on `ContactNotificationListener` (4 on
escaping and header sanitisation, 2 on its config validation's two halves, 3 on the happy, degraded
and throwing paths), 3 on `ResendEmailClient` (unconfigured-key degrade, PII silence, and one
re-asserting that the reset link stays off WARN across the package move), 2 on the
publish/don't-publish split in `ContactService`, and 4 end-to-end. The end-to-end class is
deliberately **not** `@Transactional`: a rolled-back test can never fire an `AFTER_COMMIT` listener
and would have passed while asserting nothing.

## 2026-09-03 — #178: the obvious way to write this test would have asserted against the wrong environment file

**Task given:** add a test that reads the real `frontend/src/index.html` and asserts its
`preconnect`/`dns-prefetch` hints for the backend agree with `apiBaseUrl` in
`frontend/src/environments/environment.ts`. The subdomain moved twice in Phase 5, both times by hand
in both files, and PR #175 exists because one of those edits was missed.

**Agent(s) used:** one frontend agent on **Opus** in the `phase5/host-agreement-test` worktree — new
application code, which `CLAUDE.md` puts on Opus by default.

**What went right:** the brief's demand to break the test deliberately before committing was worth
more than the test-writing. Five break scenarios were run, not one: stale host in `index.html`,
stale host in `environment.ts`, the API `preconnect` deleted while an unrelated one remained, and
`crossorigin` dropped. The third is the one that mattered — it is the check that the test is not
passing vacuously off some *other* origin hint, and only a deliberate break can distinguish it from
a real pass.

**What went wrong (be specific):** the natural implementation — `import { environment } from
'../environments/environment'` and compare against `new URL(environment.apiBaseUrl).origin`, which is
literally what issue #178 suggests — reads the **development** environment under `ng test`, not the
production one. angular.json's `development` build configuration carries a `fileReplacements` entry
swapping `environment.ts` for `environment.development.ts`, and the unit-test builder applies it. So
inside a spec that import yields `production: false, apiBaseUrl: '/api/v1'`. There is no import
specifier that reaches the production file, because the replacement is keyed on the *resolved path*,
not the specifier.

This would not have failed loudly in a useful way. `new URL('/api/v1')` throws, so a first cut would
have looked like a broken test rather than a wrong one, and the tempting repair — guard the throw,
or skip when `apiBaseUrl` is relative — produces a test that passes everywhere and checks nothing.
That is the exact failure mode the issue was filed about, reproduced one level up: a hint nobody
verifies, replaced by an assertion nobody verifies.

**How it was caught:** not by reasoning about it. Before writing anything, a throwaway spec was run
that force-failed on `expect(\`prod=${environment.production} url=${environment.apiBaseUrl}\`)`, purely
to see the value the runner actually resolves. It printed `prod=false url=/api/v1`. Vitest swallows
`console.log` from a passing test here, so a deliberately failing assertion was the cheap way to read
a value out of the runner.

**Fix applied:** `frontend/src/api-origin-hints.spec.ts` reads *both* sides off disk —
`environment.ts` as text, with comments stripped and exactly one `apiBaseUrl` declaration required,
plus an assertion that the parsed source really says `production: true` so a path mishap onto the
development file cannot make the rest vacuous. `index.html` is parsed with `DOMParser` (available in
this jsdom runner) and queried by `rel`, rather than regexed, so the existing font `preload`s and any
future font-CDN `preconnect` neither break it nor satisfy it. Comparison is origin-to-origin, so a
trailing slash or path on a hint is not a false failure. Failure messages name both values and both
files, since the entire point is telling the reader which of the two copies is stale.

**Takeaway for next time:**

- **`fileReplacements` applies under `ng test`, so `environment` in a spec is the development one.**
  Worth knowing well beyond this test: `error.interceptor.spec.ts` already imports `environment` and
  is fine only because it uses it to *derive* a URL it then matches against itself. Any spec that
  asserts something about the deployed configuration has to read the file, not import it.
- **A test whose subject is "two files must agree" must read both files.** Importing one and
  hardcoding the other is the same defect the test is for, moved.
- **Print the value; do not infer it.** The cost of the throwaway force-failing spec was about a
  minute, against a wrong test that would have passed review because it matches the issue's own
  suggested shape.

## 2026-09-03 — The first real deployment, and four times the runbook was wrong about the machine in front of it

**Task given:** execute `docs/DEPLOYMENT.md` against a freshly provisioned VPS, with the Senior Dev
holding SSH and the owner holding sudo. Backend live at `https://tarka1939.bieda.it` by the end.

**Agent(s) used:** one backend agent on Opus for #44/#168, one frontend agent for the host wiring,
and four cold reviewers. The interesting failures are all the coordinator's.

**What went right:**

**The reviews found things no gate could.** Every defect below was caught by a reviewer or the
owner, none by a passing test. Both suites stayed green throughout — 235 backend, 341 frontend —
including while the runbook was telling an operator to do impossible things.

**Proving the path before deploying onto it.** A throwaway `python3 -m http.server 8080 --bind ::`
established DNS, the provider's proxy, TLS, the port mapping and the firewall as one unit, before
the app existed. When the real deploy later 404'd, that separation was what made it cheap to
diagnose.

**What went wrong (be specific):**

**Four times, the document described a machine other than the one in front of it.** Each was
plausible, each cost real time, and the pattern is the finding rather than any one instance:

- **§4.8 prescribed Caddy and Let's Encrypt on ports 80 and 443.** Those ports belong to the
  provider on a shared-IP host and answer with its certificate. Neither ACME challenge can work.
- **§4.2 said port 8080 must never be open.** True for a reverse proxy on the same box, false for a
  provider proxy that connects across the network — and the symptom is a *timeout*, which reads like
  anything except a firewall.
- **§4.4 predicted Java 25 would be unpackaged on Ubuntu 24.04.** It is packaged, at the exact build
  the project compiles with.
- **§4.7a told the operator to create swap.** An unprivileged LXC container cannot enable swap;
  `swapon` fails with `Operation not permitted`. This one is the worst of the four, because
  `systemd-detect-virt` had reported `lxc` in the *first survey run on the box*, and the section was
  written afterwards anyway.

**The same secret-handling mistake, in three sections, fixed one at a time.** §4.3 used psql's
`\password` prompt specifically so a credential never reaches a command line. §4.6 then had the
operator paste the database password into a heredoc. Corrected — and §6 was still pasting the admin
password into an `UPDATE`. The operator reported it twice, in two different sections, having already
reported the first. A principle applied in one section and not carried across the file is not a
principle, it is a coincidence.

**A correction that made a rule worse.** `CLAUDE.md`'s API-client check was changed from
`git status --porcelain` to `git diff --numstat` to dodge a CRLF false positive. `git diff` compares
the working tree to the *index*, so a newly generated model or service file — the exact shape of a
stale client — is invisible to it. Measured: 0 rows for a new file where `status` shows 1. The rule
now reads `git add -A && git diff --cached --numstat`.

**Committing before reading a gate.** Pushed a commit and only then looked at `TEST_EXIT=1`, having
deleted the log in the same command. The failure was environmental (a fresh worktree with no
`node_modules`, so `ng` did not exist) but that was not known at push time. "Nothing merges on a
report" is in `README.md` in the coordinator's own words.

**Diagnosing an outage on a hostname that had been retired.** Built a firewall theory out of a 404,
complete with a suspect and a remediation, without checking that the host still existed. The blocked
port that "proved" it was the operator's own firewall tightening working exactly as designed.

**A conflict resolution that silently ate work.** `git checkout --theirs -- <path>` takes the entire
incoming file, not the conflicted hunk, so every cleanly auto-merged change on that branch went with
it. The merge committed, the tree was clean, nothing errored. Caught only by grepping for content
that should have been present.

**How it was caught:** the owner, for the three secret-handling repeats and the missing swap section;
cold reviewers for everything else. Notably the reviewer that checked the live host rather than the
diff caught four documents claiming the deployed jar lacked CORS while a preflight against that jar
was answering correctly.

**Fix applied:** each section corrected in place with the original claim left visible, since the
wrongness is the useful part. `docs/DECISIONS.md` gained an ADR for the exposure decision and a
correction to its own count of where the backend host appears — it said three places and named the
wrong third, omitting the one that breaks the deployed site.

**Takeaway for next time:**

- **A runbook is a claim about a specific machine.** Every one of the four errors was a general
  truth applied to a host it did not describe. `systemd-detect-virt` costs nothing and would have
  caught two of them before either was written.
- **Carry a principle across the whole file the moment you apply it once.** Three sections handled
  credentials three different ways, and the inconsistency was visible on the page.
- **A fix to a rule needs the same adversarial reading as a fix to code.** The `--numstat` change
  looked strictly better and was strictly worse on the case that mattered.
- **Verify the premise before diagnosing from it.** Checking that a hostname still resolves is
  cheaper than any theory built on the assumption that it does.


## 2026-09-03 — #44 and #168: the header that carries the truth is not the one at either end of the list

**Task given:** Implement CORS (#44) and the conditional forwarded-header client IP (#168) on
`phase5/behind-a-proxy`, off `6a54831`. Backend only.

**Agent(s) used:** backend-agent (Opus) — auth, shared mutable state and a trust boundary, all on
`CLAUDE.md`'s "Opus regardless" list.

**What went right:** `ClientIpResolver` reads a forwarded address only when the request's immediate
peer matches a configured trusted proxy, and returns `getRemoteAddr()` in every other case,
including "no configuration at all" — so the pre-#168 behaviour is what an unconfigured environment
still gets. **235 tests, up from 202** — the entry first said 231, which was true when it was written and stale two commits later; a count is a fact with a timestamp, so it gets re-read at the end rather than carried forward.

**What went wrong (be specific):** two things, neither of which a first pass would have flagged.

1. **The obvious `X-Forwarded-For` rules are both wrong for this chain.** The deployed shape is
   `visitor → Cloudflare → Mikrus nginx → app`, so the header arrives as
   `[anything the visitor invented..., visitor, cloudflare-edge]`. Taking `entries[0]` — the rule
   most examples show — reads a value the caller supplied, and hands unlimited rate-limit evasion to
   anyone willing to change it per request. Taking `entries[length - 1]` reads a Cloudflare edge
   node, which buckets the whole internet into a handful of addresses and is nearly the bug being
   fixed. Neither end is the answer; the visitor is the *N*th entry counted **from the right**,
   where *N* is the number of proxies in front. Counting from the right is what makes it
   unforgeable — a caller can only prepend, and prepending does not move the right-hand end.
2. **Tomcat's `RemoteIpValve` cannot express this**, so `server.forward-headers-strategy` was the
   wrong reach even though issue #168 itself suggested `NATIVE`. Its rule is "walk from the right,
   discard entries matching `internalProxies`, take the first that does not match" — which stops at
   the Cloudflare edge address unless every Cloudflare range is in the trusted set. That list is
   large, changes, and is not something this app can keep current. It also rewrites `getRemoteAddr()`
   and the scheme/host used to build URLs for every request, a far wider blast radius than two rate
   limiters need.

**How it was caught:** by working out what this specific chain produces instead of applying a
general rule, and then by mutation testing. Two mutations that a "take the first element"
implementation would have passed — `index := 0` and `index := entries.length - 1` — each fail
`multiEntryForwardedFor_resolvesToTheEntryCountedFromTheRightNotEitherEnd` and the contact-form
integration test that asserts the stored `requester_ip_hash` is the middle entry and not the other
two.

One mutation **survived** on the first pass and had to be fixed: disabling the negative
`trusted-hop-count` guard still threw, from a *different* validation whose message also contains the
string `trusted-hop-count`, so `hasMessageContaining` passed for the wrong reason. The test now
configures the case so only that guard can fire, and asserts on `"must not be negative"`. This is
the same failure mode as the 2026-08-27 entry below: an assertion that measures something adjacent
to what it claims.

**Then cold review of PR #172 found a third instance of that same shape, in a test I had already
mutated.** `forwardedAddressIsCanonicalised_soOneAddressIsNotTwoBuckets` asserted only
`assertThat(compressed).isEqualTo(expanded)` — neither side pinned to anything. Make the resolver
ignore the header and return the peer address for both, and the two results are still equal, so a
test named for buckets passes having verified nothing about buckets. My own mutation round missed it
because I mutated the *canonicalisation* (which the test does detect) and never the *header read*
(which it did not). Both sides are now pinned to `"2001:db8:0:0:0:0:0:1"`, and disabling the header
read fails it.

Three times in one session stops being bad luck: **an assertion comparing two computed values to
each other, with neither pinned to an expected constant, is the recurring defect.** The general form
— "does this assertion still fail if the feature is inert?" — is the question to ask of every
equality assertion, rather than a thing to rediscover per test.

Review also found a real fail-open that the whole constructor-validation exercise had missed: `/0`
passed `matcherFor`, because the range check rejected only a prefix length `< 0` or `> maxPrefix`. A
`/0` is `"*"` in another notation — every caller becomes a trusted proxy, so a forged header is a
total, silent bypass, from one env-var typo and with no startup complaint. The asymmetry is the
tell: `parseAllowedOrigins`, in a file I edited in the same session, refuses `"*"` with a comment
about "a silent downgrade to the exposure this allowlist exists to prevent", and I did not carry
that same reading across to the CIDR notation for the same idea. Review measured the consequence on
the real matcher instead of reasoning about it: `0.0.0.0/0` matches IPv6 peers, so "we are IPv6-only,
a v4 /0 is inert" would have been wrong. There is now a test driving `IpAddressMatcher` directly to
record that.

**Fix applied:**

- `ClientIpResolver`, a new root-package component, with three properties under
  `app.forwarded-headers`: `trusted-proxies` (CIDRs of peers allowed to speak for a client),
  `client-ip-header` (a single-valued header set by the outermost proxy — `CF-Connecting-IP` in
  prod, preferred because it needs no position arithmetic), and `trusted-hop-count` (2, the
  right-hand index into `X-Forwarded-For`). `ClientIpHasher` delegates to it and keeps only the
  don't-store-a-raw-address job.
- All three are off in the base `application.yml` and set only in `application-prod.yml`, so dev,
  test and no-profile keep today's behaviour.
- Config that is *absent* degrades; config that is *present but wrong* fails at bean creation — a
  malformed CIDR, a negative hop count, a header named with no trusted proxy to have set it, or a
  trusted-proxy list with nothing configured to read a header. The last two are the interesting
  ones: both are harmless at runtime, which is exactly why they need to fail loudly. They look
  configured and do nothing.
- CORS as an exact-match allowlist from `app.cors.allowed-origins`, wired via
  `.cors(Customizer.withDefaults())` inside the security filter chain so a credential-free preflight
  is answered before authorization would 401 it. Not `allowedOriginPatterns`: a pattern such as
  `https://*--<site>.netlify.app` would admit a deploy preview built from a fork's pull request,
  i.e. arbitrary third-party JavaScript on an origin this API answers. There is a test that says so.
- The CORS integration tests needed a second `RestTemplate` on the JDK HTTP client.
  `HttpURLConnection` silently drops `Origin` and `Access-Control-Request-Method` — they are on its
  restricted-header list — so a CORS test written on the existing `SimpleClientHttpRequestFactory`
  client sends no preflight at all and measures nothing. That is the "a test that cannot fail on the
  thing it names" shape from the index above, met head-on rather than after the fact.

**Takeaway for next time:**

- **A general rule for reading a proxy header is not a rule for *your* chain.** How many proxies,
  and whether each appends or overwrites, decides which element is the truth. Write the observed
  header down before choosing an index.
- **Both halves fail safe or neither is worth having.** A request from an untrusted peer keeps its
  own address; a list shorter than the hop count falls back rather than settling for a nearby
  element; missing config means the old behaviour. Unconditional trust would have been worse than
  the bug it fixes, because a forged header defeats rate limiting outright instead of globalising
  it.
- **Config that silently does nothing deserves a startup failure**, not just config that is
  malformed. "Trusted proxies set, nothing configured to read a header" boots fine and leaves both
  limiters collapsed — indistinguishable from working, from outside.
- **A fix can flip the direction of a known residual risk, and that has to be said out loud.** The
  Cloudflare bypass was disclosed accurately and its *consequence* was not: before this change such
  a caller shared the global bucket and was still capped at 5 logins per 15 minutes; after it, a
  fresh `CF-Connecting-IP` per request means unlimited guessing against the single admin account.
  Disclosing a risk is not the same as disclosing what you did to it.
- **Neither this nor the firewall closes a Cloudflare bypass.** A caller who reaches the Mikrus node
  directly with the right `Host` arrives from a trusted peer and can forge either header. Both
  mechanisms are equally exposed to it, which is why offering the second cost nothing. That is an
  ingress concern; it is written down on `ClientIpResolver` rather than left for someone to discover.

## 2026-09-02 — Wiring the real hosts (#89): the regenerate that provably could not change anything, and checking that rather than asserting it

**Task given:** replace the `TBD-vps-host` placeholders now that the backend has a real public host
(`https://tarka1939.tojest.dev`, a Mikrus VPS subdomain fronted by Cloudflare), and close #89 by
adding a `<link rel="preconnect">` to the API origin. Worktree `My_Site-hosts`, branch
`phase5/wire-the-hosts`, based on `6a54831`. No PR, no push, `/backend` untouched.

**Agent(s) used:** one frontend agent, own worktree. Frontend suite 341 → 341 (no behaviour change).

**Judgment calls worth recording:**

**The regenerate was run twice, and the first run is the one that mattered.** `CLAUDE.md` says to
regenerate from the *unmodified* spec first so pre-existing drift is not absorbed into this commit.
Doing so flagged `frontend/src/app/core/api/.openapi-generator/FILES` as modified — which looks
exactly like the stale-client problem PR #129 shipped. It was not: `git diff --numstat` returned
zero rows, and `.gitattributes` (`* text=auto eol=lf`) with `core.autocrlf=true` explains it — the
generator writes CRLF on Windows, git normalises to LF, so the content is identical. Reverted and
re-run after the spec edit, with the same result. **`git status --porcelain` is not by itself
evidence of a content change on this repo when running the generator on Windows; `--numstat` is.**

**A `servers:` edit provably cannot change the typescript-angular client, and that was verified
rather than assumed.** The brief was right to insist on the regenerate anyway — the generator inlines
`summary`/`description` into JSDoc, which is why a description-only edit once produced a real diff.
But the *production* `servers:` entry is a different case: it never reaches the client. **Be precise
about this, because the point of recording it is to guide the next contract edit** — the generator
*does* embed the **first** `servers:` entry, as a compile-time fallback
(`api.base.service.ts`: `protected basePath = 'http://localhost:8080/api/v1'`), so editing *that*
one would change the client. Only the second, production entry is inert, because `basePath` is
runtime-injected through `provideApi(environment.apiBaseUrl)` in `app.config.ts`, and the only
`basePath` assignment in `configuration.ts` is from its constructor argument. So the empty diff here
is a confirmed property, not a lucky result. Recording it so the next contract edit does not have to
re-derive which parts of the spec reach the client.

**`crossorigin` on the preconnect, and the `Authorization` header is not the reason.** The brief
asked whether the bearer token forces `crossorigin`. It does not — that header is an ordinary
request header, not browser-managed credentials, and does not set the request's credentials mode.
What decides the socket pool is `withCredentials`, and nothing sets it: `provideApi()` is called with
a bare base URL, so `Configuration.withCredentials` stays undefined and every API call goes out
anonymous. A preconnect *without* `crossorigin` warms the credentialed pool, which those calls would
then never touch — so `crossorigin` is required, for a reason unrelated to the one proposed. The
token does make admin requests non-simple and therefore preflighted, which strengthens the case: the
OPTIONS preflight is then what pays for the handshake.

**`dns-prefetch` was added as an honest no-op.** In any browser that supports preconnect it is
ignored for an origin already being connected to. It earns its line only as a fallback for something
that supports resolution hints but not preconnect, and the comment says so rather than implying a
second win. Also noted in the comment: `index.html` is not swapped per build configuration, so under
`ng serve` — where `apiBaseUrl` is relative and proxied — this is one speculative handshake that goes
unused. Accepted rather than templating `index.html`.

**The README says less than it could.** The host was confirmed serving TLS with a valid certificate;
that is not the same as the API being up, and no Netlify site exists. So the Status section says the
backend host exists and the frontend is not deployed, and the Live URL line says "none yet" instead
of quietly becoming a link nobody can open. The literal placeholder string was also kept *out* of the
new prose, so that grepping for it keeps returning only genuinely stale locations.

**Left deliberately undone:** `docs/DEPLOYMENT.md` still names the placeholder in three places
(the config table, and steps 3-4 of the unpause runbook). Out of scope for this brief and reported
upward rather than edited — but it is now a runbook instructing someone to make a change that has
already been made, which is the kind of staleness `CLAUDE.md`'s "Keeping docs current" is about.
`PROJECT_TODO.md`'s Phase 5 status is untouched for the same reason.

## 2026-08-27 — #156: the mutation list I wrote tested the key being too broad and never too narrow

**Task given:** a card whose image fails to load shows an empty plate, because the media slot chose
generated artwork on `@if (project.images.length > 0)` — whether an image was *specified*, never
whether one *arrived* (#156). Shipped as PR #158. Frontend 329 → 337 tests.

**Agent(s) used:** one frontend agent on Opus in its own worktree, resumed twice — once after a
session-limit termination that killed it before its first tool call — and one cold reviewer on Opus
against a detached worktree. Resuming rather than restarting was right both times: the second resume
carried the whole implementation context into a five-item fix list that would otherwise have needed
re-deriving.

**What went right:**

**The brief's three named traps all held.** `(error)` as the only signal (no `naturalWidth` polling,
no timeout — both fire on an image that is merely *slow*); the fixed slot height, so a post-error
swap cannot move a row; and the LCP image's asserted attribute *ordering*, which the reviewer could
then explain rather than merely confirm — static attributes and `ɵɵlistener` are emitted in the
creation block, `[src]` in the update block.

**The agent declined to widen the change, with an argument.** The detail-page gallery has the same
gap and a different right answer: its images carry real alt text (#87), so a browser already degrades
meaningfully there, and substituting an `aria-hidden` artwork would replace that text with something
announced to nobody. Filed as #160 instead.

**It measured instead of reasoning, twice.** It ran `projects.spec.ts` once green, then again with
`stubFixtureImages` commented out to confirm the predicted failure — which simultaneously proved the
bundle under test was actually the branch, since the old code would have rendered a broken `<img>`
and passed. And it verified in a real browser what jsdom cannot see: the swap happened, the artwork
painted, and every slot and card height was unchanged.

**What went wrong (be specific):**

**My mutation list tested the failure key being too broad and never too narrow.** I asked for
`.has(url) → .size > 0` and got it. Nobody asked the opposite question, and the answer was that
replacing `Set<url>` with `Set<projectId>` **passed 24 of the 25 tests in that spec file**, and every one of the other 311 in the suite — because no two fixtures shared
an image URL and no fixture had two images. URL-keying was one of the two judgement calls the PR
argued for explicitly, and it was the half with no test behind it.

**My reasoning for the second test was wrong, in a way that would have produced a vacuous test.** I
told the agent the tag toggle tears the grid down through `@if (loading())`. True of the app; false
in a spec using `of(...)`, where both writes to `loading` land before change detection runs, the
`@if` never observes `true`, and `@for`'s `track` quietly reuses the row. The test would have
asserted survival across a rebuild that never happened — the same hollow shape that had already cost
this PR a third commit.

**The change silently falsified two comments in a suite nothing runs.** `e2e/support/images.ts` and
`e2e/README.md` both said omitting `stubFixtureImages` "does not fail anything outright". It does
now: DNS fails, `(error)` fires, the card swaps to artwork, and three thumbnail assertions break.
`.github/workflows/` holds only a README, so no CI would ever have said so.

**I described an environment that was not there.** I told the agent a frontend dev server was on
4200. Nothing was listening.

**How it was caught:** the untested key and the falsified E2E comments by the cold review, neither of
which any gate would have surfaced — the suite was green in both cases, which is the whole point. The
`of(...)` problem by the implementing agent, which pushed back on my premise rather than writing the
test I described. The absent dev server by the agent checking `netstat` instead of trusting me.

**Fix applied:** a fixture pair sharing one URL, and the id-keyed mutation confirmed killed by
**exactly that one test** and nothing else in the suite. A re-fetch test that leaves the request
pending on a `Subject` and asserts the grid is empty mid-flight, so the rebuild it claims to survive
is proven to happen. Both E2E comments corrected and verified by running the suite with the stub
removed. Two comments extended to argue the cases they actually create rather than the easier ones —
`firstImageProjectId`'s decision across a re-fetch, and the fact that `failedImages` is per component
instance, so a transient 429 is held for the visit and no longer.

**Takeaway for next time:**

- **A mutation list has a direction.** Every mutation I named made the behaviour *broader*; a key can
  also be too narrow, and that is the half that was load-bearing. When a decision has a stated
  rationale — "keyed by URL, not project id" — the mutation to write is the one that violates the
  rationale, not the one that violates the mechanism.
- **A brief's reasoning gets the same scrutiny as its instructions.** Twice now a brief of mine has
  specified a test that could not test what it claimed. The agent caught both because the brief also
  demanded mutation testing, which is the only reason either was visible.
- **A change can falsify documentation in a suite no gate runs.** Nothing in CI runs E2E here, so
  those comments are the only warning a future reader gets, and they were quietly wrong the moment
  this merged.


## 2026-08-26 — Phase 8's visual design: every failure was a check aimed at the wrong surface

**Task given:** give the site a visual design (#152). What it had was browser defaults plus
accessibility repairs — no type scale (`h2` at 1.1× body), headings inheriting body leading, tag
chips in Arial against `system-ui`, and `--color-border: #ccc` drawing **15 strokes** at 1.6:1 on
white and 11.7:1 on the near-black canvas. (#152, the ADR and `styles.spec.ts` all say 16; that
figure counts the declaration itself alongside the 15 `var(--color-border)` usages. Corrected here,
not yet at those three sources.) Shipped as three PRs: #153 direction, #154 token layer and type
scale and self-hosted faces, #155 card grid and generated artwork. Frontend 260 → 329 tests.

**Agent(s) used:** one frontend agent per PR on Opus, each in its own worktree, with an independent
cold reviewer per PR. The direction itself was not dispatched — three directions were mocked against
the real content and compared with the owner before any of it was built.

**What went right:**

**Deciding before dispatching, again.** #152 was a list of measurements, not a design. Turning it
into an ADR first (#153) meant every later agent had a written answer to "which of these is a taste
call and which is a defect", and none of them had to guess.

**The cold review is doing the work it was introduced to do.** Every correction below was found by
someone who had not written the thing they were checking — including this entry, whose first draft
carried four wrong numbers.

**What went wrong (be specific):**

**The palette I signed off would have shipped an AA failure — my error, not an agent's.** I verified
it the way #116 taught: ink, muted, accent and hairline each measured against the ground they sit
on, in both schemes, ratios written into the token comments. Every one passed. I never measured text
drawn *on* the accent, because "accent" was a stroke and a link colour in my head while the mockups
had made it a **fill** — primary buttons, the skip link. `#fff` on the dark accent `#e0607f` is
**3.42:1**. Every primary button in dark mode would have failed exactly the way #116 did, in the PR
whose entire purpose was to stop that recurring.

**HSL lightness is not lightness.** The artwork generator (#155) first held its curves at a fixed
HSL lightness, which sounds like "the same visual weight at every hue" and is not. At `l: 62%` the
stroke measures **1.04:1 against the light plate at one hue and 4.20:1 at another** (2.64:1 to
12.16:1 against the dark one) — some cards would have shouted while their neighbours were invisible,
and which did which depended on the scheme.

**Two tests measured their own arithmetic rather than the code.** Same PR. `de41048`: two assertions
were arithmetic over constants the spec itself declared, so raising the background grid to alpha 0.9
and making the area under the curve fully opaque both left the suite green — neither read anything
the generator produced. `b216a33`: a mutation squeezing the response into a 10% band in the middle
of the slot passed `uses the full height of the slot`, because the fake context kept every point in
one flat list and the grid, which runs corner to corner regardless, satisfied an assertion aimed at
the curve.

**A failure I reported was my own harness.** I said a card's image never loaded, `loading="lazy"`
appearing not to fire. It fires. The Browser pane was not compositing, so nothing entered the
viewport and the lazy load correctly did nothing; the image reports `complete: true` once the pane
renders.

**Four wrong numbers in the first draft of this entry.** A milestone dated four days before it
existed; `5.65:1` given as the ratio of `#fff` on the light accent when 5.65:1 is *accent on
background* and the right figure is **5.83:1**; the pre-Phase-8 test baseline given as 255, which
was the count before PR #150 added five more; and "every colour is defined per scheme", which is
false for the two tokens deliberately not flipped.

**How it was caught:** the AA near-miss and the HSL problem by the implementing agents, both of which
pushed back on a brief rather than building what it said — the #154 agent went on to find the same
class one token over (`#7a1f1f`, a strong 9.96:1 boundary on the light ground and **1.92:1** on the
near-black one, a delete button that is a barely-visible rectangle). The two hollow tests by mutating
the code they were meant to guard, which is the only reason they were found at all. The harness false
alarm by checking before filing. The four numbers by a cold reviewer that recomputed every ratio from
the WCAG formula, counted the `var(--color-border)` usages in the pre-Phase-8 tree, and read PR
#150's own gate output rather than reconstructing the baseline.

**Fix applied:** `--color-on-accent` and `--color-on-danger` added as per-scheme tokens. The artwork
solves for sRGB relative luminance instead, by bisection over lightness at fixed hue, which clears
3:1 at every hue on both plates (~3.3:1 either way). Both hollow tests now read what the generator
emitted. And `styles.spec.ts` grew `has a check for every colour token that exists`: the set of
`--color-*` tokens declared in `styles.scss` must equal the set the ratio table knows about, so a
colour added with no check fails a build instead of waiting for someone to look at it.

**Takeaway for next time:**

- **Recording the ratio of a colour is not recording the ratios of the pairs it takes part in**, and
  a token's name does not tell you what those pairs are. `--color-accent` had a ratio against the
  ground and no ratio against the thing painted on it.
- **A number copied from a comment is not a verified number.** Three of the four wrong figures here
  were faithful to their source; the source was wrong. `5.65:1` is still wrong in `styles.scss`'s
  `--color-on-accent` comment, and `16` is still wrong in #152, the ADR and `styles.spec.ts`.
- **A test cannot see appearance, and this earned another entry.** With the whole suite green,
  opening the running site produced #156: the card asks whether an image was *specified*
  (`project.images.length > 0`), never whether one *arrived*. `Project.images` are admin-pasted
  external URLs, so a dead one leaves the plate empty permanently — and the generated artwork that
  exists precisely to prevent an empty card is skipped for the one case that needs it most. The
  admin's own browser has it cached, so it looks correct to the only person likely to check.

## 2026-08-21 — Phase 7a: the isolation exercise finally ran, and found what reading the backend would have hidden

**Task given:**

Start Phase 7, sequentially. 7a's three issues (#53 receiver, #54 sync, #55 tests), plus the two the
work itself produced (#144 admin publish control, #146 pinning that `PUT` reaches a draft).

**Agent(s) used:**

`backend-agent` on Opus for the receiver and the sync handler, Sonnet for the single pinning test,
`frontend-agent` on Opus for the admin control. Two were resumed after session limits.

**What went right:**

**Deciding before dispatching worked for the third time on this project.** #54 says "sync repo
metadata into the Project service." Read naively that copies GitHub's repo description over
`Project.description` — destroying prose signed off two days earlier (#49), automatically, on someone
else's schedule. That is #92's data-loss shape arriving by a route nobody was watching. The ADR was
written and merged before any handler existed, and it is why the implementation needed no rework.

**The backend/frontend isolation exercise ran for the first time, and paid immediately.**
`PROJECT_TODO.md` has recorded since 2026-08-02 that the exercise deferred from Phase 4 lives in
Phase 7 — Phase 3 having been built against a running backend, so no first integration remained to
test. #144 was the first task where the rule was real: the agent could not read `/backend`, only
`docs/openapi.yaml` and the generated client.

It found **two defects that meant the feature could not have worked**: the admin list called
`listProjects`, the *public* endpoint that filters to published unconditionally — so the page was
structurally incapable of showing a draft — and the edit form loaded through `getProject`, which 404s
for a draft identically to an id naming nothing. It also flagged **two contract ambiguities rather
than resolving them**, which is the part that makes the exercise worth its cost. One became #146; the
other is #148.

Reading the Java would have hidden all four, because the obvious move is to call whichever method
works. The Senior Dev's premise in #144 — "a draft appears in the admin list looking identical to a
live project" — was itself wrong: it did not appear at all.

**Three traps caught by measuring rather than reasoning:**

- **`repository.pushed_at` has two wire formats.** Epoch seconds as a *number* on a `push` event, an
  ISO-8601 *string* everywhere else. Handling one passes whichever test is written first and silently
  drops the field in production for the other — on the event the feature is named after.
- **A concurrent idempotency test passed against the bug it was written to catch.** Twelve threads
  through HTTP could not race a check-then-act insert, because dispatch jitter is wider than the race
  window; the racers arrived single-file. Rewritten below the HTTP layer, it fails on round 0.
- **`jsonb` parses rather than stores.** Whitespace goes, keys reorder, escapes resolve — so a payload
  recorded "verbatim" cannot re-verify its own signature. The migration, entity and data model all
  claimed verbatim; all three were corrected.

**What went wrong (be specific):**

1. **A merge left `docs/DATA_MODEL.md` arguing with itself.** The ADR branch and the receiver branch
   both edited the `GithubSyncRecord` section; git auto-resolved cleanly, and the result had one
   paragraph saying the sync scope was still an open decision and the next saying it was confirmed,
   plus two unlabelled tables back to back. A clean auto-merge is not a coherent document.
2. **The ADR shipped saying "denylist" and the code shipped an allowlist.** The implementer's argument
   was better than the ADR's: the deciding case is a blank config — a fresh environment, a forgotten
   variable — where an empty allowlist syncs nothing and an empty denylist syncs everything. The ADR
   was amended rather than left contradicting the code it exists to explain.
3. **Regenerating the client broke the frontend suite, and `npm run build` did not notice.** Five
   `Project` fields became required; no application code constructs a `Project` literal, but a test
   fixture does. Build green, `npm test` failing to compile.
4. **An agent reported a Maven trap that does not reproduce.** It claimed `mvn test` ran stale test
   classes after a signature change, which would mean every backend gate this session was unreliable.
   Checked before repeating it: `testCompile` reports "Recompiling the module because of changed
   dependency" and rebuilds all 29 classes. Something happened to it, but not for the stated reason.

**How it was caught:** the merge contradiction by re-reading the merged section rather than trusting a
clean auto-merge; the frontend break by running `npm test` as well as `npm run build`; the Maven claim
by trying to reproduce it; #148 by rendering the admin screen against a real draft row.

**Fix applied:** all five issues closed, epic #70 closed. #148 filed with three coherent options rather
than a patch, because which surface is wrong is an editorial question about the portfolio.

**Takeaway for next time:**

- **The isolation rule's value is entirely in what gets *reported*.** An agent that resolves a contract
  ambiguity by reading the other side produces working code and no finding. Two of Phase 7a's four
  discoveries exist only because the agent was told to flag rather than resolve, and did.
- **A guard added for a hypothetical earned out twice.** `project-detail.component.spec.ts`'s
  `: Project` annotation was added in PR #132 *specifically* so a future required field would fail
  loudly. It has now done so twice, in #93 and here. The instruction that mattered second time was
  "do not silence it with a cast."
- **A clean auto-merge is not a coherent document.** Two branches editing the same section from
  different premises merged without conflict and produced text that contradicted itself two paragraphs
  apart. Read the merged region, not the merge exit code.
- **When an agent reports a trap, reproducing it is part of accepting it.** The Maven claim would have
  gone into this log as a fourth structurally-cannot-fail gate. It does not hold up, and recording it
  would have made the file less trustworthy, not more.

## 2026-08-18 — Clearing the Phase 6 backlog: six agents, and the pattern was pushing back on the brief

**Task given:**

Work the remaining Phase 6 and Meta backlog autonomously, stopping only on something needing the
owner. Ten issues closed across six dispatches: #116, #124, #114, #117, #115, #93, #109, #133, #111,
#107, #78, #90, #110, #99.

**Agent(s) used:**

`frontend-agent` and `backend-agent` on Opus, one `general-purpose` on Opus for the contract work,
one on Sonnet for a single test with a known target. Two were resumed after a session limit.

**What went right:**

**Five of six agents corrected something in the brief rather than implementing it as written**, and
in four cases the correction was the more valuable half of the work:

- **#78, the Caffeine argument.** The brief said a cache dependency was too large for a solo
  portfolio site. The agent agreed and gave a better reason: **size-bounded eviction is the wrong
  policy for a rate limiter.** Evicted by size under key churn, it discards the busiest keys'
  neighbours exactly when an attacker is generating churn — the eviction policy becomes an attack
  surface, and "who gets forgotten" stops meaning "whose window elapsed". The brief's objection was
  about cost; this one is about correctness.
- **#124, the index nobody needed.** `CLAUDE.md` requires a supporting index for a new non-PK query
  column, so the brief asked for one. The agent measured instead: at 20k and 200k join rows the
  planner never picks it, and forcing it is *slower* (270ms vs 169ms). Where it is used is the
  referencing side of the FK, which Postgres does not index automatically — so every `tag` deletion
  had been scanning the join table. The index stayed, for a reason the brief had not identified, and
  the migration comment says so with the numbers.
- **#109, a brief that would have re-created its own defect.** It said to document the validation
  `field` as the request-body property path. The agent probed and found a second producer:
  `@Validated` query params emit `listProjects.size`, a handler-prefixed *parameter* path. A client
  told "it is the body property path" would read `listProjects` as a property name.
- **#114, a half-done issue.** The brief omitted the issue's second half; the agent flagged it rather
  than opening a PR whose `Closes #114` would have been a lie.

**A stale generated client, caught only by baselining.** The contract agent regenerated from the
*unmodified* spec before editing, and found a diff that predated its own work — PR #129's
description-only change had left the committed client stale. The reasoning that merged #129 ("a
description cannot change a generated type") was correct and insufficient: the generator inlines
those strings into JSDoc. Without the baseline it would have been absorbed into the next commit and
misattributed.

**What went wrong (be specific):**

1. **Two agents were terminated by a session limit, and one had six tests' worth of complete work
   uncommitted.** The tree was green — 223 passing — so nothing was lost by luck rather than by
   discipline. Resuming restores context, never the working tree; the standing rule is to commit each
   unit as it passes its own check, and it was not followed here.
2. **The `finalize()` item in #111 was billed as "a one-line change to both handlers." It was not.**
   Clearing `loading` on a stream that completes *without emitting* leaves loading false, nothing
   loaded, and no error — so the template renders the form, empty. That is #92 returning through a
   different door, on the one component where an empty edit form is one PUT from blanking the record.
   `throwIfEmpty()` now routes an empty completion where a failure goes.
3. **#110's own issue text overstated the problem**, and would have propagated into the written
   convention. Two comments had already narrowed it: `detectChanges()` *does* catch a stale
   `computed`, and catchability also depends on the assertion being positive. The brief carried the
   narrowings; without them the note would have claimed more than is true and been discounted by the
   next reader.
4. **#90's title had rotted.** It said six vulnerabilities; the real count was four, and had been for
   some time. The numbers in an audit issue are a snapshot and drift silently.

**How it was caught:** measurement in every case — `EXPLAIN` against generated data, a probe request
against a live endpoint, a regenerate from an unmodified baseline, mutations run rather than reasoned
about.

**Fix applied:** all fourteen issues above closed. `CLAUDE.md` gained the regenerate-after-contract
rule; `frontend/src/testing/zoneless.ts` now holds the test convention with its narrowings.

**Takeaway for next time:**

- **A brief is a hypothesis, and the agent is better placed to falsify it.** Five of six did. The
  ones that mattered came from probing a claim the brief stated confidently — where an index is used,
  what a validation key contains, what a cache library's policy actually does. Briefs should say what
  is believed and why, so the belief is falsifiable, rather than stating conclusions the agent is
  expected to implement.
- **Put the convention where the copying happens.** #110's rule went into the shared testing module
  rather than a README, because a spec author copies a sibling spec rather than reading docs — and
  both async specs had already grown their own private, partial copies of the same helpers. Three
  drifting copies is how a convention is lost.
- **Verify the effect, not the tool that recommended it.** `npm audit` reporting zero says nothing
  about whether the app still works; the suite and the build are what confirm a framework bump. Same
  shape as the class-5 entries about exit codes.
- **When a mutation fires on a different assertion than the one under test, the test is still
  unproven.** #99's alt-text sweep looked covered because a *neighbouring* lookup failed first. It
  took keeping the app mutated and moving the fixture to isolate it. A mutation that kills something
  is not evidence it killed the thing you meant.

## 2026-08-17 — Three defects only a browser could see, and four bugs from asserting mechanisms instead of testing them

**Task given:**

Contact form validators (#106), then a stretch of backlog work: seeding the real content, standing the
local stack up, and whatever the reviews turned up.

**Agent(s) used:**

`frontend-agent` and `backend-agent` on Opus for implementation, `general-purpose` on Opus for cold
review and one documentation fact-check. The Senior Dev drove the browser, which turned out to matter
more than expected.

**What went right:**

**An agent measured an instruction rather than obeying it, twice.** Told to clear a signal in two
places, one implementer showed the pair was mutually redundant and produced the mutations: removing
either alone left every test passing. Told the async test style guarded a reactivity bug, another
measured that `detectChanges()` masks a *missing dirty-mark* but not a *stale computed* — so the style
was not what made that bug catchable, and the claim recorded on issue #110 had to be narrowed. Both
were right; both said so before implementing.

**A colour was fixed against the constraint that actually binds.** `#116` needed a dark-mode error
colour clearing 4.5:1. The obvious target is Chrome's `#121212`, and several redder candidates pass
there — `#fa4d56` is 5.59:1 — while failing Firefox's lighter `#2b2a33` at 4.23:1. The chosen value
was selected against the *lightest* dark canvas, and the test asserts both separately. The mutation
that proves it: setting the token to that Chrome-tuned value passes one assertion and fails the other.

**What went wrong (be specific):**

1. **Three defects reached a green suite because no test can see appearance.** An error colour at
   **2.87:1** on the dark canvas, affecting every error message on the site including the public
   contact form. Raw backend field keys rendered to visitors (`Your message was not sent: honeypot
   must not be blank`). Six E2E-scaffolding tags listed in the public tag filter with zero projects
   behind them. In all three the DOM was exactly right and something else was wrong. Two were found
   only because a review agent rendered the page; the third from a screenshot of a page that had just
   passed 193 tests.
2. **Fifteen consecutive issues were filed with no labels**, against a convention visible in ~100
   prior issues. Cause was scope, not carelessness: the checklist section was titled "PR conventions",
   is read before every PR, and was followed exactly — issues had no entry anywhere, so there was no
   rule to skip.
3. **A four-round debugging saga in one helper script, every round the same mistake.** A credential
   helper failed four times, and each cause was a mechanism asserted rather than tested: that
   `bcryptjs` resolves from the repo root (Node resolves *upward*, and the module was in `e2e/`); that
   `npm install --silent` was harmless (it hid the install succeeding, leaving "install failed" as the
   only available conclusion); that `psql -c` interpolates `:'var'` (it does not — `-c` requires a
   string the *server* can parse); and that a 401 meant a bad password.
4. **The real cause of that 401 was silent character corruption.** PowerShell 5.1 pipes text to native
   commands in the console codepage **and** emits a UTF-8 BOM preamble. So node received `U+FEFF` +
   the password — for *every* password, ASCII included — and any accented character arrived as `?`.
   The result was a perfectly valid bcrypt hash of the wrong string. Measured, not guessed: a plain
   ASCII probe arrived as `[65279, 90, 97, ...]`.

**How it was caught:** rendering pages and computing contrast against the resolved canvas; a
documentation fact-check that walked the commits rather than reading the prose; and, for the
corruption, printing the character codes node actually received instead of reasoning about what it
should have received.

**Fix applied:** `--color-error` flipped per scheme with computed ratios recorded (#116). All issues
labelled, `CLAUDE.md`'s section retitled "Issue and PR conventions" with the requirement stated first.
The script defeats both corruptions and now refuses to write unless node reports back the same
character count that was typed. Filed from this stretch: #114, #115, #116, #117, #118, #121, #122,
#123, #124, plus a `content` label for work no existing area covered.

**Takeaway for next time:**

- **A test cannot see appearance, and this project now has three proofs.** Colour, copy-for-audience,
  and stale data in a list all render correctly at the DOM level. Dispatched agents have no browser
  and the Senior Dev does, so rendering is a coordinator responsibility — not delegable, and not
  satisfied by a green suite.
- **The guard has to sit where the corruption happens.** Hashing and verifying inside node would have
  passed: it would faithfully hash and verify the same corrupted string. Only comparing the character
  count *across the process boundary* could catch it. When data crosses a boundary, check it arrived,
  not that the far side is self-consistent.
- **A checklist complete for one artifact reads as complete for everything.** Nothing was skipped —
  the requirement did not exist. Absence is invisible in a way a violated rule is not, and the part
  that did exist being followed reliably is what hid it.
- **Four failures in one script, one root cause.** Not four unrelated bugs: each was a mechanism
  believed rather than probed, in an environment (PowerShell 5.1, Windows Node resolution, psql
  argument handling) where the intuitions from other environments are wrong. The fix that finally
  worked was running the real write path against a scratch table before handing it over.
- **Verify a fix against the constraint that binds, not the one in front of you.** The dark-mode
  contrast work would have shipped a value that passes in Chrome and fails in Firefox, and the only
  reason it did not is that an existing comment on a *neighbouring* token already recorded both
  canvases. Someone had been caught by this before and wrote it down; that note is what paid.

## 2026-08-15 — Admin form (#92): the fix for a silent failure shipped another one, and a test the brief itself specified could not fail

**Task given:**

Issue #92 — an admin edit form whose `getProject` failed rendered anyway: empty, editable, saveable.
Saving issued a PUT, which is full replacement, so every field of a real project was overwritten with
blanks. Destruction by an action that looked like a no-op.

**Agent(s) used:**

Senior Dev dispatched `frontend-agent` on Opus, then a cold `general-purpose` reviewer on Opus, then
resumed the original implementer with the fix list. The implementer was terminated by a **monthly
spend cap** mid-mutation-test and resumed after the reset.

**What went right:**

**The reviewer verified a framework claim against installed source instead of accepting the author's
framing.** The implementation rested on an unusual assertion: that a `computed` reading only
`AbstractControl`'s `touched`, `dirty` and `errors` caches its first answer forever. The reviewer
opened `node_modules/@angular/forms` and read `get touched() { return untracked(this.touchedReactive); }`
rather than taking the comment's word,
confirmed the app is genuinely zoneless, and then drove the message paths using **only real DOM
events** — blur, click, dispatched submit — never `detectChanges()`. That last choice mattered: it
also established that under zoneless, `ComponentFixture.detectChanges()` forces every test view to
refresh regardless of dirty state, so a spec that calls a method directly and then calls
`detectChanges()` **cannot** detect a missing dirty-mark. A harness that hides the bug class the
component was being fixed for.

One detail in that framing was itself wrong, and the docs fact-check caught it after this entry was
first written: `touched` and `pristine` really do go through `untracked()`, but **`errors` is a plain
class field on `AbstractControl` — not signal-backed at all.** The conclusion is unaffected; the
reason differs per property, and "all three are untracked" was a tidy generalisation over two
mechanisms. It propagated: the same sentence is in the component's own code comment and went from
there into issue #106's body. The issue was corrected on 2026-08-16; the code comment moves into
`shared/form-errors/` in PR #113 and is corrected there, since a docs-only PR cannot reach it.

Worth noting because generalising a plausible single mechanism from a partial reading is a repeat, not
a one-off — the 2026-08-09 entry alone is titled "three invented mechanisms in one docs PR", and its
first defect is explicitly a rule written from one observed case and presented as general. This makes
at least the fourth. (Not this log's most-attested mistake: agents terminated with complete-but-
uncommitted work is at ten across three entries and has its own rule in `CLAUDE.md`.)

**Incremental commits converted a spend-cap loss into an inconvenience, for the second time.** The
implementer died mid-sentence on "M18 kills F3's test. Restoring…" — mid-mutation, the single most
expensive moment to be terminated, because the tree is then deliberately wrong and only the dying
agent knows it. The tree was checked before anything else: clean, no mutation applied, four findings
committed. Nothing was reconstructed.

**The 08-10 deviation was not repeated.** That entry flagged the Senior Dev writing deliverables
directly when an agent died on a spend cap. This time the work waited for the reset and the original
agent was resumed, keeping its context and its model.

**An agent measured an instruction instead of obeying it, and the instruction was wrong.** The fix
brief asked for `loadError` to be cleared both on the way into `loadProject()` and in the success
handler. The implementer did both, then reported that the pair was mutually redundant and showed the
mutations: removing either clear alone left all 31 tests passing; only removing both failed anything.
The reasoning was correct — with the single-flight guard in place no two loads overlap, so `loadError`
is always already null by the time `next` runs. The guard fixes the ordering; the second clear only
restates it. The redundant line was dropped, and the mutation was re-run to confirm the survivor is
load-bearing rather than the better-tested half of a redundant pair. The agent also flagged the shape
by name: an unfalsifiable line is what the inert `-webkit-box-orient` was.

**The green summary line was caught lying, by the agent reading it.** Running a mutation, vitest
printed `Tests 41 passed` **and** `Errors 1 error` — an unhandled RxJS error — on the same run. The
agent's grep matched `Test Files|Tests |FAIL` and so filtered the `Errors` line out entirely, and it
came within one step of recording that mutation as a survivor, i.e. of concluding a guard was
untested when the test had in fact failed. It noticed, widened the grep to include `Errors`, added the
exit code, and re-ran.

**The Senior Dev's own verification command had the identical hole for this entire session.** Every
gate run reported here used `grep -E "Test Files|Tests |FAIL"` against a *pipe*, which both drops the
`Errors` line and discards npm's exit status. Those runs happened to be clean — re-verified afterwards
by redirecting to a file, grepping that, and reading `EXIT=0` — but the command could not have told
the difference. This is the first instance found by a dispatched agent rather than by the dispatcher.

It is the third occurrence, and logging it here is what makes it the third on record. The first is
`(cd backend && mvn -q test 2>&1 | tail -35); echo "BACKEND_EXIT=$?"`, written up in the 2026-08-07
entry. The second happened in session on 2026-08-15 — `gh pr edit ... | tail -1 && echo "corrected"`,
the same `$?`-from-the-wrong-end-of-a-pipe mistake — and was never logged, so nothing in the
repository records it; it is written down here only because a fact-check of this PR pointed out that
an unlogged instance makes a recurrence count unverifiable to the next reader, which is most of what
these entries are for. Note what the 2026-08-07 entry says about occurrence one: this log already had
a whole section on tooling that reports success while doing nothing, and the gate was written anyway,
an hour after that section. So the section did not prevent the first occurrence, and eight days later
the same shape recurred twice more — which is the case for a standing command form rather than another
paragraph of advice.

**Its own bad test was reported rather than quietly fixed.** The first stale-failure ordering test
used `throwError`, which emits at *subscribe* time — so the failure landed before the success, testing
the opposite ordering to the one filed, and passing with the guard removed. The agent found this while
mutating, rewrote it with deferred `Subject`s, and said so. Likewise, asked what its mutation coverage
had actually been when the spend cap killed it, it named two mutations it had never run instead of
presenting a complete-looking table.

**What went wrong (be specific):**

1. **The brief specified a test that was structurally incapable of failing.** The Senior Dev asked for
   "fail the load → retry → assert the row counts" as the regression test for a duplicate-append
   guard. It cannot work: the failed load never runs the `next` handler, so the FormArrays are empty
   when retry runs. Deleting **both** `clear()` calls left the test green. The implementer found this
   while mutation-testing its own work, kept the original test for the reachable path, and added a
   second one that loads twice successfully — which does fail without the guard. The cold reviewer
   independently reproduced all three cases and confirmed the account.
2. **The fix for a silent failure left another silent failure in the same component.** The API reports
   a violation inside a collection under the element's key — `links[0].label`, `images[0]`, `tags[2]`
   — and the form matched only flat keys. `errorInterceptor` is silent here too: its three branches
   are 401-while-logged-in, rate-limited, and *no* field errors, so a 400 **carrying** field errors
   takes none of them. The client control for a link label checks `required` only; the server also
   enforces `@Size(max = 50)`. So a 51-character label produced no inline message, no toast, and no
   saved change — **Save did nothing and said nothing**, which is verbatim the failure mode the PR
   existed to eliminate. Found by the cold review, not by the author or the Senior Dev.
3. **A latent display bug was made visible by a change that was correct on its own terms.** Rows were
   `track $index` with positional `formGroupName`/`formControlName`, so removing the first of two
   links left the DOM showing the deleted row while the model held the survivor — and the model is
   what the next PUT sends. That was already true on `main`. Adding validator messages made the
   contradiction *render*: "Link label is required" under an input visibly containing text. The
   reviewer proved it by running it, not by reading it.
4. **A dispatch instruction asked for a second guard that nothing could falsify.** The Senior Dev's
   F5 fix list said to clear `loadError` on the way in *and* in the success handler, *and* to guard
   against a retry while loading — phrased as though the clears addressed the stale-failure ordering.
   They do not; only the guard does. Two of the three were the same fix stated twice, and the agent
   had to measure that rather than being told it. Conflating "defence in depth" with "two lines that
   both look protective" is how an untestable line gets into a codebase with a written rule against
   exactly that.
5. **A code comment asserted interceptor behaviour that does not occur in the common case.** The
   comment said a 401 makes the interceptor log out and redirect. The interceptor gates that on
   `auth.isLoggedIn()`, which is already false once a token has expired by wall clock — the exact
   trigger #92 names. So ordinary expiry produces a generic "Request failed (401)" toast and no
   redirect.

**How it was caught:** the cold review, run against a detached worktree at the PR head, with findings
confirmed by executing them rather than reasoning about them. Mutation spot-check killed 9 of 10; the
survivor was a genuine unpinned gate the author had not tested. The Senior Dev re-ran the suite
independently rather than accepting the reported count, and verified the two out-of-scope defects the
implementer reported before filing them — one of which was reported as live and turned out to be
unreachable through the UI.

**Fix applied:** indexed-key lookup for row and flat fields, control-identity tracking, the missing
gate test, and the missing accessibility wiring on `startedOn`. The retry race and the false comment
followed after the spend-cap reset. Filed separately: #106 (the public contact form has the identical
silent-validator defect, and matters more because the person hitting it is a visitor with no idea what
the constraints are), #107 (`route.snapshot` read once — latent, filed with the reachability analysis
that shows no UI path reaches it today), #108 (the interceptor's 401 branch, app-wide).

**Takeaway for next time:**

- **A brief that prescribes a test also prescribes its blind spot, and the author cannot see it from
  the brief.** The only reason this one was caught is that the brief *also* required mutation-testing
  every new test. Specifying the assertion is worth doing; specifying it without requiring proof that
  it can fail is worse than not specifying it, because a named test reads as a covered case.
- **When a defect class recurs inside its own fix, change the approach, not the coverage.** Three
  rounds enumerated one more key each and were caught out by the next, because enumeration cannot
  outrun a backend that can add a constraint. The structural version — render anything no slot
  claimed, deriving claimed-ness from the same predicate the slots use — ended it in one round and
  survived an adversarial key sweep. The signal to stop enumerating was the second recurrence, not
  the third.
- **A comment recording a lesson is not a control.** The commit that wrote "mutations survived on this
  side purely because the links tests were never duplicated for it" left that exact gap, in that same
  commit, for a different guard. Notes inform a reader who is already looking; only a mutation run
  makes the omission fail.
- **Correcting one site of a repeated claim is the same omission in prose.** Fixing this entry took
  four fact-check rounds, and three of them found a claim corrected in one place and left standing in
  another — once across files, twice within this file, including the bullet directly above. That is
  structurally identical to the links-mirrored-but-not-images gap it describes: the fix was applied
  where the finding pointed rather than everywhere the claim lived. The check is to grep for the claim,
  not to edit the line that was quoted at you.
- **A grep over a test run is a gate, and it inherits every rule about gates.** Three times now the
  failure has been the same: the command could not report red. Twice it was `$?` captured from the
  wrong end of a pipe; this time it was a filter narrow enough to hide a line the runner did print.
  The standing form for this repo is redirect to a file, grep the file for `Errors` and `Unhandled`
  as well as the summary, and read the process's own exit code — never `cmd | grep ...; echo $?`.
- **Before asking for defence in depth, say what would falsify each layer.** If the answer is "nothing
  — the other layer already guarantees it", the second layer is not depth, it is an untestable line
  whose presence implies coverage it does not have. The useful form of the instruction is not "do both"
  but "do both, and show me a mutation that kills each one independently" — which is what turned this
  into a one-line deletion instead of a permanent fixture.
- **Ask where a fix's own error path goes silent.** This component was being fixed precisely because a
  failure looked like an idle state, and the fix shipped a second route to the same appearance. The
  question is not "does the handler run" but "does anything the user can see change" — and that
  requires reading the interceptor's branches, not just the component's.
- **A silent failure can require three correct-looking pieces to conspire.** The client validator, the
  server constraint, and the interceptor were each defensible alone. The gap was in the seams: a
  constraint only the server enforces, reported under a key only the server's format knows, on a
  response shape the interceptor deliberately stays quiet about. Cross-boundary silence is not
  visible from inside any one file.
- **`ProjectWriteRequestValidationTest` — written in Phase 2 to cover an invalid `LinkDto`, and logged
  above under class 5 — is what made this findable.** It is the committed proof that the backend emits
  `links[0].field`. A test written for one layer supplied the evidence that a different layer was
  dropping its output two phases later.
- **Latent-made-visible now has two instances** (this one and the `project-detail` subscription leak
  on 2026-08-10). Both were harmless until an unrelated correct change gave the old behaviour a new
  consequence. When touching every line of a construct, the question is not only "is my change right"
  but "what was already wrong here that my change gives teeth to".

**Round-by-round tail (added on merge, 2026-08-16):**

The entry above was written after the first fix round. Three more followed. **The first draft of this
paragraph claimed every round's defect was introduced by the previous round's fix; a fact-check of the
docs PR walked the commits and showed that is only true of half of them.** The corrected account, and
the tidier version is the one to distrust:

1. Row keys (`links[0].label`) matched against flat keys only — **pre-existing**, inherited from the
   Phase 3 form. `09df2c2`, the #92 fix, touched no field-error code at all.
2. Collection-level keys — the bare `links` key from `@Size(max = 10)` sitting on the property rather
   than its elements (`images` carries `@Size(max = 20)`) — **also pre-existing**; no such slot had
   ever existed.
3. **Introduced by round 2's fix** (`2efbc99`): its row lookup passed a live `$index`, so removing a
   row left the survivor flagged with the removed row's verdict. Round 3's catch-all (`ccb5a0a`) did
   not cause this — it shipped `forgetErrorsFor()`, the mitigation. This one is also not the same
   class as the others: it renders a **wrong** verdict rather than dropping one, which is why the
   round traded "silent" for "wrong" instead of improving on it.
4. **Introduced by round 3's fix**: `serverError()` found **one** matching key while the
   `unclaimedErrors()` added alongside it subtracted **every** one, so a slot claiming two indexed
   keys rendered the first and swallowed the rest. Two over-long tags reach it.

So the accurate shape is narrower than the first telling: two long-standing gaps that nothing had
exercised, then two genuine self-inflicted regressions once the code started reaching into keys it had
never parsed before. Three of the four are the silent-drop class — server errors render into slots
keyed by field name, and `errorInterceptor` deliberately stays quiet when a 400 carries field errors,
so any key reaching no slot means Save does nothing and says nothing.

Instance 3 is where the approach changed. Up to then each round had enumerated one more key, which is
whack-a-mole with a backend that can always add a constraint. The user was asked to choose, and chose
the structural fix: render **any** key no slot claimed, with claimed-ness derived from the same
predicate the slots look up with, so the catch-all cannot drift from what is on screen. The final
review confirmed no fifth instance by sweeping an adversarial key set — unknown keys, indexed keys,
keys prefixing other keys, the empty string, keys with surrounding whitespace, wrong case — plus
multi-key combinations, each asserting the message renders exactly once. That sweep was a review-time
run and its keys were never committed, so nothing in the codebase reproduces it; PR #105's merged
description is the record, key list and count included. The count is deliberately not repeated here —
a number in a log entry reads as something a reader could re-derive, and this one they cannot.

Two process observations from the tail:

**Writing the lesson down did not prevent repeating it, in the same commit.** The spec file carries a
comment recording that mutations survived on the images side "purely because the links tests were
never duplicated for it" — and `cf59d00`, the commit that added that sentence, left exactly that gap
for a *different* guard: the in-flight freeze added one commit earlier (`1ab45b3`) was mirrored onto
images for the purge but not for the freeze. Four images-side mutations survived, and it took a review
two commits later (`8c83045`) to find them. What closed it was mutating each new guard on both
collections, not the note.

**A reviewer overturned a comment the Senior Dev had asked for.** The agent was told to document that
short-circuiting `forgetErrorsFor()`'s `set()` when nothing was filtered would break the catch-all
silently. The next reviewer mutated exactly that, found it survives, and argued it is an *equivalent*
mutant: if nothing was filtered then no key of that collection was present, and `unclaimedErrors()`
decides membership per key, so no key present can change its verdict. The agent checked the derivation
independently and agreed. The comment now names the hazard that does exist — a new path changing a row
count without purging — rather than one that does not.

## 2026-08-10 — SEO (#50): the incremental-commit rule proved itself the day it merged

**Task given:**

Phase 6's SEO item — meta tags, `robots.txt`, `sitemap.xml` — after a decision round on how much is
achievable for a client-rendered SPA served statically.

**Agent(s) used:**

Senior Dev wrote the ADR first and dispatched `frontend-agent` to build against it. That session was
terminated by a **monthly spend cap** mid-task; the Senior Dev verified and committed its work and
completed the one deliverable it had not reached.

**What went right:**

**The rule merged that morning changed a loss into an inconvenience.** `CLAUDE.md` had just gained
"commit when a unit of work is done, not when the task is", written after six agents died with
complete-but-uncommitted work. This agent committed **three** units before termination — static tags,
per-route tags, shared test helpers — and left only in-progress test work uncommitted. That work was
green when checked: 108 tests passing, up from 79. Under the previous pattern all of it would have
been a single pending commit.

**Deciding before dispatching worked again.** The ADR settled the approach, so the implementation had
no scope to relitigate it. This is the second time (after the project date period) that writing the
decision first produced an implementation that needed no rework.

**The judgment call the decision rests on.** The obvious implementation is Angular's `Meta` service
per route, and it is close to useless for the actual use case: **Googlebot executes JavaScript, but
LinkedIn, Slack, Discord, Twitter/X and Facebook do not.** They fetch the HTML and read what is in
it. For a portfolio, those are the sharing surfaces that matter — a link posted to LinkedIn is the
realistic distribution path. Runtime-only tags would have optimised for the one crawler that already
worked, and the failure would have been invisible in every test, because a browser-based test renders
the JavaScript that a scraper never runs.

**What went wrong (be specific):**

Nothing reached a branch. Two things worth recording about the handoff:

1. **`robots.txt` and `sitemap.xml` were never created** — the agent died before that deliverable, and
   its last streamed line was about component tests, which would have read as further-along than it
   was. The files' absence was found by listing `frontend/public/` rather than by trusting the
   fragment.
2. **The Senior Dev wrote those two files directly** rather than dispatching, because the block was a
   spend cap rather than a resettable limit and both files were fully specified by the ADR. That is a
   deviation from the coordinator role and is flagged as such rather than quietly folded in.

**How it was caught:** listing the build output and the `public/` directory rather than reading the
agent's final message as a status report — the discipline the 2026-08-08 entry established.

**Fix applied:** N/A for defects. The missing deliverable was written with an RFC 2606 `.invalid`
placeholder origin, and both listed routes were verified against `app.routes.ts` rather than assumed.

**Takeaway for next time:**

- **A rule is worth writing when it converts a category of loss into a category of inconvenience.**
  This one did so within hours of merging, which is unusually fast feedback on a process change. The
  measure was not "did agents follow it" but "what did a termination cost this time".
- **Test coverage cannot see a crawler that does not run your tests.** Every meta-tag test passes in a
  JSDOM or browser environment, because both execute the JavaScript that sets the tags. The one
  consumer that matters for social previews executes none of it, and no amount of frontend testing
  will ever reveal that. The check is to inspect the *built* `index.html` — what is in the file, not
  what the app produces after boot.
- **`sitemap.xml` deliberately omits project pages, and that is worth stating rather than looking like
  an oversight.** Their URLs are runtime UUIDs; listing them from a static file in `public/` would
  require a build-time API call, which is the same coupling the ADR defers alongside prerendering. A
  reader finding a two-entry sitemap should be able to see it was a decision.

**Review round (added after the cold review of PR #103):**

The review found a real defect, and its shape is the interesting part: **a latent bug made harmful by
an unrelated change.** `project-detail.component.ts` subscribed to `paramMap` and nested a
`getProject(...)` subscription inside it, with no `switchMap` and no teardown. That leak predated this
work and was harmless, because the callbacks wrote to component-local signals that were simply
discarded on destroy. This change made those same callbacks write to `document.head`, which outlives
the component. Nothing in the change was wrong in isolation, and nothing in the old code was visibly
broken — the defect existed only in the combination.

The reviewer proved it against the real component and the real router rather than reasoning from the
code: navigating away from an in-flight request that then fails leaves `robots: noindex, nofollow` on
the **public landing page**, and an out-of-order response leaves an abandoned project's title and
description on the current one. Fixed with `switchMap` plus `takeUntilDestroyed`, and confirmed by
reverting the fix and watching the three new assertions fail with exactly that output.

Two smaller findings worth keeping:

1. **A `Disallow` in `robots.txt` defeats a `noindex` on the same path.** Both `/admin` and
   `/reset-password` were disallowed *and* set `robots: noindex` at runtime, with a comment claiming
   the tag was what protected them. A compliant crawler that is blocked never fetches the page, so it
   never reads the tag — the two do not stack. Kept both, but the comment now says which one does the
   work and why: the app is client-rendered, so every path returns the same `index.html`, and the
   `Disallow` is the only half a non-JS crawler can act on. The tag earns its place for a JS-executing
   crawler arriving by direct link that ignores `robots.txt`, and for the 404 view, which is not
   disallowed and so is fetched and read normally.
2. **A test asserting a tag count of zero on a path that never set one.** It passed with the entire
   success path deleted. Replaced with a version that fails a project load, asserts the `noindex`,
   then navigates to a project that loads and asserts both that the tag cleared *and* that the new
   project's title and description applied — mutation-checked by deleting the describe call.

**Takeaway to add to the ones above:**

- **A latent defect can be activated by a change that is correct on its own terms.** The question to
  ask when moving state from a component-scoped store to a global one is not "is this write correct"
  but "what already writes here late, and where does it land now". Nothing in the diff looked wrong;
  the combination did.

## 2026-08-10 — Six agents lost mid-task over four days, and a PR that re-committed the bug it documented

**Task given:**

Not a feature. Two process rules, prompted by failures during Phase 6's content work: agents losing
uncommitted work on termination, and a PR closing an issue it had explicitly said it would not close.

**Agent(s) used:**

Senior Dev as author; a fresh session as reviewer of the resulting PR (#101).

**What went wrong (be specific):**

**1. Six agents terminated mid-task between 2026-08-07 and 2026-08-10, every one with complete-but-uncommitted work.**
Five to session limits — the Phase 4 E2E implementation, the PR #82 fix round, the PR #83 fix round,
the PR #96 review, and the PR #96 fix round — and the sixth, the content-seed session, to a **monthly
spend cap**. That last one matters because a spend cap does not reset in hours the way a session
limit does: "resume it later" stopped being available, and the Senior Dev had to verify and commit
another session's work. Existing guidance already said to resume rather than salvage; what it did not
say was that resuming restores *context*, not the working tree.

**2. PR #100 closed issue #49 while stating it did not.** Its body opened with "Advances #49.
**Deliberately does not close it**" and carried no intentional keyword. A later sentence explained
what *would* finish the work — "Applying this to a live site is what closes #49" — and GitHub matched
`closes #49` there. The issue closed on merge and was reopened.

**3. The PR documenting that bug re-committed it, twice.** PR #101's own body quoted the offending
sentence in a blockquote, and its commit message repeated it in prose. `closingIssuesReferences` on that
PR returned `49`. (A *second* occurrence, in inline code, turned out **not** to link — see the
correction below.) So the fix-PR would have taken the same issue
down a second time on merge — caught by the independent review, not by its author, despite its author
having written the rule hours earlier.

**4. A claim in that PR was wrong.** It said "a commit on a worktree that gets removed is still lost
work". The reviewer disproved it experimentally: commits on a **named-branch** worktree survive
`git worktree remove`, because the branch still references them. Only **detached** worktrees — the
`--detach` form this project uses for PR review — lose them. The advice to push was right; the stated
reason was not.

**How it was caught:** the independent review of PR #101, which ran the GraphQL query against the PR
it was reviewing rather than only reading its argument.

**Fix applied:**

The rules were rewritten on a clean branch rather than amended in place, because the offending commit
message could not be corrected without a force-push that `block-protected-branch-ops.sh` denies. Both
new discoveries are now part of the rule: quoting and backticking do **not** neutralise a keyword,
and `closingIssuesReferences` only sees the PR *description*, so a keyword in a commit message can
close an issue without ever appearing in the standard check. The worktree rationale is corrected to
distinguish named-branch from detached. The resumption caveat is upgraded from "documented but
unverified" to verified, having been exercised repeatedly across this session.

**A correction, found by the review of the fix:**

The rewrite claimed that neither blockquoting nor inline code neutralises a keyword. **Half of that was
wrong, and the wrong half mattered most.** PR #101 was an unnoticed controlled experiment — one
occurrence in a blockquote, one in a code span, same PR, same issue. Its rendered body carries exactly
**one** `issue-keyword` marker, for the blockquoted occurrence; the backticked one renders as a plain
`<code>` element with no reference. Verified twice: the `body_html` markers, and the fact that PR #102's
own body contains a backticked keyword beside an issue number while its `closingIssuesReferences` is
empty — with the query confirmed to list already-closed issues, so empty is meaningful rather than
vacuous.

The claim was also **self-refuting**: had it been true, the PR asserting it would have been unmergeable
for the reason it was documenting. And it discarded the one safe way to write about keywords, which is
the technique that PR was itself relying on.

**Takeaway for next time:**

- **A rule that forbids the technique it depends on is refuting itself in front of you.** The check is
  cheap: apply the rule to the document stating it. Here that would have surfaced immediately, because
  the document could not have been written under its own rule.
- **Writing a rule does not confer immunity from it.** The author documented the closing-keyword trap
  and then triggered it in the document doing the documenting — by blockquoting the offending
  sentence, because the fix was conceived as "avoid writing a closing keyword" rather than "a keyword
  beside a `#N` links unless it is in code". A rule stated as a principle gets applied to the case
  that inspired it; a rule stated as a mechanical check gets applied everywhere.
- **Verify the artifact against its own rule before shipping it.** One GraphQL query against PR #101
  would have caught this. The check already existed in `CLAUDE.md` — it was simply never run on a PR
  that was not *trying* to close anything, which is exactly the case the new wording now covers.
- **A prescribed check can have a blind spot the prescription doesn't mention.**
  `closingIssuesReferences` is the documented way to verify issue linkage here, and it reads only the
  PR description. Any keyword in a commit message is invisible to it. When documenting a check, state
  what it cannot see.

## 2026-08-10 — Content seed (#49): a stub run reported success, and hid a real defect

**Task given:**

Turn `docs/CONTENT_DRAFT.md`'s five drafted portfolio entries into a repeatable, reviewable seed.
Nothing is deployed (Phase 5 paused), so the deliverable is an artifact that works locally today and
against a real environment later, unchanged.

**Agent(s) used:**

One `general-purpose` junior in an isolated worktree, resumed twice — once after Docker was
repaired, once for a follow-up fix. Senior Dev verifying and running the final gate.

**What went right:**

**The junior reported its verification gate as *not met*, and labelled exactly which demonstrations
were real.** Docker was broken (three orphaned socket reparse points Docker could neither delete nor
recreate; `File.Delete` and `fsutil reparsepoint delete` both returned OS error 1920). Rather than
skip the gate or imply coverage, it wrote a throwaway stub implementing the contract's shapes,
exercised the script against it, and then said plainly that the stub *"proves only that `seed.mjs`
is internally consistent — it proves nothing about the real backend"*, listing per-demonstration
which were real and which were stub-backed. After a session in which the Senior Dev twice invented
explanations for real observations, that distinction was worth more than the result.

**Re-running against the real stack immediately justified the caution.** The stub had hidden a real
finding: **tag order is not preserved**. Eight tags sent in a deliberate order came back shuffled;
the *set* round-trips intact for all five entries, the sequence never does. The stub preserved order
and would have let the draft's careful tag ordering ship as if meaningful. It is not expressible
through this contract.

**What went wrong (be specific):**

1. **The draft's hard line wrapping would have rendered as forced breaks.** `docs/CONTENT_DRAFT.md`
   wraps prose at ~90 columns; `.description` uses `white-space: pre-wrap`
   (`project-detail.component.scss:42`), which preserves *single* newlines, not only blank ones. All
   **78** intra-paragraph newlines across the five entries — longest source line 92-93 characters —
   would have broken mid-paragraph at a fixed width regardless of viewport, which on a phone reads
   as a broken page. The draft never mentions its own wrapping, so this was an artefact of
   transcription fidelity rather than a decision. Fixed by reflowing to single spaces: word
   sequences and character counts verified identical against the draft, and confirmed in the
   database afterwards with **zero** lone newlines surviving.
2. **A Senior Dev command whose failure mode was silent.** Generating a bcrypt hash with
   `HASH=$(node -e "require('.../bcryptjs')...")` against a worktree where the module was not
   installed produced an *empty* string — which still formed valid SQL, inserted an unusable
   password hash, and surfaced only as a `401` from the login endpoint two steps later. The same
   shape as every other entry in this log: a step that fails while reporting nothing.
3. **The tag table's baseline was never snapshotted.** The junior checked projects and admins before
   running but not tags, and `tag` carries no timestamps. Its cleanup removed the seed's own 20
   names by set arithmetic — which is indistinguishable from removing a pre-existing orphan of the
   same name. Overlap is unlikely (the six survivors are stylistically distinct), but unproven, and
   it said so rather than reporting a clean result.

**How it was caught:**

(1) by the junior reading `pre-wrap`'s actual semantics rather than assuming blank lines were the
only thing preserved; (2) by the 401, then by checking `${#HASH}` and finding zero; (3) by the
junior auditing its own cleanup.

**Fix applied:**

Reflow committed with per-entry verification against the draft. The bcrypt command rewritten to run
from the directory holding the module. Both limits — tag ordering and the tag-table caveat —
recorded in `content-seed/README.md` rather than left in a session transcript.

**Takeaway for next time:**

- **A stub proves the caller, never the callee.** It is a legitimate tool when the real dependency
  is unavailable, but its result must be labelled as what it is. Here the stub was internally
  faithful to the contract and still concealed a behaviour the real server exhibits, because a stub
  encodes what its author *believes* the contract implies — ordering, in this case, which the
  contract never promised.
- **`mvn spring-boot:run` forks a `java.exe` that outlives the wrapper.** Stopping the Maven process
  leaves the app serving on 8080. This is almost certainly the mechanism behind the false
  verification logged on 2026-08-09, where a Playwright run silently reused a stale server from a
  different branch and reported green against code that was not under test. **Check the port, not
  the process** — now in `content-seed/README.md`'s troubleshooting section, and used to shut down
  cleanly at the end of this exercise.
- **Shell interpolation of a command substitution needs its result checked before use.** An empty
  `$HASH` produced syntactically valid SQL and a plausible-looking success. Where a captured value
  is load-bearing, assert it is non-empty and the expected shape before the next step consumes it.


## 2026-08-09 — The README overclaimed the very methodology it was describing

**Task given:**

Issue #52 — write the top-level README as the externally-visible artifact for `SPEC.md`'s
multi-agent goal. PR #98.

**Agent(s) used:**

Senior Dev (this session) as author; an independent fresh session as reviewer, briefed specifically
to hunt for overselling, because a portfolio artifact creates pressure to make the process sound
more rigorous than it is.

**What went wrong (be specific):**

The reviewer found what it was asked to look for, in the author's own writing. Three overstatements,
all verified, in a section whose subject is the project catching unverified claims.

1. **"built in separate worktrees, neither able to read the other's code."** False. The commits are
   one linear branch — `2a739af` → `7edcbfd` → `febefc7`, twenty-seven minutes apart, zero merge
   commits — because both implementation sessions were dispatched to the *same* worktree,
   sequentially. The only separation was a prompt instruction, and `docs/AGENT_WORKFLOW.md` states
   in terms that prompt-level discipline is not a filesystem boundary. Worse, the claim describes
   as *done* the isolated backend-agent/frontend-agent exercise that three separate documents record
   as moved to Phase 7 and not yet run.
2. **"green in the report"**, of the test suite that had never been executed. There was no green
   report: the log's own account says the junior "hit an API session limit mid-verification, and its
   final output was a truncated 'Cold-start verification run:' with no results." A fabricated detail,
   inside the bullet about a fabricated verification.
3. **"matched the contract field-for-field on the first attempt."** True, but presented as evidence
   of independent agreement when the frontend's client is *generated* from that contract by
   `openapi-generator-cli` — so part of the match is mechanical, not corroborating.

Also: a `CHECK`-constraint case was listed under "what the process catches" when it is a prevented
counterfactual, taken from the one log entry whose headline lesson is that prevented bugs need proof
of reachability; an "a suite that tested a different build" example appears in **no** log entry at
all (it happened, but was only ever written in a PR comment); the worktree hook was described as
denying out-of-worktree writes without noting it is opt-in via `CLAUDE_WORKTREE_ROOT` and scoped to
`Edit`/`Write`; and "every PR is reviewed by a separate session" holds only from 2026-08-02.

**How it was caught:**

Cold review of PR #98, checking each claim against git history, the hook scripts and `AGENT_LOG.md`
itself — including checking the author's own list of what he had verified.

**Fix applied:**

The contract-first paragraph now states plainly what the sequence does and does not demonstrate, and
that true isolation is a Phase 7 exercise that has not run. The fabricated "green in the report" is
gone. The `CHECK` counterfactual is replaced with the `-webkit-box-orient` case — a real defect,
caught, where deleting one declaration left every test green and the feature inert. The unlogged
example is removed. The hook description names its opt-in condition. And the section now carries its
own correction, naming the two claims the review disproved, because a document arguing for verified
claims cannot quietly edit out the moment it failed that standard.

**Takeaway for next time:**

- **The artifact describing the process is the piece most likely to overstate it.** Everywhere else,
  a false claim is caught by a test or a reviewer reading code. In a README there is nothing to
  contradict it — the claim *is* the deliverable. That makes it the single place most needing a cold
  reader, which is the opposite of how documentation is usually treated.
- **"Neither read the other's code" and "neither could read the other's code" are different claims.**
  The first is about behaviour, the second about architecture, and only the second is a property of
  the system. This author wrote the second while the evidence supported only the first. Wherever
  isolation is claimed, name the mechanism enforcing it — and if the mechanism is an instruction in
  a prompt, say so.
- **A briefing can find what it asks for.** This reviewer was told to hunt for overselling and found
  three instances the previous reviewers, given general briefs on the same body of work, did not.
  Naming the failure mode you fear is a cheap and apparently effective review instruction.

## 2026-08-09 — Content rendering (#86, #87): a junior declined the fix the issue asked for, and was right

**Task given:**

Fix #86 (project cards render the entire description, no clamp) and #87 (gallery alt text hardcoded
as "screenshot N"). Both blocking #49, since the drafted portfolio entries run 1,000–2,400
characters each and Equalizer's images are architecture diagrams, not screenshots.

**Agent(s) used:**

`frontend-agent` in an isolated worktree; Senior Dev reviewing and running the gates.

**What went right:**

**The issue asked for a CSS `line-clamp`. The agent refused to stop there, and the reason is the
interesting part:** `overflow: hidden` hides text *visually* while leaving every character in the
accessibility tree. Twelve cards at 2,400 characters would still be read out in full to a
screen-reader user — the same "unusable list" defect the issue describes, just non-visually, and
still shipped in the markup. So it bounded the text reaching the DOM *and* clamped the rendered
lines.

It also set the two limits so they cannot silently disagree: the character cap (200) deliberately
exceeds what three lines can display (~100–120 at the page's max width), so the stylesheet always
runs out of lines before the excerpt runs out of text. The inverse ordering would have let the clamp
no-op on wide cards while still looking correct.

**On alt text it applied one WAI rule and got opposite answers for two images in the same feature**,
which is what distinguishes reasoning from picking a convention:

- *Gallery images* → `"<title>, image 1 of 2"`. Explicitly **not** `alt=""`: the gallery is the only
  place a project's visual material appears and the description never describes it, so empty alt
  would drop the images out of the accessibility tree entirely. Withholding an image's existence is
  a different failure from mislabelling it, not a safer one.
- *Card thumbnail* → `alt=""`. It sits inside a link whose visible text is already the title, so its
  alt was redundant with adjacent text and made the link announce the title twice.

It rejected deriving alt from the filename — `dsp_execution_pipeline.svg` is a path component, not
prose written for a reader, and the next upload could be `IMG_20240513.png`. That trades one
unfounded claim for a less predictable one.

**Verification was done in a real browser, not jsdom**, which does no layout: page height 2098 →
1050 px at 375 px wide, description boxes measured exactly 72 px = 3 × 24 px line-height at both
mobile and desktop widths, still three lines at a 32 px body font, and no horizontal overflow even
for a description opening with a 100-character URL. It also checked `-webkit-box-orient` survived
production minification, which some CSS minifiers strip.

Mutation testing was properly controlled — three defects reintroduced one at a time, each failing a
*different* test (proving neither test covered the other half), then restored with the tree
re-verified clean.

**What went wrong (be specific):**

Nothing reached a branch. Gates re-run independently from confirmed-free ports: frontend 54 → **77**
tests, build clean with no budget warnings, E2E **7/7**.

**How it was caught:** N/A.

**Fix applied:** N/A.

**Takeaway for next time:**

1. **"Hidden visually" is not "not present".** `overflow: hidden`, `line-clamp`, `max-height` and
   friends change rendering, not the accessibility tree or the payload. Any truncation intended to
   make a page *usable* has to bound what reaches the DOM, or it only fixes the sighted case. This
   generalises well beyond this issue.
2. **Two limits enforcing one intent need an explicit ordering, or one silently stops applying.**
   Here the character cap had to exceed the line clamp's visible capacity. Whenever a fix has a belt
   and braces, work out which is load-bearing at each viewport, or you ship a constraint that only
   appears to be active.
3. **An issue's proposed fix is a hypothesis, not a specification.** #86 named the mechanism
   (`line-clamp`) rather than the outcome, and implementing it literally would have produced a
   passing PR with the defect half-intact. A junior pushing back on the *how* while honouring the
   *why* is the behaviour to encourage — the second time in two days one has done so, after the
   frontend agent declined to snap dates to the 1st (2026-08-08).
4. **The accessibility answer can differ for two images in the same component.** Applying one
   convention everywhere would have been wrong in one of the two places here. The rule is about each
   image's relationship to its surrounding text, not about images in general.

## 2026-08-09 — A rule against stale references, whose own prescribed command was stale-blind; plus three branch scares that were all benign

**Task given:**

Two things, a few hours apart. First: add a safeguard to `CLAUDE.md` against citing evidence from a
stale checkout, after PR #94 did exactly that (PR #95). Second: the user asked why three branches
looked wrong — the content draft unmerged, `phase1/review-followups` "18 commits ahead", and
`phase3/frontend-foundation` "2 commits ahead".

**Agent(s) used:**

Senior Dev (this session) as author; an independent fresh session as reviewer of PR #95.

**What went wrong (be specific):**

**The safeguard failed on its own terms, in three ways, all found by review.**

1. **The prescribed provenance command doesn't work where it matters most.** The rule said to run
   `git rev-parse --abbrev-ref HEAD` and state the branch. In a **detached** worktree that returns
   the literal string `HEAD` — and roughly half this project's checkouts are detached, specifically
   every `My_Site-review-NN` worktree created for PR review. That is precisely where evidence gets
   quoted into a review comment and leaves the session. The command was chosen without testing it in
   the case the rule exists to protect.
2. **The recommended "root fix" would have made things worse.** The section advised getting the main
   checkout back onto `main`. Local `main` was **85 commits behind** the remote, while the "stale"
   branch it sat on was only **58** behind — so following the advice moves that checkout *further*
   from current. `.claude/hooks/block-protected-branch-ops.sh` also denies `git checkout main`
   outright, so the instruction was un-followable as well as wrong.
3. **Naming a branch is not sufficient provenance anyway.** `D:\repos\My_Site` has uncommitted edits
   to `CLAUDE.md` itself. An agent could follow the rule exactly — check the branch, state it, read
   the file — and report content matching neither that branch nor `main`, with full ceremony.

Also flagged: the entry cited `AGENT_LOG.md:1243`, already stale at 1325 post-merge, **inside a
bullet warning about stale line numbers**; and leading the section with machine-specific counts
means it reads as obsolete the moment the checkout is fixed, burying the durable rule underneath
perishable facts.

**The three branch scares were all benign, but only the third was cheap to establish.**

- **Content draft unmerged** — correct and deliberate. It is a proposal about the user's own work
  awaiting their sign-off, not code. The failure was communicative: its status was never stated, so
  it read as an oversight.
- **`phase1/review-followups`, 18 ahead** — ahead of its *remote-tracking ref*, which stopped
  advancing when PR #79 merged. `git rev-list --count My_Site/main..phase1/review-followups` is
  **0**: everything is already in `main`.
- **`phase3/frontend-foundation`, 2 ahead** — this one genuinely looked like stranded work.
  `git cherry` marked one of the two commits `+` (not in `main`), and its patch-id differed from the
  same-titled commit that had landed. Both signals were misleading: the patch-ids diverge only
  because of *surrounding context*, and the actual `+`/`-` lines are byte-identical. Every added
  line is present in `main` today — the `## PROJECT_TODO.md discipline` heading only appeared
  missing because its content was folded into `Keeping docs current` and reworded.

**How it was caught:** independent review of PR #95, which tested the commands in a detached
worktree and measured the local `main` gap rather than reading the prose. The branch questions came
from the user noticing counts that didn't match expectations.

**Fix applied:**

Provenance now uses `git rev-parse --short HEAD` **plus** `git status --porcelain` — a commit and a
dirty flag, both of which survive detachment. The root-fix advice is replaced with a fast-forward
(`git switch main && git merge --ff-only`) and the note that a local branch name never implies
currency. The machine-specific inventory moved to `docs/AGENT_WORKFLOW.md`, which is the right home
for facts that expire, leaving `CLAUDE.md` holding only the durable rule. The `origin`-vs-`My_Site`
remote-name assumption is called out rather than hardcoded.

**Takeaway for next time:**

- **A rule about verification has to be verified.** Both defects in PR #95 would have been caught by
  running the prescribed command once in a review worktree, and by running `git rev-list` on local
  `main` once. Writing "check X before claiming Y" is itself a claim about X, and it inherits every
  obligation it imposes.
- **Put perishable facts where they're allowed to rot.** Counts, branch names and machine layout
  belong in a document someone re-derives; `CLAUDE.md` loads into every session and should carry
  only what stays true. A rule justified by a condition that has since been fixed reads as obsolete
  and gets ignored wholesale, including the durable part.
- **`git cherry` and patch-id answer "is this commit present", not "is this content present".**
  Both are context-sensitive and will flag rebased or re-applied commits as missing. To decide
  whether work is genuinely stranded, compare the added lines. And a `grep` of patch lines beginning
  with `-` silently reports "missing" for everything unless you use `grep -e` or `--` — that bug
  produced two false negatives in this very investigation before it was noticed.

## 2026-08-09 — Senior Dev: three invented mechanisms in one docs PR, and a citation taken from the stale branch it warns about

**Task given:**

Add a backend correctness checklist to `CLAUDE.md` (from a draft the user found in uncommitted
changes on a stale branch), and record what the day's half-removed-worktree incident had taught.
PR #94.

**Agent(s) used:**

Senior Dev (this session) as author; an independent fresh session as reviewer.

**What went right:**

The checklist's seven substantive claims all held — the reviewer verified each against both
`AGENT_LOG.md` and current `backend/src`. Two corrections made to the user's draft before
committing were also correct: the tag-upsert race really is Phase 1 / PR #76, and
`ResendEmailClient` really does log the reset link at DEBUG under a comment explaining why, with
`application-prod.yml` pinning the app package to `INFO` so "off by default in prod" is concretely
true rather than assumed.

**What went wrong (be specific):**

Four defects, all authored here, none caught by self-review.

1. **"`git status` in the husk reports the main checkout" was overgeneralised from one layout.**
   True only when the husk sits *nested inside* a repo, which is this project's
   `.claude/worktrees/<slug>` arrangement. For the `../My_Site-<slug>` sibling layout that the
   *same bullet list* recommends three lines earlier, you get a loud `fatal: not a git repository`.
   The guidance was written from the single case observed and presented as general.
2. **The stated mechanism was wrong.** The entry blamed "a dangling `.git` link". A husk that still
   held its gitfile would error loudly and name the missing admin directory; the silent case
   requires the `.git` to be **absent entirely**, and what happens then is ordinary
   parent-directory discovery. Plausible-sounding and unverified.
3. **A correct diagnostic was dismissed as noise, with an invented explanation.** The entry claimed
   `git --git-dir=<main>/.git --work-tree=<husk> diff <branch>` reported "193 meaningless files"
   because it used the main repo's index. It was not meaningless: the output was
   `193 files changed, 21298 deletions(-)` — pure deletions, one per tracked file — and
   `git ls-tree -r --name-only <branch> | wc -l` is exactly 193. The command was correctly
   reporting that every tracked file was missing from an empty directory, which was the answer
   being looked for.
4. **The `CLAUDE.md` "Config validation" bullet forbade what the codebase deliberately does** —
   `ResendEmailClient` boots happily with no `RESEND_API_KEY` and degrades to warn-and-skip so the
   reset flow can be exercised without a Resend account. This is the *same trap* caught and
   corrected one bullet earlier for the DEBUG-logging rule, in the same commit, against the same
   class in the same file. Catching a trap once did not generalise to looking for it again.

Separately, the PR body cited **`AGENT_LOG.md:611`** as evidence for the Phase 1 attribution. The
correct line in `main` is **1243**. The 611 came from grepping `D:\repos\My_Site`, which sits on the
stale `phase1/review-followups` branch — evidence quoted from the stale checkout this very session
had been warning about for two days, in a PR whose other half is about stale-branch confusion.

**How it was caught:**

Independent review of PR #94, which reproduced the worktree behaviour empirically in a throwaway
repo rather than reasoning from the prose, and counted the tree to test the "193" claim.

**Fix applied:**

Both worktree bullets rewritten to distinguish nested from sibling layouts and to name
parent-directory discovery as the actual mechanism; the diff bullet now explains what the number
meant, with an inline note that the earlier explanation was invented and disproved. The config
bullet now separates *present-but-malformed* (fail fast) from *absent-but-optional* (degrade
deliberately). The check-then-act bullet no longer prescribes atomicity universally — it
distinguishes writes that must not double-apply from reads that merely go stale, and names
`ContactService.submit` as a knowingly-accepted instance.

**Takeaway for next time:**

- **Three of the four defects were invented *explanations*, not wrong observations.** The husk
  behaviour was real, the 193 was real, the incident was real. What was fabricated each time was
  the *because*. This is now the fourth documented instance of the same authorial habit, after the
  retracted timezone claim and the false "corrected" note — and unlike a wrong observation, a wrong
  mechanism reads as insight and gets repeated.
- **Catching a class of error once does not immunise the next paragraph.** The DEBUG rule was
  corrected precisely because it contradicted the code; the config rule contradicted the *same
  file* and shipped anyway. After finding one contradiction between a proposed rule and the
  codebase, grep for the others rather than assuming the one found was the only one.
- **Line-number citations need the branch named, or they need re-deriving.** Better still, quote
  the text and let the reader search — line numbers in a file that grows by hundreds of lines a
  day are stale before the PR is merged.

## 2026-08-08 — Project date period (#85): contract-first across two agents, and three bugs the obvious implementation would have shipped

**Task given:**

Close the spec/model divergence found during Phase 6 content drafting: `SPEC.md` had promised
"dates" on project detail since Phase 0, but `Project` only ever had `created_at`/`updated_at`.
Add a real date period, contract-first.

**Agent(s) used:**

Senior Dev wrote the contract (`docs/openapi.yaml`, `docs/DATA_MODEL.md`, the ADR) and validated it
before dispatching anything. Then `backend-agent` and, once the backend was verified,
`frontend-agent` — each building against the settled contract, neither reading the other's code.
Sequential, per `docs/AGENT_WORKFLOW.md`'s Phase 6 default.

**What went right:**

Contract-first worked as advertised, for the first time on this project with a genuinely
cross-cutting change. Both halves matched the contract field-for-field on the first attempt, with no
integration round. The backend explicitly confirmed the contract was implementable as written rather
than quietly diverging — a stop-and-report condition in its brief.

**~~Three~~ two bugs the obvious implementation would have shipped** (the count was corrected on
2026-08-08 — item 2 below was an overclaim by the Senior Dev and is retracted in place):

1. **A `CHECK` constraint that would have permitted what it existed to forbid.** The natural
   `CHECK (completed_on >= started_on)` evaluates to NULL for a completed-but-never-started row, and
   a `CHECK` is *satisfied* by NULL — so it would silently allow exactly one of the two cases it was
   written to reject. Written instead as
   `completed_on IS NULL OR (started_on IS NOT NULL AND completed_on >= started_on)`, which can never
   evaluate to NULL. Flagged in the dispatch brief as a known trap, reasoned through by the agent,
   then verified by building the truth table directly in Postgres rather than reading the SQL — both
   must-reject cases return `f`, not NULL.
2. ~~**A timezone bug in date rendering.**~~ **Retracted 2026-08-08 — this claim was wrong, and it
   was mine.** The original entry said `new Date('2024-03-01')` parses as UTC midnight and would
   therefore render **February 2024** in a negative-offset timezone, and credited the frontend's
   string-surgery conversion with preventing it. The first half is true of `new Date` in isolation;
   the conclusion does not follow. Angular's `DatePipe` never calls `new Date(value)` for that
   shape — `toDate` in `@angular/common` matches `/^(\d{4}(-\d{1,2}(-\d{1,2})?)?)$/` and builds a
   **local** date via `createDate(y, m - 1, d)` (verified by reading the installed 21.2.19 source,
   after an independent reviewer disputed the claim). So the obvious implementation,
   `{{ startedOn | date: 'LLLL y' }}`, would have rendered correctly in every timezone. No bug was
   prevented here.

   The string-surgery util is still the right call — it is independent of pipe internals, and the
   trap is real for anyone who reaches for `new Date()` directly — but "prevented a shipped bug" was
   an overclaim. Left visible rather than deleted: this file is the source for Phase 7b's public
   build-log page, and a log about unverified claims that quietly edits its own mistakes would be
   worth nothing.
3. **A validator that worked only inside Spring.** A package-private `ConstraintValidator` resolves
   fine through Spring's bean factory but fails under a plain
   `Validation.buildDefaultValidatorFactory()`, which requires a public class (HV000064). The 12
   in-container MockMvc tests were green while the standalone unit test was 7/7 erroring. An
   in-container-only suite would never have surfaced it.

**A junior correctly refused an instruction.** The ADR records "1st of the month" as the storage
convention, so the obvious move is to snap picked dates. The frontend agent declined: snapping would
rewrite a stored `2024-03-17` to `2024-03-01` on any unrelated edit — a silent data change directly
contradicting the round-trip requirement in the same brief. It stores the day as picked, never
renders it, and flagged the decision for reversal rather than burying it. Accepted.

It also **proved its own mutation testing had been undone** — grep for markers plus the committed
diff — a direct response to the incident logged below, where an agent died mid-mutation and left a
live defect in the working tree. The `CLAUDE.md` guidance written that day was picked up and applied
without being restated.

**What went wrong (be specific):**

No implementation defect reached a branch — both halves passed their gates first time (backend 84
tests / BUILD SUCCESS, frontend 30 → 52, build clean, E2E 7/7). What went wrong was in *this entry*:
the Senior Dev credited the frontend with preventing a timezone bug that Angular's `DatePipe` would
never have produced, and wrote it up as fact without checking the pipe's behaviour. See the
retraction at item 2 above.

That is the second false claim written into `AGENT_LOG.md` in two days by the same author — after
the 2026-08-07 index shipped three, and after a "corrected" note in `AUTONOMOUS_WORKFLOW.md` claimed
to fix a rule that document never contained. All three were caught by independent review, none by
self-review.

A second, smaller gap the same review found: **the E2E suite's `e2e/support/api.ts` declares itself
as following `docs/openapi.yaml` but is a hand-written mirror**, and it did not gain the two new
fields. So "E2E 7/7" was a true statement that said nothing whatsoever about this feature — no
fixture or assertion touches a date. A green gate that cannot observe the change under test is
exactly the failure mode this log is otherwise full of, arrived at from a new direction.

**How it was caught:** independent review of PR #91, disputing a claim in the entry rather than in
the code, and verifying against the installed `@angular/common` source.

**Fix applied:** claim retracted in place rather than deleted, with the evidence. `e2e/support/api.ts`
updated so the E2E contract mirror actually mirrors the contract.

**Takeaway for next time / non-obvious judgment calls made:**

0. **Writing up a *prevented* bug requires proving the bug was reachable.** A caught bug comes with
   evidence attached — a red test, a bad response. A prevented one comes with none, so "the obvious
   implementation would have shipped X" is a claim about a counterfactual and has to be tested like
   one: write the obvious implementation, or at minimum read what it actually does. Both false
   claims this author has put in this file were of this shape — asserting what *would* have happened
   rather than reporting what did. The near-miss write-ups are the most quotable entries here and
   therefore the ones most worth doubting.
1. **A `CHECK` constraint involving a nullable column needs its truth table checked, not just read.**
   Three-valued logic makes "obviously correct" constraints permissive in exactly the cases that
   matter. Same family as every other silent-success bug in this log: the mechanism reports success
   by doing nothing.
2. **`ProjectWriteRequest` is also the PUT body, so omitting a field clears it.** Documented in the
   contract deliberately, because it makes the admin edit form a data-loss hazard if it does not
   round-trip existing values — a bug that only appears on a user's *second* edit. Covered by a test
   specifically.
3. **Version skew in the test stack.** Testcontainers runs `postgres:17-alpine`; the local dev
   database is 18.4. Both accepted V4 identically, but "mvn test is green" is not the same claim as
   "it works on the deployed version" — worth settling a production Postgres version in Phase 5
   rather than discovering the gap there.
4. **`ProjectWriteRequest` is a positional record**, so adding two components broke all 8 existing
   constructor call sites in tests. Cheap at this size; worth a builder or named test factory before
   the record grows further.
5. **Prettier is configured (`frontend/.prettierrc`) but unenforced, and most existing files already
   fail it.** The frontend agent formatted only its own files rather than dumping unrelated churn
   into the diff — correct call, but the inconsistency is now visible and wants a decision.

## 2026-08-08 — Senior Dev: three agents lost to session limits, all salvaged by hand when they should have been resumed

**Task given:**

Not a task — a process failure of the Senior Dev's own, noticed only when the user asked whether a
terminated agent could be resumed rather than picked up from where it died. It could. It should
have been.

**Agent(s) used:**

Senior Dev session (this one) as the party at fault. Three dispatched juniors terminated by API
session limits across 2026-08-07: the Phase 4 E2E implementation, the PR #82 fix round, and the
PR #83 fix round.

**What went wrong (be specific):**

A dispatched agent that dies can be continued with **`SendMessage` addressed to its agent ID, which
the tooling states preserves its context** — a fresh `Agent` call starts cold instead. The
completion notification for each failed agent said this explicitly, and noted the same task ID can
fire more than once for exactly this reason. It was read three times and acted on zero times.

Stated precisely, because this entry is about not overclaiming: the capability is documented in the
tooling's own notification text and was **not** verified in this session — nobody attempted a
resume. `CLAUDE.md` carries the same caveat. What is certain is that resuming was never *tried*,
not that it would have worked.

Instead, each death was handled by inspecting the abandoned worktree, inferring what the agent had
been trying to do, and finishing it manually. The three cases were not equally bad. For the Phase 4
E2E agent the salvage was harmless — its work was already committed, only verification was
outstanding, and running the gate is the Senior Dev's job anyway (that gate is what caught the suite
having never been executed, which is logged separately and stands on its own). The PR #82 fix agent
left coherent uncommitted work that reviewed cleanly. The PR #83 fix agent is the one that mattered.

**The near-miss, which is the reason this is worth logging at all.** The PR #83 fix agent had
finished its fixes and moved on to *mutation-testing its own tests* — deliberately reintroducing
each bug to confirm the test caught it. It died with a mutation still applied. Its final streamed
words were `"Restoring, then testing the [attr.loading] collapse."`

So the working tree contained a live, intentional defect: a single `<img>` using `[attr.loading]`,
sitting directly beneath a comment its own author had written explaining why that construct must
**not** be used (a binding lands in the update pass after `src`, silently defeating lazy loading
while every attribute still reads correctly in the DOM). Committing that state would have shipped
the exact bug the new tests existed to prevent, under a comment asserting the opposite.

What caught it: noticing the code contradicted the comment three lines above it, then running the
suite, which failed with `expected [ 'src', 'loading' ] to deeply equal [ 'loading', 'src' ]` — the
mutation test working precisely as designed. Resuming the agent would have avoided the whole
episode, because the agent knew it had a mutation applied and that restoring it was the next step.

**How it was caught:** the user asked, directly, whether resuming was possible. Not by any check
the Senior Dev ran.

**Fix applied:**

`CLAUDE.md` gained a "When a dispatched agent dies mid-task" section — resume rather than salvage;
a dying agent's last message is a fragment and not a status report; if salvage is genuinely
unavoidable, treat the working tree as an unknown intermediate state and run the tests *first*
rather than last. `docs/AUTONOMOUS_WORKFLOW.md` cross-references it.

**Takeaway for next time:**

- **"Died just before committing" and "died in the middle of a deliberate experiment" are
  indistinguishable from outside the process.** Both leave coherent-looking uncommitted work. The
  second is dangerous precisely because the work looks finished, and the agent's own comments
  describe the intended state rather than the actual one. Only running the tests separates them.
- **Read the affordances the tooling hands you.** The resume instruction was in the text of all
  three failure notifications. This is the same class of error as the rest of this log — a signal
  present and unexamined — except the signal here was an explicit instruction, not a subtle one.
- **Three consecutive identical failures should have prompted a process question, not a third
  workaround.** After the second manual salvage the right response was to ask whether salvage was
  the correct move at all. Repetition of a workaround is itself evidence worth reading.
- **A correction has to be checked as carefully as the thing it corrects.** The first version of
  this change shipped a note in `docs/AUTONOMOUS_WORKFLOW.md` claiming to correct a stale rule
  ("the Senior Dev now launches reviewers itself, rather than handing a prompt to the user") — but
  that document had said "dispatches PR review to independent sessions" in its opening paragraph
  since its very first commit. The hand-the-prompt-over instruction came from a *session kickoff
  prompt*, not from any doc. A false "corrected 2026-08-07" note was therefore written into the
  permanent record, inside a PR whose whole subject is being honest about process failures, and was
  caught by the independent review rather than by its author. Verify what a document actually says
  before writing that you have corrected it.
- **The same change also missed two files saying the superseded thing** (`PROJECT_TODO.md` line 69
  and `docs/DECISIONS.md`'s 2026-08-02 ADR) — and line 69 already carried a note recording that it
  had been missed the *previous* time this doc changed. `CLAUDE.md`'s doc-currency rule exists for
  exactly this and still was not enough; grep for the superseded claim across the repo rather than
  updating the file you happen to be editing.

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
