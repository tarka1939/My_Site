# End-to-end tests (Playwright)

Four critical user journeys, driven through a real browser against a real backend and a real
Postgres. This is the top of the testing pyramid described in `PROJECT_TODO.md`, and it is
capped on purpose: **3-5 journeys, deliberately thin.** Breadth belongs in the frontend's Vitest
component tests and the backend's Testcontainers integration tests, which are faster and far
less brittle. Resist adding a fifth journey unless it covers a path nothing else can.

## Why this lives in `/e2e` and not in `/frontend`

Phase 5 deploys `frontend/` to Netlify. Putting Playwright in `frontend/package.json` would make
every Netlify build install a browser automation framework and (with `postinstall`) potentially
a browser binary, for no benefit. `frontend/package.json` is left untouched.

## Prerequisites

1. **Node 24+** (matches the rest of the repo).
2. **Docker**, for Postgres. There is no `docker-compose.yml` until Phase 5, so run one yourself:

   ```bash
   docker run -d --name mysite-e2e-pg \
     -e POSTGRES_USER=mysite -e POSTGRES_PASSWORD=mysite -e POSTGRES_DB=mysite_dev \
     -p 5432:5432 postgres
   ```

3. **JDK 25 and Maven on `PATH`** (or `JAVA_HOME`/`MAVEN_HOME` set) — Playwright starts the
   backend itself via `mvn spring-boot:run`, so it needs to be able to find them.
4. **`frontend` dependencies installed** (`cd frontend && npm install`) — Playwright starts
   `npm start` but does not install for you.
5. **This directory's dependencies and a browser:**

   ```bash
   cd e2e
   npm install
   npm run install:browsers
   ```

## Running

```bash
cd e2e
npm test                 # the whole suite, headless
npm run test:headed      # watch it drive a real browser
npm run test:ui          # Playwright's interactive UI mode
npm run report           # open the HTML report from the last run
npx playwright test tests/admin.spec.ts        # one journey
npx playwright test -g "rate limit"            # one test by name
```

Playwright brings the **backend** (`mvn spring-boot:run -Dspring-boot.run.profiles=dev`, port
8080) and the **frontend** (`npm start`, port 4200) up itself, and reuses them if they are
already running. Postgres is deliberately *not* managed by the test runner: wiring a database
container's lifecycle into a test suite is how a suite ends up dropping a developer's database
on exit.

The browser always drives `http://localhost:4200`, never `:8080` — `frontend/proxy.conf.json`
forwards `/api/*` to the backend so the page sees same-origin requests. The backend has no CORS
configuration until Phase 5, so hitting `:8080` from the page would fail.

### If your system drive is short on space

Playwright downloads browsers to `%LOCALAPPDATA%\ms-playwright` (Windows) or `~/.cache`
(Linux/macOS), which is roughly 200 MB. If that drive is full, point both the install and the
run at somewhere else:

```bash
export PLAYWRIGHT_BROWSERS_PATH=/d/some/other/place   # must be set for BOTH commands
npm run install:browsers
npm test
```

## The test admin account, and why it touches the database directly

Everything this suite does goes through the real HTTP API — logging in, seeding fixture
projects, reading back what was persisted, cleaning up — with exactly one exception:
**provisioning the admin account it logs in as.**

That exception is forced by two deliberate product decisions:

- `docs/DECISIONS.md`'s "Auth flow" ADR rules out a registration endpoint. There is no API path
  that creates an `AdminUser`.
- The plaintext password behind the bcrypt hash in `V2__admin_user_email_and_seed.sql` was never
  committed (generated once, shared out of band), so the seeded `admin` account cannot be logged
  into from a checkout of this repository.

So `setup/global.setup.ts` inserts a **separate, test-only** admin row directly into Postgres:

| | |
|---|---|
| Username | `e2e-admin` |
| Password | `e2e-only-not-a-secret-8f2c1d` |
| Email | `e2e-admin@e2e.invalid` |

**That password is public. It is in this file and in `support/env.ts`, on purpose.** It grants
full admin write access to whatever database it exists in, so `support/db.ts` refuses to run
unless the target host is `localhost`/`127.0.0.1`/`::1`, and fails loudly rather than skipping
the check. There is intentionally no override flag — if you find yourself wanting one, the
answer is a different account, not a bypass. The account uses a distinct username so it can
never collide with or overwrite the real seeded `admin` row, and teardown deletes it again.

Connection settings default to the `docker run` above and can be overridden with `E2E_DB_HOST`,
`E2E_DB_PORT`, `E2E_DB_NAME`, `E2E_DB_USERNAME`, `E2E_DB_PASSWORD`.

## Journeys

| File | Journey |
|---|---|
| `tests/projects.spec.ts` | Browse projects → filter by tag → open a project's detail page. Asserts the filter both keeps one fixture and drops the other, then that the detail page renders the stored title, description, tags, and link. |
| `tests/contact.spec.ts` | Submit the contact form. Asserts an actual `201`, that an empty form never reaches the API, and reads the message back through the admin API rather than trusting the confirmation banner. |
| `tests/contact.spec.ts` | Fill the contact rate-limit window and get rejected. Asserts an actual `429` with the RFC 7807 body, that the user-visible error appears, and that exactly the allowed number of messages was stored. |
| `tests/admin.spec.ts` | Admin logs in → creates a project through the UI → it appears on the public (unauthenticated) list → logs out → `authGuard` redirects a protected route back to login with `returnUrl` intact. |

## How state is kept clean

Reruns must not depend on how the previous run ended, so:

- Everything the suite creates is namespaced — projects by an `[E2E]` title prefix, contact
  messages by the reserved `@e2e.invalid` email domain. Cleanup only ever matches those, never a
  developer's own local data.
- `setup` **purges before it seeds**, so a run that was interrupted before teardown cannot poison
  the next one. Teardown purges again and removes the `e2e-admin` row.
- Tag names are fixed rather than unique-per-run. Tags are upserted implicitly by project writes
  and there is no `DELETE /tags`, so per-run tag names would leave an ever-growing pile of orphan
  rows in the tag filter UI.
- The contact journeys purge their own messages between tests. `ContactService` derives its rate
  limit from a `count(*)` over `contact_message`, so deleting the rows is also what resets the
  window — without it the suite would pass once per hour.

## Things worth knowing before you extend this

- **`AuthService` rate-limits login to 5 attempts per 15 minutes per IP.** The suite spends
  exactly one per run (the admin journey's real UI login); `setup` caches its API token in
  `.auth/api-token.json` (gitignored) and revalidates it instead of logging in again. If you add
  a journey that logs in, you are spending from a budget of five. That limiter is in-memory
  (`InMemoryRateLimiter`), unlike the contact form's, so restarting the backend clears it —
  which is the escape hatch if you ever do hit a `429` on login.
- **Run serially.** `workers: 1` / `fullyParallel: false` is not laziness: the journeys share one
  seeded dataset and one per-IP rate-limit window on the server. Parallel workers would race on
  both.
- **No local retries.** A journey that only passes on the second attempt is a defect in the test
  or the app. CI gets one retry for infrastructure noise, nothing more.
- **No `waitForTimeout`.** Use web-first assertions and `waitForResponse`; the suite asserts on
  real HTTP status codes, not just on rendered text.
- **Prefer role- and label-based locators.** Phase 3 did real accessibility work — semantic
  headings, `aria-label`s, `aria-pressed` on the tag filters, labelled form controls. Use it
  instead of CSS chains; a locator that breaks when a class is renamed is worse than no test.
- **Fixture projects have no images.** Images are stored as external URLs
  (`docs/DECISIONS.md`, 2026-07-24), so a fixture with images would make the suite depend on a
  third-party host being reachable.
- **Project tag order is not deterministic.** The backend holds tags in a `HashSet` and returns
  `Set.copyOf(...)`, whose iteration order is randomized per JVM run. Assert tag *membership*,
  never order.
