/**
 * Pre-flight validation for `projects.json`, plus the two pure helpers that shape a record into a
 * request body.
 *
 * Split out of `seed.mjs` so it can be exercised on its own: importing `seed.mjs` runs the locality
 * guard, installs global error handlers, and executes the whole run at module load, none of which a
 * test of "does this reject a blank tag" should have to stand up. Nothing in here touches the
 * network, the filesystem, the environment, or any global — it is a function of its argument.
 *
 * See `validate.test.mjs`, run with `node --test content-seed/`.
 */

/** Every field `ProjectWriteRequest` has, and nothing else. Request bodies are assembled from
 *  this list rather than by spreading a record, which is what makes the data file's `_`-prefixed
 *  provenance notes structurally incapable of reaching the API. */
export const CONTRACT_FIELDS = [
  'title',
  'description',
  'links',
  'images',
  'tags',
  'startedOn',
  'completedOn',
];

/** Joins a description's paragraph array back into the single string the contract expects.
 *
 *  The blank line between paragraphs is load-bearing: `description` renders as plain text with
 *  `white-space: pre-wrap`, not Markdown, so a blank line *is* the paragraph break. The trailing
 *  newline reproduces what a YAML `|` block scalar produces in `docs/CONTENT_DRAFT.md`, which is
 *  also what that document's own character counts were measured against. */
export function renderDescription(paragraphs) {
  return paragraphs.join('\n\n') + '\n';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in `YYYY-MM-DD`.
 *
 * The shape check alone is not enough: `2026-02-30`, `2026-13-01` and `0000-00-00` all match the
 * pattern, pass to the API, and come back as a 400 from Jackson — *mid-loop*, after earlier records
 * have already been written. Catching it here is the whole reason validation runs before the first
 * socket. Round-tripping through `Date.UTC` rejects overflow, because JS normalises an impossible
 * date to a real one (Feb 30 becomes Mar 2) and the components then no longer match. Leap years
 * come out correct for free: 2024-02-29 round-trips, 2025-02-29 does not.
 */
export function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isUri(value) {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * True for a string that is present but carries no visible characters.
 *
 * Mirrors Jakarta's `@NotBlank`, which the backend puts on `title`, `description`, every `tags`
 * element, and both `LinkDto` fields — and which a plain length check does not model. A
 * whitespace-only description passed local validation, reached the API, and came back as
 * `{"field":"description","message":"must not be blank"}` *mid-apply*, after earlier records were
 * already written. That is the exact failure the pre-flight validator exists to prevent, so the
 * check has to match the server's notion of empty, not JavaScript's.
 *
 * Deliberately not applied to `images`: the contract gives its elements `@Size` only, no
 * `@NotBlank`, and a blank image URL is already refused by `isUri`.
 */
function isBlank(value) {
  return value.trim().length === 0;
}

/**
 * Re-checks every constraint `ProjectWriteRequest` declares, locally, before any network call.
 *
 * The API enforces these too, so this is not the last line of defence — it is the one that fails
 * *before* a partial apply. Without it, an over-length description on the fourth record leaves the
 * first three already written and the run half-done. Errors are collected rather than thrown one
 * at a time so an editing pass sees every problem at once.
 *
 * Throws on the first invalid record set; returns nothing when everything passes.
 */
export function validate(records) {
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
      if (isBlank(record.title)) fail('title is blank — the API rejects it with @NotBlank');
      if (record.title.length > 200) fail(`title is ${record.title.length} chars, max 200`);
      const first = seenTitles.get(record.title);
      if (first !== undefined) {
        // Titles are this seed's identity (see `reconcile`), so duplicates inside the file would
        // make the second record overwrite the first on every run.
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
      if (isBlank(rendered)) fail('description renders blank — the API rejects it with @NotBlank');
      if (rendered.length > 5000) fail(`description renders to ${rendered.length} chars, max 5000`);
    }

    // tags
    if (!Array.isArray(record.tags)) {
      fail('tags is required and must be an array of names');
    } else {
      record.tags.forEach((tag, t) => {
        if (typeof tag !== 'string' || tag.length < 1 || tag.length > 50) {
          fail(`tags[${t}] must be a string of 1-50 chars`);
        } else if (isBlank(tag)) {
          fail(`tags[${t}] is blank — the API rejects it with @NotBlank`);
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
          } else if (isBlank(link.label)) {
            fail(`${at}.label is blank — the API rejects it with @NotBlank`);
          }
          if (typeof link?.url !== 'string' || link.url.length < 1 || link.url.length > 500) {
            fail(`${at}.url must be a string of 1-500 chars`);
          } else if (!isUri(link.url)) {
            // Also covers a blank url: whitespace is not a parseable absolute URI, so the
            // server's @NotBlank on LinkDto.url needs no separate check here.
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
    for (const [name, value] of [
      ['startedOn', startedOn],
      ['completedOn', completedOn],
    ]) {
      if (
        value !== null &&
        value !== undefined &&
        !(typeof value === 'string' && isRealDate(value))
      ) {
        fail(`${name} must be null or a real YYYY-MM-DD date, got ${JSON.stringify(value)}`);
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
    throw new Error(
      `${errors.length} validation error(s) in the data file:\n  - ${errors.join('\n  - ')}`,
    );
  }
}
