# content-seed

Applies the portfolio's five project entries to a running backend through the real HTTP API.

`projects.json` is the content. `seed.mjs` is the mechanism. They are separate on purpose: the
copy is meant to be edited, and editing it should never require reading the script.

---

## ⚠ The copy in `projects.json` has not been signed off

The owner has decided **scope** (which five projects) and **dates**. The owner has **not approved
the prose**. Every description in `projects.json` was transcribed from `docs/CONTENT_DRAFT.md` on
branch `phase6/content-draft`, which describes itself as *"a document to be corrected, not a set of
records to be loaded"*.

So:

- **`projects.json` is the source of truth for what the site says.** Edit it, then re-run. The
  script never writes copy of its own and never edits the file.
- The file carries `"_signedOff": false`. While that is false, every run prints an
  `UNSIGNED-OFF COPY` banner. Flipping it to `true` is the owner's call and silences the banner —
  nothing else changes.
- Two entries carry **no dates at all, by decision** (both coursework entries). That is not an
  oversight to be helpfully filled in; see the `_dates` note on each record and §5.4/§5.5 of the
  draft.
- **System Equalizer's `startedOn` is a floor, not a known date.** `2026-01-01` is the earliest
  month the work provably existed by, not the month it began, and it is the one entry whose dates
  the owner has not confirmed. The record says so in `_dates`. Do not let it harden into a fact.

Unanswered questions about the copy — which images to use, whether the repos should be renamed,
whether the coursework entries should be split — live in the draft's "Needs your input" sections,
not here. This directory deliberately holds no opinions the draft does not.

### One thing to decide that the draft did not raise: line wrapping

The draft hard-wraps its prose at about 90 columns, and those line breaks were transcribed
verbatim — **78 of them across the five entries.** The detail page renders `description` with
`white-space: pre-wrap` (`project-detail.component.scss`), and `pre-wrap` preserves *single*
newlines as forced line breaks, not just blank lines.

So as it stands, the copy will render carrying the draft document's line wrapping rather than
reflowing to the reader's width — with source lines up to 93 characters landing in a narrower
column, that reads as alternating long and short lines. The draft says blank lines survive as
paragraph breaks; it does not mention that its own wrapping survives too, which looks like an
oversight rather than a decision.

It was left as-is because faithful transcription was the instruction and this is the owner's call.
**To reflow instead, replace single newlines inside each paragraph with spaces** — in
`projects.json`, so the change is visible in review. That alters no words and, since one character
is swapped for another, no character counts either.

---

## Prerequisites

- **Node 24+.** No dependencies, no `package.json`, no `npm install`. Standard library only.
- **A running backend** with its database migrated. From the repo root:
  ```bash
  cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev
  ```
  which needs JDK 25, Maven, and Postgres on `localhost:5432` (see the root `README.md`).
- **An admin username and password.** The script logs in; it cannot create an account, because the
  API has no registration endpoint by design (`docs/openapi.yaml`: *"There is no self-service
  registration endpoint"*). The single admin row comes from a Flyway seed migration whose plaintext
  password was deliberately never committed, so locally you must set a password you know. The
  established pattern for that is `e2e/support/db.ts`, which upserts a throwaway admin row with a
  bcrypt hash straight into the local database; do the same, or reset the seeded account's hash
  yourself. Either way the credential stays out of this repository.

## Running it

```bash
export SEED_ADMIN_USERNAME=admin
export SEED_ADMIN_PASSWORD=...          # never committed, never defaulted

node content-seed/seed.mjs --dry-run    # show the plan, write nothing
node content-seed/seed.mjs              # create or update all five
node content-seed/seed.mjs --remove     # delete stored projects whose title is in the data file
node content-seed/seed.mjs --help
```

| Variable | Default | Meaning |
|---|---|---|
| `SEED_BACKEND_URL` | `http://127.0.0.1:8080` | Backend origin. Checked by the guard below. |
| `SEED_ADMIN_USERNAME` | `admin` | |
| `SEED_ADMIN_PASSWORD` | *(none — required)* | |
| `SEED_ALLOW_REMOTE_HOST` | *(none)* | Half of the deployment door. Useless on its own — see below. |

Note the login rate limit: the backend allows **5 login attempts per 15 minutes per IP**, and each
non-dry run spends one. `--dry-run` spends none, because it only reads the public list endpoint.

## What it does

1. Validates `projects.json` against every constraint `ProjectWriteRequest` declares — field names,
   lengths, item counts, URI syntax, and the two date rules (`completedOn` may not precede
   `startedOn`, and may not be present without it). **All of it before any network call**, so a bad
   edit cannot leave a half-applied run behind.
2. Logs in via `POST /auth/login`.
3. Reads every stored project from `GET /projects`.
4. For each record: `PUT /projects/{id}` if a stored project has that exact title, otherwise
   `POST /projects`.

## What it does not do

- **It does not write to Postgres.** Every change goes through the API, so it exercises the same
  validation, tag upsert, and event publication as the admin UI would.
- **It is not a Flyway migration, and must not become one.** Migrations are permanent and replay
  into every database that runs them, including throwaway CI ones. Copy that has not been signed
  off has no business in migration history — the first correction would leave the wrong wording
  there forever.
- **It does not create, delete, or modify an admin account.**
- **It does not delete anything in its normal mode.** See below.
- **It does not touch contact messages or tags directly.** Tags are created implicitly by project
  writes; there is no `DELETE /tags`, so re-running with a tag removed from the data file detaches
  it from the project but leaves the tag row in place.

## Idempotency

**Titles are the seed's identity.** A run matches each record against stored projects by exact
title: found means `PUT` (a full replacement), not found means `POST`. Running it twice leaves five
projects, not ten. Running it after editing `projects.json` updates the five in place, which is
what makes the file a source of truth rather than a one-shot import.

Title matching is used because the API offers nothing better: there is no external-id or slug
field, and no filter-by-title. The alternative — a local file recording created ids — would make
idempotency depend on one machine's disk, and would break the moment the seed ran from anywhere
else.

**Against a database holding unrelated projects:** they are ignored entirely. Normal runs issue no
`DELETE` at all, so there is no path by which an unrelated project can be removed. A stored project
whose title is not in `projects.json` is never read, written, or counted.

Known failure modes, stated plainly:

- **Renaming a `title` in the data file orphans the old row.** The next run no longer recognises
  it, creates a new project under the new title, and leaves the old one behind. It is not deleted,
  because the script genuinely cannot tell it apart from something a human made. Delete it by hand.
- **A hand-made project with one of these exact titles would be adopted** — overwritten by a normal
  run, deleted by `--remove`. This is the one case where "never touches what it didn't create"
  depends on titles not colliding. The five titles are distinctive enough that this is unlikely,
  but it is a real limit of title matching rather than something the script defends against.
- **Two stored projects sharing a seeded title is ambiguous, so the run refuses** rather than
  picking one. Resolve it by hand and re-run.
- `--remove` deletes exactly the stored projects whose title appears in `projects.json`, prints
  each one before deleting, and reports how many it left alone. It is the only mode that deletes.

## The locality guard

`locality.mjs` is modelled on `e2e/support/locality.ts` — same loopback allowlist, same fail-closed
shape, same refusal to grow a `--force` flag. It runs at import time, before a credential is read
or a socket opened.

Loopback targets are allowed. **Anything else needs two independent keys:**

1. The hostname must appear in `APPROVED_DEPLOYMENT_HOSTS`, a committed constant in
   `locality.mjs` — so pointing this at a real site is a reviewed code change, not something
   whoever is typing can decide. **That list is currently empty**, because Phase 5 is paused and
   no VPS provider has been chosen; today, no remote target can run under any combination of
   arguments and environment.
2. The run must set `SEED_ALLOW_REMOTE_HOST` to that same hostname, so a host committed for a
   future deploy cannot quietly become someone's default local target.

Remote targets must additionally be HTTPS, since the admin password crosses that connection.

The reason for all of this: this script authenticates as an admin and writes portfolio copy that
has not been signed off. A mistyped host should not be able to publish a draft.

## Issue #97 (per-image alt text) is not implemented here

[#97](https://github.com/tarka1939/My_Site/issues/97) proposes changing `images` from `[url]` to
`[{url, alt}]`. It is **not merged**, so this seed builds against the contract as it stands: bare
URL strings.

When it does land, the change here is mechanical rather than a rewrite:

- `projects.json` — three URLs in total across all five entries (two on System Equalizer, one on
  Counter App; the other three entries have `"images": []`). Each becomes an object with an `alt`
  string. The alt text itself is **new copy that has to be written and approved**, which is the
  real cost, not the format change.
- `seed.mjs` — one validation branch, the block commented `images` in `validate()`. Nothing else
  reads `images`; it is passed through by the field allowlist untouched.

Worth flagging when it lands: System Equalizer's two images are architecture **diagrams**, and the
detail page currently hardcodes alt text of the form `"<title> screenshot N"` — which is exactly
the inaccuracy #97 exists to fix, and is already noted on that record's `_images` field.

## The shape of `projects.json`

```jsonc
{
  "_signedOff": false,          // "_" keys are provenance notes, never sent to the API
  "projects": [
    {
      "_draft":  "...",         // where in CONTENT_DRAFT.md this came from
      "_dates":  "...",         // why these date values, or why they are null
      "title": "...",
      "startedOn": "2026-01-01",
      "completedOn": null,      // null means ongoing — a value, not missing data
      "description": ["para", "para"],
      "tags": ["..."],
      "links": [{ "label": "...", "url": "..." }],
      "images": ["https://..."]
    }
  ]
}
```

Two conventions:

- **Every key without a leading underscore is a `ProjectWriteRequest` field, verbatim.** Keys with
  a leading underscore are notes for humans. The script builds each request body from an explicit
  list of the seven contract fields, so a `_` key cannot reach the API even by accident, and an
  unrecognised key without an underscore is a validation error rather than a silent no-op.
- **`description` is an array of paragraphs**, joined with a blank line and given a trailing
  newline. JSON has no multi-line string literal, and a 2,536-character description escaped onto
  one line is unreviewable — which would defeat the point of a file that exists to be read and
  corrected. The join reproduces the draft's YAML `|` block scalar byte-for-byte; the resulting
  lengths match the draft's own compliance table (§4) exactly. The blank line matters: descriptions
  render as plain text with `white-space: pre-wrap`, not Markdown, so a blank line *is* the
  paragraph break.

The record order matches the draft's section order (§1.1, §1.2, §1.3, §2.1, §2.2) so the two can be
read side by side. It carries no meaning to the API — there is no ordering field on the model
(issue #88).
