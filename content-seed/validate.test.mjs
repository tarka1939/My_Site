/**
 * Tests for the pre-flight validator and the locality guard.
 *
 * Run with:  node --test content-seed/
 *
 * Uses `node:test` and `node:assert` from the standard library, so this directory stays
 * dependency-free — there is no `package.json` here and nothing to install. No network, no
 * filesystem, no database: every case below is a function call on a literal.
 *
 * These exist because `content-seed/` had no test coverage at all, and two defects that local
 * validation should have caught reached the API instead — an impossible date (`2026-02-30`) and a
 * whitespace-only description. Both are pinned below. The point of the validator is that it fails
 * *before* the first socket, so a regression here is a regression in the only thing standing
 * between a bad edit and a half-applied run.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validate, isRealDate, renderDescription, CONTRACT_FIELDS } from './validate.mjs';
import { assertSeedTarget } from './locality.mjs';

/** A minimal record that passes. Each test overrides just the field under examination. */
const valid = (overrides = {}) => ({
  title: 'A Project',
  description: ['First paragraph.', 'Second paragraph.'],
  tags: ['python'],
  links: [{ label: 'GitHub repository', url: 'https://github.com/tarka1939/Example' }],
  images: ['https://raw.githubusercontent.com/tarka1939/Example/main/docs/shot.png'],
  startedOn: null,
  completedOn: null,
  ...overrides,
});

/** Asserts `validate` rejects, and that the message names the problem. */
function rejects(records, expected) {
  assert.throws(
    () => validate(records),
    (error) => {
      assert.match(error.message, expected);
      return true;
    },
    `expected validation to reject with ${expected}`,
  );
}

describe('validate — the happy path', () => {
  test('accepts a well-formed record', () => {
    assert.doesNotThrow(() => validate([valid()]));
  });

  test('accepts the committed projects.json unchanged', async () => {
    // Guards against a data edit that breaks the contract, and against the validator drifting away
    // from the file it exists to check.
    const { readFile } = await import('node:fs/promises');
    const doc = JSON.parse(
      await readFile(new URL('./projects.json', import.meta.url), 'utf8'),
    );
    assert.doesNotThrow(() => validate(doc.projects));
    assert.equal(doc.projects.length, 5);
  });
});

describe('validate — blank but non-empty (@NotBlank)', () => {
  // The regression that prompted these tests: a whitespace-only description passed local
  // validation, reached the API, and failed server-side with "must not be blank" *mid-apply*,
  // after earlier records had already been written.
  test('rejects a description that renders to only whitespace', () => {
    rejects([valid({ description: ['   '] })], /description renders blank/);
  });

  test('rejects a description of whitespace-only paragraphs', () => {
    rejects([valid({ description: ['  ', '\t'] })], /description renders blank/);
  });

  test('rejects a blank title', () => {
    rejects([valid({ title: '   ' })], /title is blank/);
  });

  test('rejects a blank tag', () => {
    rejects([valid({ tags: ['python', '  '] })], /tags\[1\] is blank/);
  });

  test('rejects a blank link label', () => {
    rejects(
      [valid({ links: [{ label: ' ', url: 'https://example.invalid/' }] })],
      /links\[0\]\.label is blank/,
    );
  });

  test('rejects a blank link url (via the URI check)', () => {
    rejects(
      [valid({ links: [{ label: 'GitHub', url: '   ' }] })],
      /links\[0\]\.url is not an absolute URI/,
    );
  });

  test('does not reject internal whitespace or padded-but-real content', () => {
    // `@NotBlank` is about having *some* visible character, not about being trimmed.
    assert.doesNotThrow(() => validate([valid({ title: ' Padded Title ', tags: [' py '] })]));
  });
});

describe('validate — dates', () => {
  test('rejects impossible calendar dates that match the YYYY-MM-DD shape', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '0000-00-00', '2026-06-31', '2025-02-29']) {
      rejects([valid({ startedOn: bad })], /must be null or a real YYYY-MM-DD date/);
    }
  });

  test('accepts a genuine leap day', () => {
    assert.equal(isRealDate('2024-02-29'), true);
    assert.equal(isRealDate('2025-02-29'), false);
    assert.doesNotThrow(() => validate([valid({ startedOn: '2024-02-29' })]));
  });

  test('rejects completedOn without startedOn', () => {
    rejects([valid({ completedOn: '2026-06-01' })], /completedOn is set without startedOn/);
  });

  test('rejects completedOn preceding startedOn', () => {
    rejects(
      [valid({ startedOn: '2026-06-01', completedOn: '2026-05-01' })],
      /completedOn \(2026-05-01\) precedes startedOn \(2026-06-01\)/,
    );
  });

  test('accepts equal dates — a single-month period is legal', () => {
    assert.doesNotThrow(() =>
      validate([valid({ startedOn: '2026-06-01', completedOn: '2026-06-01' })]),
    );
  });

  test('accepts both null — no period asserted', () => {
    assert.doesNotThrow(() => validate([valid({ startedOn: null, completedOn: null })]));
  });
});

describe('validate — contract limits', () => {
  test('rejects an over-length description', () => {
    rejects([valid({ description: ['x'.repeat(5001)] })], /max 5000/);
  });

  test('rejects an over-length title', () => {
    rejects([valid({ title: 'x'.repeat(201) })], /max 200/);
  });

  test('rejects an over-length tag', () => {
    rejects([valid({ tags: ['x'.repeat(51)] })], /must be a string of 1-50 chars/);
  });

  test('rejects more than 10 links', () => {
    const links = Array.from({ length: 11 }, (_, i) => ({
      label: `L${i}`,
      url: 'https://example.invalid/',
    }));
    rejects([valid({ links })], /11 links, max 10/);
  });

  test('rejects a non-absolute image URI', () => {
    rejects([valid({ images: ['/relative/path.png'] })], /is not an absolute URI/);
  });
});

describe('validate — structure', () => {
  test('rejects an unknown field, but allows "_" provenance notes', () => {
    rejects([valid({ sortOrder: 3 })], /unknown field "sortOrder"/);
    assert.doesNotThrow(() => validate([valid({ _dates: 'a note for humans' })]));
  });

  test('rejects duplicate titles within the file', () => {
    rejects([valid(), valid()], /duplicate title/);
  });

  test('reports every problem at once, not just the first', () => {
    assert.throws(
      () => validate([valid({ title: '  ', tags: ['  '], startedOn: '2026-02-30' })]),
      /3 validation error\(s\)/,
    );
  });

  test('CONTRACT_FIELDS is exactly ProjectWriteRequest, so notes cannot reach the API', () => {
    assert.deepEqual(
      [...CONTRACT_FIELDS].sort(),
      ['completedOn', 'description', 'images', 'links', 'startedOn', 'tags', 'title'],
    );
  });
});

describe('renderDescription', () => {
  test('joins paragraphs with a blank line and adds a trailing newline', () => {
    assert.equal(renderDescription(['one', 'two']), 'one\n\ntwo\n');
  });
});

describe('locality guard', () => {
  test('allows loopback spellings', () => {
    for (const url of [
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
      'http://LOCALHOST:8080',
    ]) {
      assert.equal(assertSeedTarget(url, 'TEST'), url);
    }
  });

  test('the refusal message advertises only hosts it will actually accept', () => {
    // The bug this pins: the message used to list `::1` and `0:0:0:0:0:0:0:1`, neither of which
    // `URL.hostname` can ever return — so copying one out of the error got you refused by the
    // list that had just offered it.
    let message = '';
    try {
      assertSeedTarget('https://example.invalid/', 'TEST');
    } catch (error) {
      message = error.message;
    }
    const advertised = /Allowed loopback hosts: (.+)/.exec(message)[1].split(', ');
    for (const host of advertised) {
      const url = host === 'localhost' ? 'http://localhost' : `http://${host}`;
      assert.doesNotThrow(
        () => assertSeedTarget(url, 'TEST'),
        `message advertises "${host}" but the guard refuses it`,
      );
    }
  });

  test('refuses non-loopback and near-miss hosts', () => {
    for (const url of [
      'https://example.invalid/',
      'http://127.0.0.2:8080',
      'http://0.0.0.0:8080',
      'http://localhost.:8080',
      'http://127.0.0.1.evil.invalid:8080',
      'http://127.0.0.1@evil.invalid/',
      'not-a-url',
    ]) {
      assert.throws(() => assertSeedTarget(url, 'TEST'), /Refusing to run the content seed/, url);
    }
  });

  test('no environment variable alone opens the remote door', () => {
    const previous = process.env.SEED_ALLOW_REMOTE_HOST;
    process.env.SEED_ALLOW_REMOTE_HOST = 'example.invalid';
    try {
      assert.throws(
        () => assertSeedTarget('https://example.invalid/', 'TEST'),
        /Refusing to run the content seed/,
      );
    } finally {
      if (previous === undefined) delete process.env.SEED_ALLOW_REMOTE_HOST;
      else process.env.SEED_ALLOW_REMOTE_HOST = previous;
    }
  });
});
