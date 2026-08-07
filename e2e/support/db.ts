import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from './env';
import { assertLocalHost } from './locality';

/**
 * The one and only thing in this suite that touches Postgres directly. Everything else goes
 * through the real HTTP API.
 *
 * Why the exception: there is no API path to create an admin user. `docs/DECISIONS.md`'s
 * "Auth flow" ADR deliberately rules out a registration endpoint, and the plaintext password
 * behind `V2__admin_user_email_and_seed.sql`'s bcrypt hash was never committed. So the account
 * the suite logs in with has to be provisioned out of band, once, before any HTTP call happens.
 */

/**
 * Connection settings for the *same* database the backend under test is using — not an
 * independent target. That is a real constraint, not a preference:
 * `backend/src/main/resources/application-dev.yml` hardcodes
 * `jdbc:postgresql://localhost:5432/${DB_NAME:mysite_dev}`, so it exposes no env var for host
 * or port at all, and names the other three `DB_NAME` / `DB_USERNAME` / `DB_PASSWORD`.
 *
 * So `E2E_DB_HOST` and `E2E_DB_PORT` can only ever be moved *away* from what the application
 * reads — they are kept solely so the locality guard below has something to check, and
 * `e2e/README.md` deliberately does not advertise them as overrides. The other three must be
 * set in both namespaces or the suite provisions `e2e-admin` into a database the backend never
 * opens, which surfaces later as an unexplained 401 on the admin journey's login.
 */
const DB_HOST = process.env.E2E_DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 5432);
const DB_NAME = process.env.E2E_DB_NAME ?? 'mysite_dev';
const DB_USER = process.env.E2E_DB_USERNAME ?? 'mysite';
const DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? 'mysite';

/**
 * The admin row written below carries a password committed to a public repository in plain
 * text, so the insert has to be *impossible* to aim anywhere but a local throwaway. The
 * allowlist itself lives in `support/locality.ts`, shared with the destructive HTTP path in
 * `support/api.ts` — the guard's promise was only half true while it covered this file alone.
 */
function assertLocalDatabase(): void {
  assertLocalHost(DB_HOST, 'E2E_DB_HOST');
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Upserts the dedicated E2E admin account. Idempotent: reruns reset the password hash rather
 * than failing on the unique username index, so a suite run never depends on how the previous
 * one ended.
 */
export async function provisionE2eAdmin(): Promise<void> {
  assertLocalDatabase();

  // Cost 10 matches Spring's BCryptPasswordEncoder default. bcryptjs emits a $2b$ hash, which
  // Spring's BCrypt verifies alongside $2a$/$2y$ — no encoder configuration needed.
  const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);

  await withClient(async (client) => {
    // Guard against a schema that hasn't been migrated yet — a confusing "relation does not
    // exist" from pg is much harder to act on than this.
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.admin_user') IS NOT NULL AS exists`,
    );
    if (!rows[0]?.exists) {
      throw new Error(
        `Table admin_user does not exist in ${DB_NAME}. Start the backend once so Flyway ` +
          `runs its migrations, then rerun the E2E suite.`,
      );
    }

    await client.query(
      `INSERT INTO admin_user (username, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE
         SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash`,
      [E2E_ADMIN_USERNAME, E2E_ADMIN_EMAIL, passwordHash],
    );
  });
}

/**
 * Removes the E2E admin row. Called by teardown so a dev's local database is left as close to
 * how it was found as possible.
 */
export async function removeE2eAdmin(): Promise<void> {
  assertLocalDatabase();
  await withClient(async (client) => {
    await client.query(`DELETE FROM admin_user WHERE username = $1`, [E2E_ADMIN_USERNAME]);
  });
}

export const dbTargetDescription = `${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
