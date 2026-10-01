import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The backend host is written down by hand in several places that nothing else forces to agree.
 * This file checks five of them against `apiBaseUrl` in `src/environments/environment.ts`: the
 * `preconnect` and `dns-prefetch` hints in `src/index.html`, the production `servers:` entry in
 * `docs/openapi.yaml`, the public health check in `.github/workflows/deploy-backend.yml` (those two
 * added by #181), and `connect-src` in `public/_headers` (#122). The subdomain moved during Phase 5 (`tojest.dev` -> `bieda.it`), and
 * the rename commit (67cdaf1, 2026-09-03) edited only openapi.yaml, leaving the app and its hints
 * on the retired host until PR #175 (issue #178).
 *
 * One more copy is deliberately left out: content-seed/locality.mjs's approved-hosts list. Allowing
 * the seed to write to a host is its own decision, and following a host change automatically would
 * merge it back into this one -- see that file's comment. docs/DEPLOYMENT.md §1 lists every place.
 *
 * That failure is silent. A stale `preconnect` breaks nothing and warns about nothing: the browser
 * completes a DNS lookup, TCP handshake and TLS negotiation to a host the app never then requests,
 * while the real calls go somewhere else and pay for their own round trip. The only symptom is a
 * latency regression -- the handshake the hint was supposed to save now costs one instead.
 *
 * So the entire value of this file is that it reads every side off disk. Asserting any of them
 * against a hostname literal written here would just add another copy to keep in sync, which is
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
 *
 * The price of that tolerance, stated plainly so nobody assumes coverage this does not have:
 * a *superseded* hint left alongside the correct one -- the additive half of a rename -- passes.
 * Both hosts are hinted, one of them pointlessly, and that is the exact waste this file exists
 * to prevent, in the one shape it cannot see.
 */
function hints(rel: string): { href: string; crossorigin: string | null }[] {
  return [...parsedIndex.querySelectorAll('link[rel="' + rel + '"]')].map((link) => ({
    href: link.getAttribute('href') ?? '',
    // The *value*, not just presence. `crossorigin="use-credentials"` is a real attribute and
    // warms the wrong socket pool -- exactly the defect the assertion below describes -- so
    // hasAttribute() would wave through the thing being guarded against.
    crossorigin: link.getAttribute('crossorigin'),
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

/**
 * Fails with the offending value rather than letting `new URL()` throw a bare `Invalid URL`.
 * A relative production `apiBaseUrl` is not absurd -- it becomes correct the day the API is
 * fronted same-origin -- and when it happens the reader needs to be told which file to look in,
 * not handed a TypeError naming neither.
 */
function requireOrigin(apiBaseUrl: string): string {
  const origin = originOf(apiBaseUrl);
  if (origin === null) {
    throw new Error(
      'production apiBaseUrl is not absolute, so no index.html origin hint can match it: ' +
        apiBaseUrl +
        ' (' +
        PROD_ENVIRONMENT +
        ')',
    );
  }
  return origin;
}

function mismatchMessage(rel: string, apiBaseUrl: string, found: { href: string }[]): string {
  return (
    'index.html has no <link rel="' +
    rel +
    '"> for the API origin.\n' +
    '  environment.ts apiBaseUrl: ' +
    apiBaseUrl +
    '  (origin ' +
    (originOf(apiBaseUrl) ?? '(not an absolute URL)') +
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
// Reading openapi.yaml's production server
// -------------------------------------------------------------------------------------------

/** The contract, one level above the frontend project. readFileSync throws if it is not there. */
const OPENAPI = join(ROOT, '..', 'docs', 'openapi.yaml');

/**
 * The `url` of every `servers:` entry whose description begins "Production".
 *
 * Pattern-matched rather than parsed, because the frontend has no YAML parser of its own and
 * borrowing a transitive one would break the day it is deduped away. The block is small and flat,
 * and SERVERS_SHAPE below is the one shape read; anything else -- valid YAML included, such as a
 * comment after `servers:` or `description:` before `url:` -- fails loudly rather than passing on
 * nothing, and the message says which shape was expected.
 *
 * What it cannot see: an entry is "production" only when its description *starts* with the word, so
 * a leftover described as, say, "Retired production host" is not counted and passes. The "exactly
 * one" check below catches a second entry only while it still reads "Production ...".
 */
const SERVERS_SHAPE =
  'a top-level `servers:` line with nothing after it, then indented `- url: <url>` lines each ' +
  'followed directly by `description: <text>`';

function productionServerUrls(): string[] {
  const yaml = readFileSync(OPENAPI, 'utf8').replace(/\r\n/g, '\n');
  const block = /^servers:\n((?:[ \t]+.*\n|\n)*)/m.exec(yaml)?.[1];
  if (!block) {
    throw new Error(
      'no servers: block in the shape this reads, in ' + OPENAPI + '; expected ' + SERVERS_SHAPE,
    );
  }
  const entries = [...block.matchAll(/-\s+url:\s*(\S+)\s*\n\s+description:\s*(.*)/g)];
  expect(
    entries.length,
    'no url/description pairs under servers: in ' + OPENAPI + '; expected ' + SERVERS_SHAPE,
  ).toBeGreaterThan(0);
  return entries
    .filter((entry) => /^production\b/i.test(entry[2].trim()))
    .map((entry) => entry[1].replace(/^['"]|['"]$/g, ''));
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
    const apiOrigin = requireOrigin(apiBaseUrl);
    const preconnects = hints('preconnect');

    expect(preconnects.length, 'index.html declares no preconnect at all').toBeGreaterThan(0);

    const matching = preconnects.filter((hint) => originOf(hint.href) === apiOrigin);
    expect(matching.length, mismatchMessage('preconnect', apiBaseUrl, preconnects)).toBeGreaterThan(
      0,
    );

    // Browsers keep separate socket pools for anonymous and credentialed connections. Nothing sets
    // withCredentials, so every API call goes out anonymous. A preconnect that is not
    // anonymous-CORS warms the credentialed pool instead and is as wasted as a stale hostname.
    // A bare `crossorigin` parses as the empty string, which is the anonymous keyword.
    for (const hint of matching) {
      expect(
        ['', 'anonymous'],
        'preconnect to ' +
          hint.href +
          ' must be anonymous-CORS to warm the pool the app actually uses, but has ' +
          (hint.crossorigin === null
            ? 'no crossorigin attribute'
            : 'crossorigin="' + hint.crossorigin + '"') +
          '.',
      ).toContain(hint.crossorigin);
    }
  });

  it('dns-prefetches the origin apiBaseUrl actually names', () => {
    const apiBaseUrl = productionApiBaseUrl();
    const apiOrigin = requireOrigin(apiBaseUrl);
    const prefetches = hints('dns-prefetch');

    expect(prefetches.length, 'index.html declares no dns-prefetch at all').toBeGreaterThan(0);

    const matching = prefetches.filter((hint) => originOf(hint.href) === apiOrigin);
    expect(
      matching.length,
      mismatchMessage('dns-prefetch', apiBaseUrl, prefetches),
    ).toBeGreaterThan(0);
  });
});

// #181. A stale entry here breaks no request -- app.config.ts hands environment.apiBaseUrl to
// provideApi(), and the generator takes its own default from the *first*, local, servers entry --
// but it misinforms whoever reads the contract, which CLAUDE.md names as the API's source of truth.
// Compared in full, path included: this entry is the contract's statement of the base URL itself,
// where index.html's hints are only ever about an origin.
describe('openapi.yaml names the same production API as environment.ts', () => {
  it('has exactly one production server, and it is apiBaseUrl', () => {
    const apiBaseUrl = productionApiBaseUrl();
    const servers = productionServerUrls();

    expect(
      servers.length,
      'expected exactly one servers: entry described as Production in ' +
        OPENAPI +
        ', found ' +
        servers.length,
    ).toBe(1);
    expect(
      servers[0].replace(/\/$/, ''),
      'docs/openapi.yaml production server disagrees with environment.ts apiBaseUrl (' +
        apiBaseUrl +
        '). Both name the backend host by hand; docs/DEPLOYMENT.md §1 lists every place.',
    ).toBe(apiBaseUrl.replace(/\/$/, ''));
  });
});

// -------------------------------------------------------------------------------------------
// Reading deploy-backend.yml's public health check
// -------------------------------------------------------------------------------------------

/** The backend deploy workflow, at the repo root beside docs/. */
const DEPLOY_BACKEND = join(ROOT, '..', '.github', 'workflows', 'deploy-backend.yml');

// #181's review. The one copy whose staleness fails loudly, and in the wrong place: after a host
// change, the next push to main deploys fine, then "Verify from the public internet" curls the old
// host. If that host still resolves -- a retired subdomain answering the provider's 404 did exactly
// that -- the run fails after ten attempts, blaming the proxy or the firewall. Compared by origin:
// the check's path is the actuator's, which apiBaseUrl rightly does not share. https only: a check
// on the host's own loopback (deploy/deploy.sh has one) is plain http and not about this host.
describe('deploy-backend.yml health-checks the origin environment.ts calls', () => {
  it('curls only the apiBaseUrl origin for its public health check', () => {
    const apiOrigin = requireOrigin(productionApiBaseUrl());
    const workflow = readFileSync(DEPLOY_BACKEND, 'utf8');
    const checked = [...workflow.matchAll(/https:\/\/[^\s'"]+\/actuator\/health/g)].map(
      (m) => m[0],
    );

    expect(
      checked.length,
      'no https://.../actuator/health URL in ' +
        DEPLOY_BACKEND +
        '; if the public check moved or changed shape, update this test with it',
    ).toBeGreaterThan(0);
    for (const url of checked) {
      expect(
        originOf(url),
        DEPLOY_BACKEND +
          ' health-checks ' +
          url +
          ', not the environment.ts apiBaseUrl origin; docs/DEPLOYMENT.md §1 lists every place.',
      ).toBe(apiOrigin);
    }
  });
});

// -------------------------------------------------------------------------------------------
// Reading public/_headers' connect-src
// -------------------------------------------------------------------------------------------

/** Netlify's header rules, copied into the build from public/ and read by nothing else. */
const NETLIFY_HEADERS = join(ROOT, 'public', '_headers');

// #122. Unlike a stale hint, a stale connect-src is not silent: the browser refuses every API call
// and the deployed site renders its error states on every page. But it is silent everywhere a
// developer looks -- `ng serve` never reads _headers, and the unit tests never send a request --
// so the first place it would show is production. security-headers.spec.ts pins the rest of the
// policy.
describe('public/_headers lets the deployed app call the origin environment.ts names', () => {
  it('allows the apiBaseUrl origin in connect-src', () => {
    const apiOrigin = requireOrigin(productionApiBaseUrl());
    const policies = readFileSync(NETLIFY_HEADERS, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\s+content-security-policy\s*:/i.test(line));

    expect(policies, 'expected exactly one Content-Security-Policy in ' + NETLIFY_HEADERS).toHaveLength(1);
    const connect = policies[0]
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find(([name]) => /connect-src$/i.test(name));

    expect(
      connect?.slice(1),
      NETLIFY_HEADERS +
        "'s connect-src does not allow " +
        apiOrigin +
        '; the deployed site could not reach its API. docs/DEPLOYMENT.md §1 lists every place.',
    ).toContain(apiOrigin);
  });
});
