#!/usr/bin/env node
/**
 * Applies `projects.json` to a running backend through the real HTTP API.
 *
 * Deliberately not a Flyway migration and deliberately not a direct Postgres write:
 *
 *  - Portfolio copy is content, not schema. A migration is append-only and permanent — this copy
 *    has not been signed off, and the first correction would leave the wrong wording sitting in
 *    git history and replayed into every database that ever runs the migration, including
 *    throwaway CI ones.
 *  - Going through `POST`/`PUT /projects` means the seed exercises the same validation, tag
 *    upsert, and event publication as the admin UI. A direct INSERT would skip all of it and could
 *    write a row the API itself would have rejected.
 *
 * Dependency-free by design: standard-library Node only (24+, for `fetch` and top-level `await`),
 * no `package.json`, no `npm install`. Nothing to keep in sync and nothing to audit.
 *
 * Usage:
 *   node content-seed/seed.mjs [--dry-run|--remove] [--file <path>]
 *
 * Environment:
 *   SEED_BACKEND_URL       default http://127.0.0.1:8080 — checked by ./locality.mjs at import
 *   SEED_ADMIN_USERNAME    default "admin"
 *   SEED_ADMIN_PASSWORD    required; never defaulted and never committed
 *   SEED_ALLOW_REMOTE_HOST see ./locality.mjs — half of the deployment door, useless on its own
 */

// Must come first: it installs the handler that renders the locality guard's refusal below as a
// message rather than a stack trace. ESM evaluates imports in source order.
import './errors.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertSeedTarget } from './locality.mjs';
import { CONTRACT_FIELDS, renderDescription, validate } from './validate.mjs';

/* ------------------------------------------------------------------ configuration and guard */

// Read and checked at module load, before a credential is read or a socket opened. An unreachable
// or misspelled target fails here rather than after a partial write.
const BACKEND_URL = assertSeedTarget(
  process.env.SEED_BACKEND_URL ?? 'http://127.0.0.1:8080',
  'SEED_BACKEND_URL',
);
const API_BASE = `${BACKEND_URL}/api/v1`;

const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';

/* ---------------------------------------------------------------------------- data loading */

/** Builds the request body: contract fields only, description flattened. */
function toWriteRequest(record) {
  const body = {};
  for (const field of CONTRACT_FIELDS) {
    if (field === 'description') {
      body.description = renderDescription(record.description);
    } else {
      body[field] = record[field];
    }
  }
  return body;
}

async function loadRecords(file) {
  const doc = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(doc.projects)) {
    throw new Error(`${file}: expected a top-level "projects" array`);
  }
  return doc;
}

/** True if `error` is fetch's report of a refused redirect rather than a transport failure.
 *  Matched on the cause's message because undici exposes no code for it. */
function isRedirectError(error) {
  for (let e = error; e; e = e.cause) {
    if (typeof e.message === 'string' && /redirect/i.test(e.message)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------- HTTP helpers */

async function request(path, init = {}) {
  const { token, expectStatus, ...rest } = init;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      // Do not follow redirects — this is what keeps the locality guard's promise true.
      //
      // `fetch` defaults to `redirect: 'follow'`, and the guard only ever sees SEED_BACKEND_URL.
      // So a 3xx from an approved host would send the *next* request to an origin the guard never
      // evaluated. Node strips the Authorization header cross-origin, but it forwards the request
      // BODY verbatim — which on /auth/login is the plaintext admin password, and on /projects is
      // copy that has not been signed off. Reproduced on Node 24.14.0 before this line existed.
      //
      // The precondition is not exotic: it only needs something other than the intended backend
      // answering on the expected port — the exact scenario this seed's own Troubleshooting
      // section documents. Nothing this API does legitimately redirects, so refusing is free.
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    // `redirect: 'error'` surfaces as a generic "fetch failed", which would read as the server
    // being down. Name what actually happened, because it is a security-relevant event.
    if (isRedirectError(error)) {
      throw new Error(
        `Refusing to follow a redirect.\n` +
          `  ${rest.method ?? 'GET'} ${API_BASE}${path} answered with a redirect.\n` +
          `  Following it would send this request — including the admin password on /auth/login — ` +
          `to an origin the locality guard never checked.\n` +
          `  Nothing in this API legitimately redirects. Check what is actually listening on that ` +
          `port (see "Troubleshooting" in content-seed/README.md).`,
        { cause: error },
      );
    }
    throw error;
  }

  const ok = expectStatus !== undefined ? response.status === expectStatus : response.ok;
  if (!ok) {
    const body = await response.text();
    throw new Error(`${rest.method ?? 'GET'} ${path} -> ${response.status} ${response.statusText}\n${body}`);
  }
  return response.status === 204 ? undefined : response.json();
}

async function login() {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    // Never defaulted. The one admin row is provisioned by a Flyway seed migration whose plaintext
    // password was deliberately never committed (docs/openapi.yaml, "no self-service
    // registration"), so there is no sensible default and inventing one would be a committed
    // credential.
    throw new Error(
      'SEED_ADMIN_PASSWORD is not set. This script logs in as an existing admin; it cannot ' +
        'create one, because the API has no registration endpoint by design.',
    );
  }
  const { token } = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: ADMIN_USERNAME, password }),
  });
  return token;
}

/** Walks every page of `GET /projects`. Public endpoint, no token needed. */
async function listAllProjects() {
  const all = [];
  const first = await request('/projects?page=0&size=100');
  all.push(...first.content);
  for (let page = 1; page < first.totalPages; page++) {
    all.push(...(await request(`/projects?page=${page}&size=100`)).content);
  }
  return all;
}

/* -------------------------------------------------------------------------------- the work */

/**
 * Works out what each record needs, by exact title match against what is already stored.
 *
 * **Title is the seed's identity.** The API has no external-id or slug field and no
 * filter-by-title, so an exact match over the full list is the only join available without
 * inventing a local state file — and a state file would make idempotency depend on a machine's
 * disk rather than on the data, which fails the moment the seed runs from anywhere else.
 *
 * The consequences are worth stating plainly, because they are the real failure modes:
 *
 *  - Renaming a `title` in the data file makes the seed stop recognising the row it created. The
 *    next run creates a *new* project under the new title and leaves the old one behind. It will
 *    not be deleted, because the seed cannot tell it apart from something a human made.
 *  - A project someone created by hand under one of these exact titles would be adopted: `apply`
 *    overwrites it, `--remove` deletes it. Nothing else is ever touched.
 *  - Two stored projects sharing a seeded title is ambiguous, so the run refuses rather than
 *    picking one.
 */
function reconcile(records, existing) {
  const byTitle = new Map();
  for (const project of existing) {
    const bucket = byTitle.get(project.title);
    if (bucket) bucket.push(project);
    else byTitle.set(project.title, [project]);
  }

  const ambiguous = [];
  const plan = records.map((record) => {
    const matches = byTitle.get(record.title) ?? [];
    if (matches.length > 1) {
      ambiguous.push(`"${record.title}" matches ${matches.length} stored projects: ${matches.map((m) => m.id).join(', ')}`);
    }
    return { record, existing: matches[0] ?? null, action: matches.length ? 'update' : 'create' };
  });

  if (ambiguous.length) {
    throw new Error(
      `Refusing to run: title matching is ambiguous.\n  - ${ambiguous.join('\n  - ')}\n` +
        `Delete the duplicates by hand, or rename them, then rerun. This script will not guess ` +
        `which row it owns.`,
    );
  }
  return plan;
}

function banner(doc) {
  if (doc._signedOff === true) return;
  console.log(
    '\n' +
      '  ! UNSIGNED-OFF COPY\n' +
      '  ! projects.json carries "_signedOff": false. The owner has decided scope and dates but\n' +
      '  ! has NOT approved the prose. Do not treat what this applies as final wording.\n',
  );
}

function summarise(doc) {
  console.log(`  data file : ${doc._file}`);
  console.log(`  source    : ${doc._source}`);
  console.log(`  target    : ${API_BASE}`);
  console.log(`  records   : ${doc.projects.length}`);
}

async function apply(doc, { dryRun }) {
  const records = doc.projects;
  const existing = await listAllProjects();
  const plan = reconcile(records, existing);

  console.log(`\n  ${existing.length} project(s) already stored; ${records.length} in the data file.\n`);

  if (dryRun) {
    for (const step of plan) {
      console.log(`  would ${step.action.padEnd(6)} ${step.record.title}${step.existing ? `  (id ${step.existing.id})` : ''}`);
    }
    console.log(`\n  dry run — nothing was written.`);
    return;
  }

  const token = await login();
  let created = 0;
  let updated = 0;

  try {
    for (const step of plan) {
      const body = JSON.stringify(toWriteRequest(step.record));
      if (step.existing) {
        // PUT is a full replacement, which is exactly what re-applying a source-of-truth file means:
        // a field deleted from the data file is cleared on the stored row rather than lingering.
        const result = await request(`/projects/${step.existing.id}`, { method: 'PUT', token, body, expectStatus: 200 });
        updated++;
        console.log(`  updated  ${result.id}  ${result.title}`);
      } else {
        const result = await request('/projects', { method: 'POST', token, body, expectStatus: 201 });
        created++;
        console.log(`  created  ${result.id}  ${result.title}`);
      }
    }
  } catch (error) {
    // Say what was written before re-throwing. Without this the run ends on a raw HTTP error and a
    // partial apply is indistinguishable from one that failed on the first record — at exactly the
    // moment that difference matters most.
    const done = created + updated;
    console.error(
      `\n  PARTIAL APPLY — ${done} of ${plan.length} record(s) written ` +
        `(${created} created, ${updated} updated) before the failure below.\n` +
        `  Nothing was deleted. This seed is idempotent: fix the cause and re-run to finish — ` +
        `the ${done} already written will be updated in place, not duplicated.`,
    );
    throw error;
  }

  console.log(`\n  done: ${created} created, ${updated} updated, ${created + updated} total.`);
}

async function remove(doc, { dryRun }) {
  const titles = new Set(doc.projects.map((r) => r.title));
  const existing = await listAllProjects();
  const doomed = existing.filter((p) => titles.has(p.title));

  // Same ambiguity refusal `apply` gets, for the same reason and more urgently: this is the mode
  // that destroys data. Two rows sharing a seeded title means one of them is probably not the
  // seed's — deleting both without asking is precisely the "never deletes what it didn't create"
  // promise being broken, silently.
  const duplicates = [...Map.groupBy(doomed, (p) => p.title)].filter(([, rows]) => rows.length > 1);
  if (duplicates.length) {
    throw new Error(
      `Refusing to remove: title matching is ambiguous.\n` +
        duplicates
          .map(([title, rows]) => `  - "${title}" matches ${rows.length} stored projects: ${rows.map((r) => r.id).join(', ')}`)
          .join('\n') +
        `\nOne of these is probably not this seed's. Delete the right one by hand — this script ` +
        `will not guess which row it owns.`,
    );
  }

  console.log(`\n  ${existing.length} project(s) stored, ${doomed.length} match a title in the data file.\n`);

  if (!doomed.length) {
    console.log('  nothing to remove.');
    return;
  }
  if (dryRun) {
    for (const project of doomed) {
      console.log(`  would delete  ${project.id}  ${project.title}`);
    }
    console.log(`\n  dry run — nothing was deleted.`);
    return;
  }

  const token = await login();
  let deleted = 0;
  try {
    for (const project of doomed) {
      await request(`/projects/${project.id}`, { method: 'DELETE', token, expectStatus: 204 });
      deleted++;
      // Logged *after* the DELETE succeeds, not before. Announcing the whole batch up front made
      // the one destructive mode the one whose output overstated what it had done.
      console.log(`  deleted  ${project.id}  ${project.title}`);
    }
  } catch (error) {
    console.error(
      `\n  PARTIAL REMOVE — ${deleted} of ${doomed.length} project(s) deleted before the failure ` +
        `below. The remaining ${doomed.length - deleted} are still stored; re-run to finish.`,
    );
    throw error;
  }
  console.log(`\n  done: ${deleted} deleted. ${existing.length - deleted} project(s) left untouched.`);
}

/* ------------------------------------------------------------------------------------ main */

const args = process.argv.slice(2);
const wants = (flag) => args.includes(flag);

/**
 * Reject anything unrecognised instead of ignoring it.
 *
 * `--dryrun` is one keystroke from `--dry-run` and used to be silently discarded, which meant the
 * most likely typo a user of this script can make turned a "show me the plan" into a real write.
 * For a script this deliberate about failing closed, an unknown argument must never fall through
 * to the destructive default.
 */
const KNOWN_FLAGS = new Set(['--dry-run', '--remove', '--file', '--help', '-h']);
{
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') {
      // Its value is arbitrary, so skip it — but a trailing `--file` with nothing after it used to
      // fall back to the bundled data file, which silently applies content the caller didn't ask
      // for.
      if (i + 1 >= args.length) {
        throw new Error(`--file needs a path after it.`);
      }
      i++;
      continue;
    }
    if (!KNOWN_FLAGS.has(args[i])) unknown.push(args[i]);
  }
  if (unknown.length) {
    throw new Error(
      `Unknown argument(s): ${unknown.join(', ')}\n` +
        `  Known: ${[...KNOWN_FLAGS].join(', ')}\n` +
        `  Refusing rather than ignoring them — "--dryrun" instead of "--dry-run" would otherwise ` +
        `perform a real write.`,
    );
  }
}

if (wants('--help') || wants('-h')) {
  console.log(
    `\nUsage: node content-seed/seed.mjs [options]\n\n` +
      `  (no options)  create or update every project in projects.json (idempotent)\n` +
      `  --dry-run     print the plan, write nothing\n` +
      `  --remove      delete stored projects whose title appears in projects.json\n` +
      `  --file <path> use a different data file\n` +
      `  --help        this message\n\n` +
      `See content-seed/README.md.\n`,
  );
  process.exit(0);
}

const fileArg = args.indexOf('--file');
const dataFile =
  fileArg !== -1
    ? args[fileArg + 1] // guaranteed present by the argument check above
    : fileURLToPath(new URL('./projects.json', import.meta.url));

const doc = await loadRecords(dataFile);
doc._file = dataFile;

validate(doc.projects);

console.log(`\ncontent-seed — ${wants('--remove') ? 'remove' : 'apply'}${wants('--dry-run') ? ' (dry run)' : ''}`);
summarise(doc);
banner(doc);

if (wants('--remove')) {
  await remove(doc, { dryRun: wants('--dry-run') });
} else {
  await apply(doc, { dryRun: wants('--dry-run') });
}
