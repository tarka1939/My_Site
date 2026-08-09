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

/* ------------------------------------------------------------------ configuration and guard */

// Read and checked at module load, before a credential is read or a socket opened. An unreachable
// or misspelled target fails here rather than after a partial write.
const BACKEND_URL = assertSeedTarget(
  process.env.SEED_BACKEND_URL ?? 'http://127.0.0.1:8080',
  'SEED_BACKEND_URL',
);
const API_BASE = `${BACKEND_URL}/api/v1`;

const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';

/** Every field `ProjectWriteRequest` has, and nothing else. Request bodies are assembled from
 *  this list rather than by spreading a record, which is what makes the data file's `_`-prefixed
 *  provenance notes structurally incapable of reaching the API. */
const CONTRACT_FIELDS = ['title', 'description', 'links', 'images', 'tags', 'startedOn', 'completedOn'];

/* ---------------------------------------------------------------------------- data loading */

/** Joins a description's paragraph array back into the single string the contract expects.
 *
 *  The blank line between paragraphs is load-bearing: `description` renders as plain text with
 *  `white-space: pre-wrap`, not Markdown, so a blank line *is* the paragraph break. The trailing
 *  newline reproduces what a YAML `|` block scalar produces in `docs/CONTENT_DRAFT.md`, which is
 *  also what that document's own character counts were measured against. */
function renderDescription(paragraphs) {
  return paragraphs.join('\n\n') + '\n';
}

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

/* ------------------------------------------------------------------------------ validation */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Re-checks every constraint `ProjectWriteRequest` declares, locally, before any network call.
 *
 * The API enforces these too, so this is not the last line of defence — it is the one that fails
 * *before* a partial apply. Without it, an over-length description on the fourth record leaves the
 * first three already written and the run half-done. Errors are collected rather than thrown one
 * at a time so an editing pass sees every problem at once.
 */
function validate(records) {
  const errors = [];
  const seenTitles = new Map();

  records.forEach((record, index) => {
    const where = `projects[${index}] (${record.title ?? 'untitled'})`;
    const fail = (msg) => errors.push(`${where}: ${msg}`);

    for (const key of Object.keys(record)) {
      if (!key.startsWith('_') && !CONTRACT_FIELDS.includes(key)) {
        fail(`unknown field "${key}" — not in ProjectWriteRequest, and not a "_" provenance note`);
      }
    }

    // title
    if (typeof record.title !== 'string' || record.title.length < 1) {
      fail('title is required and must be a non-empty string');
    } else {
      if (record.title.length > 200) fail(`title is ${record.title.length} chars, max 200`);
      const first = seenTitles.get(record.title);
      if (first !== undefined) {
        // Titles are this seed's identity (see reconcile below), so duplicates inside the file
        // would make the second record overwrite the first on every run.
        fail(`duplicate title, also used by projects[${first}] — titles must be unique`);
      } else {
        seenTitles.set(record.title, index);
      }
    }

    // description
    if (!Array.isArray(record.description) || record.description.length === 0) {
      fail('description is required and must be a non-empty array of paragraph strings');
    } else if (record.description.some((p) => typeof p !== 'string')) {
      fail('description must contain only strings');
    } else {
      const rendered = renderDescription(record.description);
      if (rendered.length < 1) fail('description renders empty');
      if (rendered.length > 5000) fail(`description renders to ${rendered.length} chars, max 5000`);
    }

    // tags
    if (!Array.isArray(record.tags)) {
      fail('tags is required and must be an array of names');
    } else {
      record.tags.forEach((tag, t) => {
        if (typeof tag !== 'string' || tag.length < 1 || tag.length > 50) {
          fail(`tags[${t}] must be a string of 1-50 chars`);
        }
      });
    }

    // links
    if (record.links !== undefined) {
      if (!Array.isArray(record.links)) {
        fail('links must be an array');
      } else {
        if (record.links.length > 10) fail(`${record.links.length} links, max 10`);
        record.links.forEach((link, l) => {
          const at = `links[${l}]`;
          if (typeof link?.label !== 'string' || link.label.length < 1 || link.label.length > 50) {
            fail(`${at}.label must be a string of 1-50 chars`);
          }
          if (typeof link?.url !== 'string' || link.url.length < 1 || link.url.length > 500) {
            fail(`${at}.url must be a string of 1-500 chars`);
          } else if (!isUri(link.url)) {
            fail(`${at}.url is not an absolute URI: ${link.url}`);
          }
        });
      }
    }

    // images
    //
    // Bare URL strings, matching the contract as it stands today. Issue #97 proposes
    // `[{url, alt}]`; see content-seed/README.md for exactly what would change here.
    if (record.images !== undefined) {
      if (!Array.isArray(record.images)) {
        fail('images must be an array');
      } else {
        if (record.images.length > 20) fail(`${record.images.length} images, max 20`);
        record.images.forEach((image, m) => {
          if (typeof image !== 'string' || image.length < 1 || image.length > 500) {
            fail(`images[${m}] must be a string of 1-500 chars`);
          } else if (!isUri(image)) {
            fail(`images[${m}] is not an absolute URI: ${image}`);
          }
        });
      }
    }

    // dates — the three rules the API answers with a 400, checked here so the file can be fixed
    // before a run rather than during one.
    const { startedOn, completedOn } = record;
    for (const [name, value] of [['startedOn', startedOn], ['completedOn', completedOn]]) {
      if (value !== null && value !== undefined && !(typeof value === 'string' && DATE_RE.test(value))) {
        fail(`${name} must be null or a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
      }
    }
    if (completedOn && !startedOn) {
      fail('completedOn is set without startedOn — a project cannot finish without having started');
    }
    if (completedOn && startedOn && completedOn < startedOn) {
      // Both are zero-padded YYYY-MM-DD, so lexical order is chronological order.
      fail(`completedOn (${completedOn}) precedes startedOn (${startedOn})`);
    }
  });

  if (errors.length) {
    throw new Error(`${errors.length} validation error(s) in the data file:\n  - ${errors.join('\n  - ')}`);
  }
}

function isUri(value) {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------- HTTP helpers */

async function request(path, init = {}) {
  const { token, expectStatus, ...rest } = init;
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

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

  console.log(`\n  done: ${created} created, ${updated} updated, ${created + updated} total.`);
}

async function remove(doc, { dryRun }) {
  const titles = new Set(doc.projects.map((r) => r.title));
  const existing = await listAllProjects();
  const doomed = existing.filter((p) => titles.has(p.title));

  console.log(`\n  ${existing.length} project(s) stored, ${doomed.length} match a title in the data file.\n`);
  for (const project of doomed) {
    console.log(`  ${dryRun ? 'would delete' : 'deleting   '} ${project.id}  ${project.title}`);
  }
  if (!doomed.length) {
    console.log('  nothing to remove.');
    return;
  }
  if (dryRun) {
    console.log(`\n  dry run — nothing was deleted.`);
    return;
  }

  const token = await login();
  for (const project of doomed) {
    await request(`/projects/${project.id}`, { method: 'DELETE', token, expectStatus: 204 });
  }
  console.log(`\n  done: ${doomed.length} deleted. ${existing.length - doomed.length} project(s) left untouched.`);
}

/* ------------------------------------------------------------------------------------ main */

const args = process.argv.slice(2);
const wants = (flag) => args.includes(flag);

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
  fileArg !== -1 && args[fileArg + 1]
    ? args[fileArg + 1]
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
