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

### One difference from the draft: the prose is reflowed

The source draft hard-wraps its prose at about 90 columns. **`projects.json` does not** — each
paragraph is a single unbroken string that wraps to whatever width the reader has.

This is deliberate. The detail page renders `description` with `white-space: pre-wrap`
(`project-detail.component.scss:42`), and `pre-wrap` preserves *single* newlines as forced line
breaks, not just blank ones. Carrying the draft's wrapping across would have pinned every paragraph
to a hard break every ~92 characters regardless of viewport, which on a narrow screen reads as a
broken page. The draft notes that blank lines survive as paragraph breaks and does not mention that
its own wrapping survives too — that looks like an oversight rather than an intention.

**78 newlines were replaced with a single space each, and nothing else changed.** Verified per
entry: the word sequence is identical to the draft, and every character count is unchanged, because
one character was swapped for another. None of the 78 sat next to a hyphen or existing whitespace,
so no word was joined wrongly and no double space was produced.

Blank lines between paragraphs are still how paragraph breaks are expressed, and are still
load-bearing — they are the separate array elements. **Do not re-wrap these strings by hand.**

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
  it from the project but leaves the tag row in place. `--remove` has the same limit: it deletes
  the projects and their tag links, and leaves every tag row behind. Clearing those means a manual
  `DELETE FROM tag` against a local database — not something this script can do through the API.
- **It does not control the order tags are displayed in.** Verified against the running backend:
  tags come back in a different order from the one they were sent in. The set round-trips, the
  sequence does not. So the ordering in `projects.json` is for the reader of that file only, and a
  preferred display order is not something this seed can express.

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
  picking one — in **both** modes. `--remove` used to delete both silently, which turned a title
  collision into exactly the data loss the bullet above warns about; it now refuses the same way
  `apply` does. Resolve it by hand and re-run.
- `--remove` deletes exactly the stored projects whose title appears in `projects.json`, logs each
  one **after** its delete succeeds, and reports how many it left alone. It is the only mode that
  deletes. If it fails partway it says how many it actually removed — it does not announce the
  batch up front, because the one destructive mode should never overstate what it did.

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

**Redirects are refused, and that is part of the guard, not a detail.** `fetch` follows redirects
by default and the guard only ever sees `SEED_BACKEND_URL`, so a 3xx from an approved host would
send the *next* request somewhere the guard never evaluated. Node strips the `Authorization` header
across origins but forwards the request **body** verbatim — which on `/auth/login` is the plaintext
admin password. That was reproduced on Node 24.14.0 against this script before `redirect: 'error'`
was added to `request()`. The precondition is not exotic: it needs only something other than the
intended backend answering on the expected port, which is the scenario in Troubleshooting below.

So the promise is: **the bytes cannot leave loopback**, not merely that no env var names a remote
host. Nothing in this API legitimately redirects, so refusing costs nothing.

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

Worth knowing when it lands: System Equalizer's two images are architecture **diagrams**, not
screenshots. The detail page used to hardcode `"<title> screenshot N"`, which said so wrongly — but
that was already fixed by issue #87 (commit `c730443`, an ancestor of this branch). It now calls
`projectImageAlt()`, which emits `"System Equalizer, image 1 of 2"` and cites these very diagrams
as the reason it exists. So the mislabelling is already gone; what #97 would add is the ability to
say what each image actually *contains*, which nothing on the frontend can invent from a bare URL.

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
  corrected. The join rebuilds the structure the draft's YAML `|` block scalar expressed, and the
  resulting lengths still match the draft's own compliance table (§4) exactly; the only difference
  from the draft is the reflow described above. The blank line matters: descriptions render as
  plain text with `white-space: pre-wrap`, not Markdown, so a blank line *is* the paragraph break —
  and, for the same reason, a stray newline *inside* a paragraph would be a visible hard break.

The record order matches the draft's section order (§1.1, §1.2, §1.3, §2.1, §2.2) so the two can be
read side by side. It carries no meaning to the API — there is no ordering field on the model
(issue #88).

## Troubleshooting

**"I stopped the backend, but something is still answering on 8080."**

Stopping `mvn spring-boot:run` does not necessarily stop the backend. Maven forks a separate
`java.exe` running `MySiteApplication`, and killing the Maven process can leave that fork alive and
still serving. Observed directly while verifying this script: the Maven job was stopped, and port
8080 was still `LISTENING` and answering requests.

**Check the port, not the Maven process.**

```bash
netstat -ano -p TCP | grep 8080          # any LISTENING row means a backend is still up
```

Then confirm the PID is the one you think it is before stopping it — on Windows,
`Get-CimInstance Win32_Process -Filter "ProcessId = <pid>"` shows the full command line, which
should name `MySiteApplication` and its active profile.

This matters beyond tidiness. A stale backend from a *different branch* will happily answer a seed
run or a test suite, and everything will look green against code that isn't the code under test.
That failure mode has already produced one false verification result on this project. Any time a
run's results look surprising — or suspiciously fine — check what is actually listening before
trusting them.
