import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * `public/_headers` is read only by Netlify, so no test that runs the app can see it: a policy
 * violation shows in the browser console and nowhere else (#122). This reads the file off disk
 * and pins what the policy is for. A test cannot show the policy *works* -- that was checked in a
 * browser against a built bundle served with these headers -- but it can stop the protection
 * being loosened quietly, and stop the build drifting into a shape the policy breaks.
 *
 * The API origin in connect-src is checked with the other copies of the backend host, in
 * api-origin-hints.spec.ts.
 */

/** Walk up from cwd to the frontend root, as `api-origin-hints.spec.ts` does; throw, never guess. */
function projectRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, join(dir, 'frontend')]) {
      if (existsSync(join(candidate, 'angular.json')) && existsSync(join(candidate, 'public', '_headers'))) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate the frontend project root (angular.json + public/_headers) from cwd ' + process.cwd());
    }
    dir = parent;
  }
}

const ROOT = projectRoot();

/**
 * Netlify's format: a path on its own line, then indented `Name: value` lines that apply to it.
 * `#` lines are comments. Only the `/*` block matters here; every path is under it. A path written
 * twice is refused rather than merged: Netlify would apply both blocks, and keeping only one here
 * would leave the other's headers unchecked.
 */
function headersFor(path: string): Map<string, string[]> {
  const blocks = new Map<string, [string, string][]>();
  let current: [string, string][] | undefined;
  for (const raw of readFileSync(join(ROOT, 'public', '_headers'), 'utf8').split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      if (blocks.has(raw.trim())) throw new Error(`public/_headers names the path ${raw.trim()} twice`);
      current = [];
      blocks.set(raw.trim(), current);
      continue;
    }
    const colon = raw.indexOf(':');
    current?.push([raw.slice(0, colon).trim().toLowerCase(), raw.slice(colon + 1).trim()]);
  }
  const byName = new Map<string, string[]>();
  for (const [name, value] of blocks.get(path) ?? []) {
    byName.set(name, [...(byName.get(name) ?? []), value]);
  }
  return byName;
}

const headers = headersFor('/*');

/** One header's value, requiring it to be set exactly once: two CSP headers are two policies. */
function single(name: string): string {
  const values = headers.get(name) ?? [];
  expect(values, `public/_headers sets ${name} ${values.length} times for /*`).toHaveLength(1);
  return values[0];
}

/**
 * The policy as directive -> sources. A repeated directive is refused: a browser obeys the first
 * and ignores the rest, so a loose copy ahead of a strict one would pass any check that read only
 * one of them.
 */
function policy(): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of single('content-security-policy').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    if (directives.has(name.toLowerCase())) throw new Error(`the policy sets ${name} twice`);
    directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

describe('public/_headers', () => {
  it('runs only this origin\'s own scripts: no inline script, no eval, no other host', () => {
    expect(policy().get('script-src')).toEqual(["'self'"]);
  });

  // CSP3 browsers read these two in place of script-src, for <script> elements and for inline
  // handlers respectively, so either could reopen what script-src closes without touching it.
  it('does not widen script-src through script-src-elem or script-src-attr', () => {
    const csp = policy();
    for (const directive of ['script-src-elem', 'script-src-attr']) {
      if (csp.has(directive)) expect(csp.get(directive), directive).toEqual(["'self'"]);
    }
  });

  it('allows inline sources only where Angular needs them, which is styles', () => {
    for (const [directive, sources] of policy()) {
      expect(sources, `${directive} must not allow eval`).not.toContain("'unsafe-eval'");
      if (directive !== 'style-src') {
        expect(sources, `${directive} must not allow inline`).not.toContain("'unsafe-inline'");
      }
    }
  });

  it('closes what default-src does not cover, and nothing may frame the site', () => {
    const csp = policy();
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('keeps plain http images out while allowing the https ones admins paste in', () => {
    const img = policy().get('img-src') ?? [];
    expect(img).toContain('https:');
    expect(img).not.toContain('http:');
    expect(img).not.toContain('*');
  });

  it('sends the headers that do not depend on CSP support', () => {
    expect(single('x-frame-options')).toBe('DENY');
    expect(single('x-content-type-options')).toBe('nosniff');
    expect(single('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('angular.json, against the policy above', () => {
  // Critical-CSS inlining loads the global stylesheet as
  //   <link rel="stylesheet" href="styles-*.css" media="print" onload="this.media='all'">
  // and script-src 'self' refuses that inline handler, so the stylesheet stays at media="print"
  // for good: the page renders with only the inlined critical rules. Measured in a browser while
  // building #122. `optimization: true`, or dropping the key, turns inlining back on.
  it('does not inline critical CSS in the production build', () => {
    interface Production {
      optimization?: { styles?: { inlineCritical?: boolean } };
    }
    interface Workspace {
      projects: Record<string, { architect: { build: { configurations: { production: Production } } } }>;
    }
    const angular = JSON.parse(readFileSync(join(ROOT, 'angular.json'), 'utf8')) as Workspace;
    const production = Object.values(angular.projects)[0].architect.build.configurations.production;

    expect(
      production.optimization?.styles?.inlineCritical,
      'production optimization.styles.inlineCritical must be false; see the comment above',
    ).toBe(false);
  });
});
