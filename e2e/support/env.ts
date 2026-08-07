import { fileURLToPath } from 'node:url';
import { assertLocalUrl } from './locality';

/**
 * Single place where every environment-dependent value and every magic string the suite
 * relies on is defined. Nothing else in the suite should read `process.env` directly.
 *
 * Both URLs below are run through `support/locality.ts` as they are read, so a target outside
 * the loopback allowlist fails at import time — before Playwright loads its config, and long
 * before `purgeE2eData` could issue a DELETE against it.
 */

/** Angular dev server. Always drive the browser through this, never the backend directly:
 *  `frontend/proxy.conf.json` forwards `/api/*` to the backend so the browser sees
 *  same-origin requests. The backend has no CORS config until Phase 5, so hitting :8080
 *  from the page would fail. */
export const FRONTEND_URL = assertLocalUrl(
  process.env.E2E_FRONTEND_URL ?? 'http://localhost:4200',
  'E2E_FRONTEND_URL',
);

/** Spring Boot. Used only by Node-side fixture seeding/cleanup, never by the browser. */
export const BACKEND_URL = assertLocalUrl(
  process.env.E2E_BACKEND_URL ?? 'http://127.0.0.1:8080',
  'E2E_BACKEND_URL',
);

export const API_BASE = `${BACKEND_URL}/api/v1`;

/**
 * Test-only admin account, provisioned directly into the local Postgres by `setup/global.setup.ts`.
 *
 * This exists because there is no API path to create an admin: `docs/DECISIONS.md`'s "Auth flow"
 * ADR rules out a registration endpoint, and the plaintext password for the `admin` row seeded by
 * `V2__admin_user_email_and_seed.sql` was deliberately never committed. A distinct username keeps
 * this row from ever colliding with (or overwriting) that real seeded account.
 *
 * The password below is public by definition. `support/db.ts` refuses to run against anything
 * but a local database precisely so that this can never be inserted somewhere it matters.
 */
export const E2E_ADMIN_USERNAME = 'e2e-admin';
export const E2E_ADMIN_PASSWORD = 'e2e-only-not-a-secret-8f2c1d';
export const E2E_ADMIN_EMAIL = 'e2e-admin@e2e.invalid';

/**
 * Every row this suite creates is namespaced so cleanup can find it by prefix and never
 * touch a developer's own local data. Fixed rather than per-run on purpose: `setup` purges
 * leftovers before seeding, so a previous run that crashed before teardown can't poison the
 * next one, and the suite stays rerunnable without wiping the database.
 */
export const E2E_TITLE_PREFIX = '[E2E]';
export const E2E_EMAIL_DOMAIN = '@e2e.invalid';

/**
 * Fixed tag names rather than per-run unique ones: tags are upserted implicitly by project
 * writes and there is no DELETE /tags, so unique-per-run tags would leave an ever-growing
 * pile of orphan rows in the tag filter.
 */
export const TAG_SHARED = 'e2e-fixture';
export const TAG_ALPHA = 'e2e-alpha';
export const TAG_BETA = 'e2e-beta';
/** Used only by the project the admin journey creates through the UI, so it can be found on
 *  the public list without depending on how much other content the database happens to hold. */
export const TAG_ADMIN_CREATED = 'e2e-admin-created';

/** Where `setup` caches the admin JWT for the rest of the run. Gitignored.
 *  `fileURLToPath`, not `URL.pathname` — the latter yields `/D:/...` on Windows. */
export const TOKEN_FILE = fileURLToPath(new URL('../.auth/api-token.json', import.meta.url));
