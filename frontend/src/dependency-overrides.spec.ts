import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * package.json's `overrides` force a patched version of a package under the one dependency that
 * pulls it in, before that dependency asks for the patch itself (#244). An override outlives its
 * reason silently: npm goes on applying it after the parent has moved on, and the tree stays pinned
 * to a version nobody chose any more. So each override is listed here with the version that fixes
 * its advisory, and this file fails in the pull request that makes one unnecessary -- the one that
 * upgrades the parent -- saying to delete it.
 *
 * Read from package-lock.json rather than node_modules: the lockfile is committed, so this checks
 * what CI and Netlify install, and needs no install to run.
 */
const OVERRIDES = [
  { parent: '@angular/build', child: 'piscina', fixedIn: '5.3.2', advisory: 'GHSA-67c8-pqhq-4rmx' },
  { parent: 'get-uri', child: 'basic-ftp', fixedIn: '6.2.1', advisory: 'GHSA-c475-qrg2-pj4r' },
];

/** Walk up from cwd to the frontend root, as `api-origin-hints.spec.ts` does; throw, never guess. */
function projectRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, join(dir, 'frontend')]) {
      if (existsSync(join(candidate, 'angular.json')) && existsSync(join(candidate, 'package-lock.json'))) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate the frontend project root (angular.json + package-lock.json) from cwd ' + process.cwd());
    }
    dir = parent;
  }
}

const ROOT = projectRoot();

interface LockEntry {
  version?: string;
  dependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  overrides?: Record<string, Record<string, string>>;
};
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockEntry>;
};

/** Every installed copy of `name`, wherever npm nested it. The root project's own key is ''. */
function installed(name: string): LockEntry[] {
  return Object.entries(lock.packages)
    .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
    .map(([, entry]) => entry);
}

/** `[major, minor, patch]`, ignoring any prerelease tag. */
function parse(version: string): number[] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`not a full x.y.z version: ${version}`);
  }
  return match.slice(1, 4).map(Number);
}

function atLeast(version: string, floor: string): boolean {
  const [a, b] = [parse(version), parse(floor)];
  const i = a.findIndex((part, k) => part !== b[k]);
  return i === -1 || a[i] > b[i];
}

/**
 * The lowest version a dependency range admits: the first x.y.z in it. Right for the forms these
 * parents use -- an exact pin (`5.2.0`) and a caret (`^5.3.1`) -- and for `~` and `>=`. A range it
 * cannot read, such as `5.x`, throws rather than passing.
 */
function lowestAdmitted(range: string): string {
  return parse(range).join('.');
}

describe('package.json overrides', () => {
  it('are exactly the ones listed here, so each has a stated reason to be removed', () => {
    const declared = Object.entries(manifest.overrides ?? {}).flatMap(([parent, children]) =>
      Object.keys(children).map((child) => `${child} under ${parent}`),
    );

    expect(declared.sort()).toEqual(OVERRIDES.map(({ parent, child }) => `${child} under ${parent}`).sort());
  });

  it.each(OVERRIDES)('leave no copy of $child older than $fixedIn ($advisory)', ({ child, fixedIn }) => {
    const versions = installed(child).map((entry) => entry.version ?? '(no version)');

    expect(versions.length, `${child} is not in package-lock.json at all`).toBeGreaterThan(0);
    expect(versions.filter((version) => !atLeast(version, fixedIn))).toEqual([]);
  });

  it.each(OVERRIDES)('$child under $parent is still needed', ({ parent, child, fixedIn }) => {
    const ranges = installed(parent).map((entry) => entry.dependencies?.[child]);

    // A parent that has left the tree, or stopped depending on the child, leaves the override
    // doing nothing at all -- which is also a reason to remove it.
    expect(ranges.length, `${parent} is no longer installed; remove its override`).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range, `${parent} no longer depends on ${child}; remove the override`).toBeDefined();
      expect(
        atLeast(lowestAdmitted(range as string), fixedIn),
        `${parent} now asks for ${child} ${range}, which already excludes every version before ` +
          `${fixedIn}. Remove the override from package.json and from OVERRIDES in this file.`,
      ).toBe(false);
    }
  });
});
