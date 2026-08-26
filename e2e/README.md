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
full admin write access to whatever stack it exists in, so `support/locality.ts` refuses any
target whose host is not `localhost`/`127.0.0.1`/`::1`, and fails loudly rather than skipping the
check. That covers **both** paths that can do damage, not just the database one:

- the direct `INSERT` in `support/db.ts`, and
- `E2E_BACKEND_URL`, which `setup` and `teardown` aim `DELETE /projects/{id}` and
  `DELETE /contact-messages/{id}` at. `E2E_FRONTEND_URL` is checked the same way.

Both URLs are validated as they are read, so a bad value fails at import time — before Playwright
loads its config, and long before anything could be deleted. There is intentionally no override
flag; if you find yourself wanting one, the answer is a different account, not a bypass.

The account uses a distinct username so it can never collide with or overwrite the real seeded
`admin` row. Teardown deletes the row **and** the JWT cached in `.auth/api-token.json`, and does
both **unconditionally** — even when the run failed before it ever acquired a token, and even
when cleanup itself fails. Deleting the row alone would not be enough: the backend is a stateless
resource server that never re-checks a token's subject, so a token minted before the delete keeps
working for the rest of its hour.

### Database connection settings

`E2E_DB_NAME`, `E2E_DB_USERNAME` and `E2E_DB_PASSWORD` default to the `docker run` above. Change
any of them and you must **also** set the backend's own `DB_NAME` / `DB_USERNAME` / `DB_PASSWORD`
to match — different names, same values. Otherwise the suite provisions `e2e-admin` into a
database the application never opens, and the admin journey fails with an unexplained `401`.

There is deliberately **no** host or port override. `backend/src/main/resources/application-dev.yml`
hardcodes `jdbc:postgresql://localhost:5432/...` and exposes no environment variable for either,
so moving the suite's host or port could only ever point it at a *different* database than the
application under test.

## Journeys

| File | Journey |
|---|---|
| `tests/projects.spec.ts` | Browse projects → filter by tag → open a project's detail page. Asserts the filter both keeps one fixture and drops the other, then that the detail page renders the stored title, description, tags, and link. Also carries the content-rendering assertions of issue #99: the card summarises a long description, the line clamp holds it to three rendered lines, the gallery's alt text names the image's position, and no alt text claims to know what an image contains. |
| `tests/contact.spec.ts` | Submit the contact form. Asserts an actual `201`, that an empty form never reaches the API, and reads the message back through the admin API rather than trusting the confirmation banner. |
| `tests/contact.spec.ts` | Fill the contact rate-limit window and get rejected. Asserts an actual `429` with the RFC 7807 body, that the user-visible error appears, and that exactly the allowed number of messages was stored. |
| `tests/admin.spec.ts` | Admin logs in → creates a project through the UI → it appears on the public (unauthenticated) list → logs out → `authGuard` redirects a protected route back to login with `returnUrl` intact. |

## How state is kept clean

Reruns must not depend on how the previous run ended, so:

- Everything the suite creates is namespaced — projects by an `[E2E]` title prefix, contact
  messages by the reserved `@e2e.invalid` email domain. Cleanup only ever matches those, never a
  developer's own local data.
- `setup` **purges before it seeds**, so a run that was interrupted before teardown cannot poison
  the next one. Teardown purges again, and removes the `e2e-admin` row and its cached token —
  those two unconditionally, so a run that died before it ever logged in still cleans up the
  credential it had already created.
- The admin journey purges its own tag before **each attempt**, not after, so CI's single retry
  starts from a clean slate instead of tripping over the project the failed attempt already
  created.
- Tag names are fixed rather than unique-per-run. Tags are upserted implicitly by project writes
  and there is no `DELETE /tags`, so per-run tag names would leave an ever-growing pile of orphan
  rows in the tag filter UI.
- The contact journeys purge their own messages between tests, which reclaims the rate-limit
  slots the suite spent: `ContactService` derives its limit from a `count(*)` over
  `contact_message` rather than from in-memory state, so deleting rows really does move the
  counter. It does **not** free the whole window, though — the count is keyed on requester IP
  hash, not on email, so a message you submitted by hand from this machine within the last hour
  still costs a slot, and cleanup here will never touch it (it only ever matches `@e2e.invalid`;
  deleting your real messages is not this suite's call). The rate-limit journey needs all five
  slots, so it asserts that precondition up front and tells you how to clear it, instead of
  failing mid-loop on a 429 that looks like an application bug.

## Things worth knowing before you extend this

- **`AuthService` rate-limits login to 5 attempts per 15 minutes per IP.** The suite spends **two**
  per run: `setup` logs in for its API token, and the admin journey logs in through the UI for
  real. The token `setup` caches in `.auth/api-token.json` (gitignored) is reused for the rest of
  that run, but deliberately *not* across runs — teardown deletes it, because a token that
  outlives the account it was minted for is a live admin credential sitting on disk, and the
  backend never re-checks a token's subject. One extra login per run is the price of that.

  Whether the budget ever bites depends on who owns the backend. That limiter is in-memory
  (`InMemoryRateLimiter`), unlike the contact form's, so it dies with the process:

  - **Playwright started the backend** (nothing was on :8080) — it also stops it at the end, so
    every run gets a fresh limiter and the budget effectively resets. You will not hit this.
  - **You started the backend** and Playwright is reusing it — the count accumulates across runs,
    so roughly the **third** run inside a 15-minute window fails on a `429`.

  Either way the escape hatch is the same: **restart the backend**. `acquireToken` says so in the
  error rather than surfacing a bare status code.
- **Run serially.** `workers: 1` / `fullyParallel: false` is not laziness: the journeys share one
  seeded dataset and one per-IP rate-limit window on the server. Parallel workers would race on
  both.
- **No local retries.** A journey that only passes on the second attempt is a defect in the test
  or the app. CI gets one retry for infrastructure noise, nothing more. That retry does mean any
  journey which *writes* must be idempotent across attempts — nothing runs between a failed
  attempt and its retry, so reset the rows it owns in a `beforeEach`, the way `admin.spec.ts`
  and `contact.spec.ts` do. A retry that cannot win is worse than no retry: its failure message
  describes the leftover state, not the original defect.
- **No `waitForTimeout`.** Use web-first assertions and `waitForResponse`; the suite asserts on
  real HTTP status codes, not just on rendered text.
- **Prefer role- and label-based locators.** Phase 3 did real accessibility work — semantic
  headings, `aria-label`s, `aria-pressed` on the tag filters, labelled form controls. Use it
  instead of CSS chains; a locator that breaks when a class is renamed is worse than no test.
- **Fixture images are served by the test, not fetched.** They used to be absent entirely, on the
  correct reasoning that images are external URLs (`docs/DECISIONS.md`, 2026-07-24) and a fixture
  with images would make the suite depend on a third-party host. Issue #99 is the cost of that:
  with no images, nothing here could catch a regression in the gallery's alt text or the card
  thumbnail's `alt=""`. Both are kept: `FIXTURE_ALPHA_IMAGES` are absolute `https:` URLs on
  `images.e2e.invalid`, a hostname RFC 2606 guarantees can never resolve, and `stubFixtureImages`
  (`support/images.ts`) fulfils them from bytes the test owns. **Call it before the first
  `page.goto` of any spec that reaches the public project list** — `projects.spec.ts` and
  `admin.spec.ts` both do. **Omitting it fails `projects.spec.ts` outright**, which it did not
  before #156: a card image that errors is now replaced by generated artwork, so a card whose URL
  fails DNS renders no `<img>` for the thumbnail assertions to find. The detail gallery still keeps
  its `<img>` and falls back to a broken-image placeholder, which is what its `naturalWidth` poll
  is there to catch. Nothing in CI runs this suite, so that note and the one in `support/images.ts`
  are the only warning a future reader gets.
- **Alpha is long and imaged; Beta is short and imageless. That asymmetry is load-bearing.** It is
  what lets one journey prove the card *summarises* a long description rather than truncating
  unconditionally, that the CSS line clamp actually lays out, and that a project with no images
  renders no `<img>` at all. `projects.spec.ts` measures the rendered height of
  `.card-description` and divides by the computed line-height, because **a real browser is the
  only place this is checkable**: jsdom performs no layout, so a component test can see
  `line-clamp: 3` on the element and never that the element is eight lines tall. Deleting
  `-webkit-box-orient: vertical` once did exactly that. Assert the *box*, never the declaration.
  If you shorten Alpha's description, the clamp assertion fails on its own precondition rather
  than passing vacuously.
- **Await `waitForFontsReady` (`support/fonts.ts`) before measuring anything geometric.** The
  clamp assertion's stability used to rest on the site being `system-ui` with no webfonts, so there
  was no `font-display: swap` reflow to race. Since the 2026-08-22 visual direction the site
  self-hosts Archivo and IBM Plex, and a measurement taken mid-swap compares a fallback's line
  count against a webfont's. The faces carry metric overrides that make the swap nearly free, which
  is not the same as free — and a layout test that is right almost every time teaches people to
  press re-run rather than to look.
- **Project tag order is not deterministic.** The backend holds tags in a `HashSet` and returns
  `Set.copyOf(...)`, whose iteration order is randomized per JVM run. Assert tag *membership*,
  never order.
