import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from './env';

/**
 * The one and only thing in this suite that touches Postgres directly. Everything else goes
 * through the real HTTP API.
 *
 * Why the exception: there is no API path to create an admin user. `docs/DECISIONS.md`'s
 * "Auth flow" ADR deliberately rules out a registration endpoint, and the plaintext password
 * behind `V2__admin_user_email_and_seed.sql`'s bcrypt hash was never committed. So the account
 * the suite logs in with has to be provisioned out of band, once, before any HTTP call happens.
 */

const DB_HOST = process.env.E2E_DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 5432);
const DB_NAME = process.env.E2E_DB_NAME ?? 'mysite_dev';
const DB_USER = process.env.E2E_DB_USERNAME ?? 'mysite';
const DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? 'mysite';

/**
 * Hosts this suite is allowed to write an admin row into. Anything else is a hard stop.
 *
 * This is a structural guard, not a warning: the row inserted below carries a password that is
 * committed to a public repository in plain text (see `support/env.ts`). Making the insert
 * *impossible* to run against a non-local database is the only safe way to ship a fixture like
 * that. Do not add a "force" flag or an env-var override to this list.
 */
const ALLOWED_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

function assertLocalDatabase(): void {
  const host = DB_HOST.trim().toLowerCase();
  if (!ALLOWED_DB_HOSTS.has(host)) {
    throw new Error(
      `Refusing to provision the E2E admin user against a non-local database.\n` +
        `  E2E_DB_HOST resolved to: ${DB_HOST}\n` +
        `  Allowed: ${[...ALLOWED_DB_HOSTS].join(', ')}\n` +
        `This fixture inserts an admin account whose password is publicly known ` +
        `(see e2e/README.md). It must only ever run against a throwaway local Postgres.`,
    );
  }
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
