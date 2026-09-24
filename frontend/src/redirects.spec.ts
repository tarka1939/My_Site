import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * `public/_redirects` is copied into the build verbatim and read only by Netlify, so nothing in the
 * app exercises it. Netlify applies the first rule that matches, which makes line order part of
 * the file's meaning: a `/about` redirect placed below the `/*` SPA fallback is valid syntax and
 * never fires. This reads the file off disk and pins both rules and their order.
 */

/** Walk up from cwd to the frontend root, as `api-origin-hints.spec.ts` does; throw, never guess. */
function projectRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, join(dir, 'frontend')]) {
      if (existsSync(join(candidate, 'angular.json')) && existsSync(join(candidate, 'public', '_redirects'))) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate the frontend project root (angular.json + public/_redirects) from cwd ' + process.cwd());
    }
    dir = parent;
  }
}

/** Each non-comment, non-blank line split into its whitespace-separated fields. */
const rules = readFileSync(join(projectRoot(), 'public', '_redirects'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => line.split(/\s+/));

describe('public/_redirects', () => {
  it('permanently redirects the old /about URL to the site root', () => {
    expect(rules).toContainEqual(['/about', '/', '301']);
  });

  it('keeps the SPA fallback as a 200 rewrite', () => {
    expect(rules).toContainEqual(['/*', '/index.html', '200']);
  });

  it('puts the /about redirect before the catch-all, where Netlify will reach it', () => {
    const about = rules.findIndex((r) => r[0] === '/about');
    const fallback = rules.findIndex((r) => r[0] === '/*');

    expect(about).toBeGreaterThanOrEqual(0);
    expect(about).toBeLessThan(fallback);
  });
});
