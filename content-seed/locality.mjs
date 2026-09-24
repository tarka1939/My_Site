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
 * Adapted from `e2e/support/locality.ts` rather than copied verbatim. That version also carries
 * `'::1'` and `'0:0:0:0:0:0:0:1'`, which are right *there* because it checks a bare `E2E_DB_HOST`
 * string as well as URLs. **Here every check goes through `new URL().hostname`, which can never
 * return either spelling** — Node normalises `http://[::1]` and `http://[0:0:0:0:0:0:0:1]` both to
 * `[::1]` (verified on 24.14.0). Carrying them would be harmless dead weight except that the
 * refusal message prints this set as the allowed hosts, so someone copying `::1` out of the error
 * would then be refused by the very list that had just offered it. The set is therefore exactly
 * what a hostname can be, so the message and the behaviour cannot disagree.
 *
 * Two files rather than one shared module because `/e2e` is an npm package with its own toolchain
 * and this directory is dependency-free standard-library Node; importing across that boundary
 * would drag one into the other. If a third caller ever appears, that is the moment to extract it
 * properly.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Deployment hosts this script is permitted to write to.
 *
 * **Was deliberately empty, and was correct as empty** — the original note said so because Phase 5
 * was paused and `docs/DECISIONS.md` recorded the VPS provider as unchosen, so there was no real
 * host to name. Both of those premises expired on 2026-09-03: the backend is live at
 * `tarka1939.bieda.it`, a Mikrus LXC container reached through the provider's subdomain with TLS
 * terminated upstream (see the exposure ADR of that date).
 *
 * So the list now has exactly one entry, and adding it is the deliberate act the guard was built to
 * require. What that changes: this script *can* now write to the public site — `POST`/`PUT
 * /projects`, and `DELETE /projects/{id}` under `--remove` — where before no combination of
 * environment variable and argument could make it reach anything but loopback.
 *
 * What it does **not** change: adding a host here is necessary and not sufficient. The run must
 * also set `SEED_ALLOW_REMOTE_HOST` to the same hostname, so a hostname committed for a deploy
 * cannot silently become the default target of someone's local run. That second key is per-run and
 * on purpose; `run-seed.sh` refuses to supply it, because a wrapper that filled in both keys would
 * turn two independent decisions back into one.
 *
 * This list stays a committed constant rather than a `SEED_ALLOWED_HOSTS` env var for the reason
 * the original note gave and which still holds: an env var moves the decision to whoever happens to
 * be typing, who is exactly the person a guard exists to protect.
 */
const APPROVED_DEPLOYMENT_HOSTS = new Set(['tarka1939.bieda.it']);

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
 * why the loopback allowlist carries the bracketed spelling and only that one.
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
