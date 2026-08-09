/**
 * The one "this target must be local" rule for the content seed, deliberately modelled on
 * `e2e/support/locality.ts` rather than invented fresh — same allowlist, same fail-closed shape,
 * same refusal to grow a `--force` flag.
 *
 * It exists because `seed.mjs` authenticates as an admin and issues writes: `POST`/`PUT
 * /projects` in its normal mode, and `DELETE /projects/{id}` under `--remove`. Pointed at a live
 * site, a mistyped host would overwrite published portfolio copy with copy its owner has not yet
 * signed off, or delete rows it did not create.
 *
 * The check runs at import time, before a token is ever requested, so a bad `SEED_BACKEND_URL`
 * fails on the first line of output rather than partway through a write loop.
 *
 * Two differences from the E2E guard, both deliberate:
 *
 *  - That suite may *never* run anywhere but loopback, because it carries a plaintext password in
 *    a committed file. This one has a real future need to run against the deployed backend, so it
 *    has a door. The door needs two independent keys (below) and today opens onto nothing.
 *  - Remote targets must be HTTPS. The admin password crosses this connection.
 */

/**
 * Loopback names only, matched exactly. Everything else fails closed, which is what keeps near
 * misses like `127.0.0.2`, `0.0.0.0`, a trailing-dot `localhost.`, or a hostname that merely
 * resolves to loopback out — an allowlist gets that for free, a denylist would not.
 *
 * Copied verbatim from `e2e/support/locality.ts`. Two files rather than one shared module because
 * `/e2e` is an npm package with its own toolchain and this directory is dependency-free
 * standard-library Node; importing across that boundary would drag one into the other. If a third
 * caller ever appears, that is the moment to extract it properly.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

/**
 * Deployment hosts this script is permitted to write to. **Deliberately empty, and correct as
 * empty.**
 *
 * Phase 5 is paused and `docs/DECISIONS.md` records that the VPS provider is still unchosen, so
 * there is no real host to name. Until a hostname is added here — in a commit, reviewed like any
 * other change — no environment variable, argument, or combination of the two can make this
 * script write to a non-loopback target. That is the "structurally incapable" part, and it is why
 * this list is a committed constant instead of a `SEED_ALLOWED_HOSTS` env var: an env var moves
 * the decision to whoever happens to be typing, which is exactly the person a guard exists to
 * protect.
 *
 * Adding a host here is necessary but not sufficient. The run must *also* set
 * `SEED_ALLOW_REMOTE_HOST` to that same hostname (see below), so a hostname committed for a
 * future deploy cannot silently become the default target of someone's local run.
 */
const APPROVED_DEPLOYMENT_HOSTS = new Set([]);

const WHY =
  `This script authenticates as an admin and writes portfolio content through the API ` +
  `(POST/PUT /projects, and DELETE /projects/{id} under --remove). The copy it applies has not ` +
  `been signed off — see content-seed/README.md — so it must not reach a public site by accident.`;

function refuse(source, resolved, detail = '', extra = '') {
  throw new Error(
    `Refusing to run the content seed against a non-local target.\n` +
      `  ${source} resolved to: ${resolved}${detail}\n` +
      `  Allowed loopback hosts: ${[...LOOPBACK_HOSTS].join(', ')}\n` +
      `  Approved deployment hosts: ${
        APPROVED_DEPLOYMENT_HOSTS.size
          ? [...APPROVED_DEPLOYMENT_HOSTS].join(', ')
          : '(none — see content-seed/locality.mjs)'
      }\n` +
      (extra ? `  ${extra}\n` : '') +
      `  ${WHY}`,
  );
}

/**
 * Throws unless `url` names a target this script may write to. Returns the URL so a call site can
 * wrap a default inline, matching `e2e/support/env.ts`'s usage.
 *
 * `new URL(...).hostname` keeps IPv6 literals bracketed (`http://[::1]:8080` -> `[::1]`), which is
 * why the loopback allowlist carries both spellings.
 */
export function assertSeedTarget(url, source) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    refuse(source, url, ' (not a parseable URL)');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname)) {
    return url;
  }

  // Everything below this line is the deliberate-deployment path. Each condition refuses on its
  // own; none of them is skippable.
  if (!APPROVED_DEPLOYMENT_HOSTS.has(hostname)) {
    refuse(
      source,
      url,
      ` (host: ${hostname})`,
      `To seed a real deployment, add "${hostname}" to APPROVED_DEPLOYMENT_HOSTS in ` +
        `content-seed/locality.mjs and commit that change — then set ` +
        `SEED_ALLOW_REMOTE_HOST=${hostname} on the run. Both are required.`,
    );
  }

  if (process.env.SEED_ALLOW_REMOTE_HOST !== hostname) {
    refuse(
      source,
      url,
      ` (host: ${hostname})`,
      `"${hostname}" is an approved deployment host, but this run did not confirm it. ` +
        `Set SEED_ALLOW_REMOTE_HOST=${hostname} to proceed.`,
    );
  }

  if (parsed.protocol !== 'https:') {
    refuse(
      source,
      url,
      ` (protocol: ${parsed.protocol})`,
      `Remote targets must be HTTPS — this script sends an admin password over this connection.`,
    );
  }

  return url;
}
