/**
 * The suite's single "this target must be local" rule, shared by every path that can mutate
 * something.
 *
 * It exists because `support/env.ts` carries an admin password that is committed to this
 * repository in plain text, and two different code paths act on it:
 *
 * - `support/db.ts` inserts that account straight into Postgres.
 * - `support/api.ts` issues `DELETE /projects/{id}` and `DELETE /contact-messages/{id}` against
 *   `BACKEND_URL` — during `setup` as well as `teardown` — authenticated as exactly that account.
 *
 * The second is the more destructive of the two and used to be unguarded, which made the
 * database guard's promise ("this can only ever run locally") narrower than it read. Both are
 * checked here now, at module load, so a mistyped `E2E_BACKEND_URL` fails before Playwright
 * starts rather than partway through a purge.
 *
 * This is a structural guard, not a warning. Do not add a force flag or an env-var override —
 * if you want to point this suite at a shared environment, the answer is a different account,
 * not a bypass.
 */

/**
 * Loopback names only, matched exactly. Everything else fails closed, which is what keeps near
 * misses like `127.0.0.2`, `0.0.0.0`, a trailing-dot `localhost.`, or a hostname that merely
 * resolves to loopback out — an allowlist gets that for free, a denylist would not.
 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

const WHY =
  `This suite provisions an admin account whose password is committed to this repository in ` +
  `plain text (see e2e/README.md), and uses it to delete projects and contact messages. It ` +
  `must only ever point at a throwaway local stack.`;

function refuse(source: string, resolved: string, detail = ''): never {
  throw new Error(
    `Refusing to run the E2E suite against a non-local target.\n` +
      `  ${source} resolved to: ${resolved}${detail}\n` +
      `  Allowed hosts: ${[...ALLOWED_HOSTS].join(', ')}\n` +
      WHY,
  );
}

/** Throws unless `host` is a loopback name. `source` names the env var, so the error says which
 *  knob to turn. */
export function assertLocalHost(host: string, source: string): void {
  if (!ALLOWED_HOSTS.has(host.trim().toLowerCase())) {
    refuse(source, host);
  }
}

/**
 * Same check against a URL's host, returning the URL so call sites can wrap a default inline.
 * `new URL(...).hostname` keeps IPv6 literals bracketed (`http://[::1]:8080` -> `[::1]`), which
 * is why the allowlist carries both spellings.
 */
export function assertLocalUrl(url: string, source: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    refuse(source, url, ' (not a parseable URL)');
  }
  if (!ALLOWED_HOSTS.has(hostname.toLowerCase())) {
    refuse(source, url, ` (host: ${hostname})`);
  }
  return url;
}
