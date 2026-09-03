import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The backend host is written down in two files that nothing forces to agree: the
 * `preconnect`/`dns-prefetch` hints in `src/index.html`, and `apiBaseUrl` in
 * `src/environments/environment.ts`. The subdomain moved twice during Phase 5
 * (`tojest.dev` -> `bieda.it`), both times by hand in both files, and PR #175 exists because one
 * of those edits was missed (issue #178).
 *
 * That failure is silent. A stale `preconnect` breaks nothing and warns about nothing: the browser
 * completes a DNS lookup, TCP handshake and TLS negotiation to a host the app never then requests,
 * while the real calls go somewhere else and pay for their own round trip. The only symptom is a
 * latency regression -- the handshake the hint was supposed to save now costs one instead.
 *
 * So the entire value of this file is that it reads BOTH sides off disk. Asserting either side
 * against a hostname literal written here would just create a third copy to keep in sync, which is
 * the bug rather than the fix.
 */

// -------------------------------------------------------------------------------------------
// Locating the real files
// -------------------------------------------------------------------------------------------

/**
 * `ng test` currently runs with cwd = `frontend/`, but nothing in angular.json pins that, and a
 * spec that silently reads nothing is worse than no spec. So walk up from cwd accepting either a
 * project root or a repo root containing `frontend/`, and throw rather than fall back.
 */
function projectRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, join(dir, 'frontend')]) {
      if (
        existsSync(join(candidate, 'angular.json')) &&
        existsSync(join(candidate, 'src', 'index.html'))
      ) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'could not locate the frontend project root (angular.json + src/index.html) from cwd ' +
          process.cwd(),
      );
    }
    dir = parent;
  }
}

const ROOT = projectRoot();
const INDEX_HTML = join(ROOT, 'src', 'index.html');
const PROD_ENVIRONMENT = join(ROOT, 'src', 'environments', 'environment.ts');

// -------------------------------------------------------------------------------------------
// Reading the production environment
// -------------------------------------------------------------------------------------------

/**
 * Read as text rather than imported, and this is not squeamishness about bundlers.
 * angular.json's `development` build configuration lists a `fileReplacements` entry swapping
 * `environments/environment.ts` for `environments/environment.development.ts`, and the unit-test
 * builder applies it: inside a spec, `import { environment } from '.../environment'` resolves to
 * the DEVELOPMENT object (`production: false`, `apiBaseUrl: '/api/v1'`). There is no import
 * specifier that reaches the production file, because the replacement is keyed on the resolved
 * path. Importing would therefore assert against a relative path `new URL()` cannot even parse --
 * and the production origin, the only one index.html's hints are about, would go unchecked.
 *
 * Comments are stripped first because environment.ts's header discusses `apiBaseUrl` in prose, and
 * exactly one match is required so that neither a second declaration nor a rename can leave this
 * passing on a stale value.
 */
function productionApiBaseUrl(): string {
  const source = readFileSync(PROD_ENVIRONMENT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

  const matches = [...source.matchAll(/\bapiBaseUrl\s*:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  expect(matches.length, 'expected exactly one apiBaseUrl declaration in ' + PROD_ENVIRONMENT).toBe(
    1,
  );

  // Confirms the file just parsed really is the production one, and not the development file
  // reached by some path mishap -- the development environment's relative `/api/v1` has no origin,
  // so silently reading it would make every assertion below vacuous.
  expect(
    /\bproduction\s*:\s*true\b/.test(source),
    PROD_ENVIRONMENT + ' is not production: true',
  ).toBe(true);

  return matches[0];
}

// -------------------------------------------------------------------------------------------
// Reading index.html's resource hints
// -------------------------------------------------------------------------------------------

const html = readFileSync(INDEX_HTML, 'utf8');
const parsedIndex = new DOMParser().parseFromString(html, 'text/html');

/**
 * Parsed rather than pattern-matched. index.html already carries unrelated hints (the two font
 * `preload`s) and may gain more -- a `preconnect` to a font CDN or an analytics host is an ordinary
 * thing to add. A regex loose enough to find "the preconnect" would start matching one of those the
 * day it appears; querying by `rel` and then comparing origins cannot.
 */
function hints(rel: string): { href: string; crossorigin: boolean }[] {
  return [...parsedIndex.querySelectorAll('link[rel="' + rel + '"]')].map((link) => ({
    href: link.getAttribute('href') ?? '',
    crossorigin: link.hasAttribute('crossorigin'),
  }));
}

/** An href is "the API hint" when its origin is the API's -- a hint's path is meaningless. */
function originOf(href: string): string | null {
  try {
    return new URL(href).origin;
  } catch {
    return null; // relative hrefs (the font preloads) simply are not origin hints
  }
}

function mismatchMessage(rel: string, apiBaseUrl: string, found: { href: string }[]): string {
  return (
    'index.html has no <link rel="' +
    rel +
    '"> for the API origin.\n' +
    '  environment.ts apiBaseUrl: ' +
    apiBaseUrl +
    '  (origin ' +
    new URL(apiBaseUrl).origin +
    ')\n' +
    '  index.html ' +
    rel +
    ' hrefs: ' +
    (found.map((h) => h.href).join(', ') || '(none)') +
    '\n' +
    '  Both files name the backend host by hand; they have to be edited together.'
  );
}

// -------------------------------------------------------------------------------------------

describe('index.html resource hints agree with the production API origin', () => {
  it('read both files off disk', () => {
    // Without this the checks below could pass by finding nothing at all, which is precisely the
    // state (a missing hint) they exist to catch.
    expect(html, INDEX_HTML + ' is empty').toContain('<html');
    expect(parsedIndex.querySelectorAll('link[rel]').length).toBeGreaterThan(0);
  });

  it('states an absolute production apiBaseUrl', () => {
    const apiBaseUrl = productionApiBaseUrl();
    expect(
      originOf(apiBaseUrl),
      'production apiBaseUrl must be absolute for index.html to hint at its origin, got: ' +
        apiBaseUrl,
    ).not.toBeNull();
  });

  it('preconnects to the origin apiBaseUrl actually names', () => {
    const apiBaseUrl = productionApiBaseUrl();
    const apiOrigin = new URL(apiBaseUrl).origin;
    const preconnects = hints('preconnect');

    expect(preconnects.length, 'index.html declares no preconnect at all').toBeGreaterThan(0);

    const matching = preconnects.filter((hint) => originOf(hint.href) === apiOrigin);
    expect(matching.length, mismatchMessage('preconnect', apiBaseUrl, preconnects)).toBeGreaterThan(
      0,
    );

    // Browsers keep separate socket pools for anonymous and credentialed connections. Nothing sets
    // withCredentials, so every API call goes out anonymous; a preconnect without `crossorigin`
    // warms the credentialed pool instead and is as wasted as a stale hostname would be.
    for (const hint of matching) {
      expect(hint.crossorigin, 'preconnect to ' + hint.href + ' is missing crossorigin').toBe(true);
    }
  });

  it('dns-prefetches the origin apiBaseUrl actually names', () => {
    const apiBaseUrl = productionApiBaseUrl();
    const apiOrigin = new URL(apiBaseUrl).origin;
    const prefetches = hints('dns-prefetch');

    expect(prefetches.length, 'index.html declares no dns-prefetch at all').toBeGreaterThan(0);

    const matching = prefetches.filter((hint) => originOf(hint.href) === apiOrigin);
    expect(
      matching.length,
      mismatchMessage('dns-prefetch', apiBaseUrl, prefetches),
    ).toBeGreaterThan(0);
  });
});
