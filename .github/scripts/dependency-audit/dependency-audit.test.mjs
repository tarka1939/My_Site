/**
 * Tests for the weekly dependency audit (#273).
 *
 * Run with:  node --test .github/scripts/dependency-audit/dependency-audit.test.mjs
 *
 * (A directory argument does not work on Node 24: --test takes files or globs.)
 *
 * Standard library only, like the scripts. No network: the OSV client is driven by a fake fetch.
 *
 * Every fixture in fixtures/ but one is the real output of a real run on 2026-10-14 or later, not a
 * hand-written imitation of one. The exception is maven-dependency-list-old.txt, below.
 *
 *   npm-clean.json             `npm audit --json --package-lock-only` in frontend/, exit 0
 *   npm-findings.json          the same against a throwaway lockfile pinning known-vulnerable
 *                              packages (lodash 4.17.20, minimist 1.2.5, body-parser 1.19.0, ...),
 *                              exit 1; that lockfile is npm-findings.lockfile.json
 *   npm-error.json             the same with --registry pointed at a closed port, exit 1
 *   maven-dependency-list.txt  `mvn dependency:list -DoutputFile=...` in backend/, 167 dependencies
 *   maven-dependency-list-optional.txt  the same on 2026-10-16, with <optional>true</optional>
 *                              added to postgresql in backend/pom.xml for the run and reverted
 *   maven-dependency-list-old.txt  HAND-WRITTEN in the real format: three deliberately old
 *                              versions, plus a `tests`-classifier line for spring-core that only
 *                              exercises the classifier and two-scope paths. No such jar exists on
 *                              Central; nothing resolves it, and OSV is queried by name and version
 *                              only, so it does not affect osv-findings.json.
 *   osv-clean.json             osv-query.mjs on maven-dependency-list.txt
 *   osv-findings.json          osv-query.mjs on maven-dependency-list-old.txt (real OSV answers)
 *   osv-error.json             osv-query.mjs with OSV_API_BASE at a closed port
 *
 * The lockfile is deliberately not named package-lock.json: GitHub's dependency graph and
 * Dependabot read every file of that name in the repository, and would raise alerts for it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyseBackend,
  analyseNpmAudit,
  buildResults,
  compareMavenVersions,
  compareSemver,
  encodeState,
  findingKey,
  fingerprint,
  ISSUE,
  issueTitle,
  meetsFloor,
  normaliseSeverity,
  npmFixedIn,
  osvPackages,
  parseMavenDependencyList,
  parseState,
  planIssue,
  renderReport,
  satisfiesRange,
} from './lib.mjs';
import { queryOsv } from './osv-query.mjs';
import { applyPlan, assertWriteAllowed, createGh, preflight } from './issue.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const FRONTEND_LOCK = fixture('npm-findings.lockfile.json');

const npm = (overrides = {}) =>
  analyseNpmAudit({
    area: 'frontend',
    stdout: fixture('npm-findings.json'),
    exitCodeText: '1\n',
    lockfileText: FRONTEND_LOCK,
    ships: 'lockfile',
    ...overrides,
  });

const backend = (overrides = {}) => analyseBackend({ mvnExitText: '0\n', osvText: fixture('osv-findings.json'), ...overrides });

const find = (result, pkg, id) => result.findings.find((f) => f.package === pkg && f.id === id);

// -------------------------------------------------------------------------------------------------

describe('npm audit: a finding and a failure both exit 1, and are told apart by the JSON', () => {
  test('the real findings report, exit 1, is a completed audit with findings', () => {
    const r = npm();
    assert.equal(r.status, 'ok');
    assert.equal(r.findings.length, 15);
    assert.equal(r.checked, 31);
  });

  test('the real registry failure, exit 1, is an audit that could not complete', () => {
    const r = npm({ stdout: fixture('npm-error.json'), exitCodeText: '1' });
    assert.equal(r.status, 'errored');
    assert.match(r.error, /could not complete \(exit 1\)/);
    assert.match(r.error, /ECONNREFUSED/);
    assert.deepEqual(r.findings, []);
  });

  test('the real clean report, exit 0, is a completed audit with nothing found', () => {
    const r = npm({ stdout: fixture('npm-clean.json'), exitCodeText: '0', lockfileText: '{"packages":{}}' });
    assert.equal(r.status, 'ok');
    assert.equal(r.findings.length, 0);
    assert.equal(r.checked, 803);
  });

  const broken = [
    ['no output file at all', { stdout: null }, /wrote no output file/],
    ['no recorded exit code', { exitCodeText: null }, /exit code was not recorded/],
    ['a garbled exit code', { exitCodeText: 'oops' }, /exit code was not recorded/],
    ['empty stdout', { stdout: '' }, /wrote nothing to stdout/],
    ['only a byte-order mark', { stdout: '﻿\n' }, /wrote nothing to stdout/],
    ['text that is not JSON', { stdout: 'npm ERR! something' }, /not JSON/],
    ['a JSON array', { stdout: '[]' }, /not a JSON object/],
    ['an unknown report version', { stdout: '{"auditReportVersion":3,"vulnerabilities":{}}', exitCodeText: '0' }, /not a version 2 audit report/],
    ['a clean report that exits 1', { stdout: fixture('npm-clean.json'), exitCodeText: '1' }, /exited 1 but reported no vulnerabilities/],
    ['an exit code other than 0 or 1', { exitCodeText: '2' }, /exited 2/],
    ['an error object without a message', { stdout: '{"error":{"code":"EAUDITNOLOCK"}}' }, /could not complete.*EAUDITNOLOCK/],
    ['a lockfile that cannot be read', { lockfileText: null }, /could not be read/],
    ['a lockfile without a packages map', { lockfileText: '{"lockfileVersion":1}' }, /lockfileVersion 2 or 3/],
  ];
  for (const [name, overrides, expected] of broken) {
    test(`could not complete: ${name}`, () => {
      const r = npm(overrides);
      assert.equal(r.status, 'errored');
      assert.match(r.error, expected);
    });
  }

  test('vulnerable packages with no readable advisory is a failure, not a clean result', () => {
    const stdout = JSON.stringify({ auditReportVersion: 2, vulnerabilities: { a: { via: ['b'], nodes: [] } } });
    const r = npm({ stdout });
    assert.equal(r.status, 'errored');
    assert.match(r.error, /no advisory in them could be read/);
  });

  test('findings that exit 0 (an audit-level setting in .npmrc) still count as findings', () => {
    const r = npm({ exitCodeText: '0' });
    assert.equal(r.status, 'ok');
    assert.equal(r.findings.length, 15);
  });

  test('a byte-order mark before the JSON is tolerated', () => {
    assert.equal(npm({ stdout: `﻿${fixture('npm-findings.json')}` }).findings.length, 15);
  });
});

describe('npm audit: what each finding says', () => {
  const r = npm();

  test('installed version, link, severity and fixed version come from the report and lockfile', () => {
    const f = find(r, 'lodash', 'GHSA-35jh-r3h4-6jhm');
    assert.equal(f.version, '4.17.20');
    assert.equal(f.url, 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm');
    assert.equal(f.severity, 'high');
    assert.equal(f.fixedIn, '4.17.21');
    assert.match(f.title, /Command Injection/);
  });

  test('a range closed with <= gives "a later version", not a version that is still affected', () => {
    assert.equal(find(r, 'braces', 'GHSA-vfj7-8cjw-p6xm').fixedIn, '> 3.0.3');
  });

  test('a production dependency ships; a dev dependency does not', () => {
    assert.equal(find(r, 'minimist', 'GHSA-xvch-5gv4-984h').ships, true);
    assert.equal(find(r, 'minimist', 'GHSA-xvch-5gv4-984h').scope, 'prod');
    assert.equal(find(r, 'semver', 'GHSA-c2qf-rxjj-qqgw').ships, false);
    assert.equal(find(r, 'semver', 'GHSA-c2qf-rxjj-qqgw').scope, 'dev');
  });

  test('e2e/ never ships, whatever its lockfile says', () => {
    const e2e = npm({ area: 'e2e', ships: 'never' });
    assert.ok(e2e.findings.every((f) => f.ships === false && f.scope === 'E2E only'));
  });

  test('a fix that comes through a parent package says which', () => {
    assert.equal(find(r, 'qs', 'GHSA-hrpp-h998-j3pp').fixNote, 'through body-parser 1.20.8');
  });

  test('an advisory is reported on its own package, not repeated on every dependent', () => {
    // body-parser's `via` includes the string "qs"; qs's advisories must appear once, under qs.
    assert.equal(r.findings.filter((f) => f.id === 'GHSA-hrpp-h998-j3pp').length, 1);
    assert.equal(r.findings.filter((f) => f.package === 'body-parser').length, 2);
  });

  test('copies at different versions are separate findings, and only affected ones count', () => {
    const lockfileText = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/x': { version: '1.0.0', dev: true },
        'node_modules/y/node_modules/x': { version: '1.5.0' },
        'node_modules/z/node_modules/x': { version: '2.0.0' },
      },
    });
    const stdout = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        x: {
          nodes: ['node_modules/x', 'node_modules/y/node_modules/x', 'node_modules/z/node_modules/x'],
          via: [{ source: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'moderate', range: '<2.0.0', title: 't' }],
        },
      },
      metadata: { dependencies: { total: 3 } },
    });
    const out = analyseNpmAudit({ area: 'frontend', stdout, exitCodeText: '1', lockfileText, ships: 'lockfile' });
    assert.deepEqual(
      out.findings.map((f) => [f.version, f.ships]),
      [
        ['1.0.0', false],
        ['1.5.0', true],
      ],
    );
  });
});

describe('npm advisory ranges', () => {
  const cases = [
    ['<4.17.21', '4.17.20', '4.17.21'],
    ['>=4.0.0 <=4.17.23', '4.17.20', '> 4.17.23'],
    ['>=2.0.0 <2.0.3 || >=3.0.0 <3.0.1', '3.0.0', '3.0.1'],
    ['>=2.0.0 <2.0.3 || >=3.0.0 <3.0.1', '2.0.1', '2.0.3'],
    ['>= 1.0.0, < 1.2.6'.replace(',', ''), '1.2.5', '1.2.6'],
    ['1.0.0 - 1.2.5', '1.1.0', '> 1.2.5'],
    ['>=1.0.0', '1.1.0', null],
    ['<2', '1.0.0', null],
    ['<1.0.0', 'not-a-version', null],
  ];
  for (const [range, version, expected] of cases) {
    test(`${range} at ${version} is fixed in ${expected}`, () => assert.equal(npmFixedIn(range, version), expected));
  }

  test('satisfiesRange says null, not false, when it cannot read the range', () => {
    assert.equal(satisfiesRange('1.0.0', '<1.0.1'), true);
    assert.equal(satisfiesRange('1.0.1', '<1.0.1'), false);
    assert.equal(satisfiesRange('1.0.0', '^1.0.0'), null);
  });

  test('a prerelease sorts before its release', () => {
    assert.equal(compareSemver('1.0.0-rc.1', '1.0.0'), -1);
    assert.equal(compareSemver('1.0.0-rc.2', '1.0.0-rc.10'), -1);
    assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  });
});

// -------------------------------------------------------------------------------------------------

describe('Maven dependency list', () => {
  test('reads all 167 dependencies of the real backend, with their scopes', () => {
    const deps = parseMavenDependencyList(fixture('maven-dependency-list.txt'));
    assert.equal(deps.length, 167);
    assert.deepEqual(
      deps.find((d) => d.artifact === 'snakeyaml'),
      { group: 'org.yaml', artifact: 'snakeyaml', type: 'jar', classifier: null, version: '2.6', scope: 'compile' },
    );
    assert.ok(deps.some((d) => d.scope === 'test'));
    assert.ok(deps.some((d) => d.scope === 'runtime'));
  });

  test('reads a classifier', () => {
    const deps = parseMavenDependencyList('   org.example:lib:jar:tests:1.2.3:test -- module lib [auto]\n');
    assert.deepEqual(deps[0], { group: 'org.example', artifact: 'lib', type: 'jar', classifier: 'tests', version: '1.2.3', scope: 'test' });
  });

  test('reads an optional dependency, which ships by its scope like any other', () => {
    // Real output with <optional>true</optional> on postgresql: it and its own dependency
    // checker-qual come out as `...:runtime (optional) -- module ...`.
    const text = fixture('maven-dependency-list-optional.txt');
    assert.match(text, /org\.postgresql:postgresql:jar:42\.7\.13:runtime \(optional\) -- module org\.postgresql\.jdbc \[auto\]/);
    const deps = parseMavenDependencyList(text);
    assert.equal(deps.length, 167);
    assert.deepEqual(
      deps.find((d) => d.artifact === 'postgresql'),
      { group: 'org.postgresql', artifact: 'postgresql', type: 'jar', classifier: null, version: '42.7.13', scope: 'runtime' },
    );
    assert.equal(deps.find((d) => d.artifact === 'checker-qual').scope, 'runtime');

    const pkg = osvPackages(deps).find((p) => p.name === 'org.postgresql:postgresql');
    const osvText = JSON.stringify({
      packages: [{ ...pkg, ids: ['GHSA-o'] }],
      vulns: { 'GHSA-o': { id: 'GHSA-o', summary: 's', aliases: [], severity: 'MODERATE', affected: [] } },
    });
    const f = backend({ osvText }).findings[0];
    assert.equal(f.ships, true);
    assert.equal(meetsFloor(f), true);
  });

  test('a line it cannot read fails the audit instead of shrinking it', () => {
    assert.throws(
      () => parseMavenDependencyList('   org.example:lib:jar:1.0:compile\n   something unexpected\n'),
      /1 line\(s\) this script cannot read, starting with "something unexpected"/,
    );
  });

  test('no dependencies at all is a failure', () => {
    assert.throws(() => parseMavenDependencyList('The following files have been resolved:\n   none\n'), /contains no dependencies/);
  });

  test('one OSV query per group:artifact@version, with every scope it appears in', () => {
    const packages = osvPackages(parseMavenDependencyList(fixture('maven-dependency-list-old.txt')));
    assert.deepEqual(
      packages.map((p) => [p.name, p.version, p.scopes.join('+')]),
      [
        ['com.fasterxml.jackson.core:jackson-databind', '2.13.0', 'test'],
        ['org.postgresql:postgresql', '42.2.0', 'runtime'],
        ['org.springframework:spring-core', '6.1.0', 'compile+test'],
      ],
    );
  });

  const order = [
    ['11.0.0-M1', '11.0.0', -1],
    ['11.0.0', '11.0.8', -1],
    ['2.9.8', '2.9.10.3', -1],
    ['2.21', '2.21.5', -1],
    ['1.0', '1.0.0', 0],
    ['1.0.0.RELEASE', '1.0.0', 0],
    ['1.0-alpha1', '1.0-beta1', -1],
    ['1.0-rc1', '1.0-SNAPSHOT', -1],
    ['1.0-SNAPSHOT', '1.0', -1],
    ['1.0', '1.0-sp1', -1],
    ['42.2.28', '42.10.0', -1],
  ];
  for (const [a, b, expected] of order) {
    test(`Maven order: ${a} vs ${b} is ${expected}`, () => {
      assert.equal(compareMavenVersions(a, b), expected);
      assert.equal(compareMavenVersions(b, a), -expected || 0);
    });
  }
});

describe('backend: OSV results to findings', () => {
  test('the real clean graph is a completed audit with nothing found', () => {
    const r = backend({ osvText: fixture('osv-clean.json') });
    assert.equal(r.status, 'ok');
    assert.equal(r.checked, 167);
    assert.equal(r.findings.length, 0);
  });

  test('the real old versions give findings, with two aliased advisories kept once', () => {
    const r = backend();
    assert.equal(r.status, 'ok');
    assert.equal(r.findings.length, 23);
    // GHSA-673j-qm5f-xpv8 (moderate) and GHSA-727h-hrw8-jg8q (low) are one CVE; the worse is kept.
    assert.ok(find(r, 'org.postgresql:postgresql', 'GHSA-673j-qm5f-xpv8'));
    assert.equal(find(r, 'org.postgresql:postgresql', 'GHSA-727h-hrw8-jg8q'), undefined);
  });

  test('fixed version is the lowest fix above the installed one', () => {
    const r = backend();
    assert.equal(find(r, 'org.postgresql:postgresql', 'GHSA-24rp-q3w6-vc56').fixedIn, '42.2.28');
    // 6.1.x has no fix for this one, so the answer is the next line up.
    assert.equal(find(r, 'org.springframework:spring-core', 'GHSA-jmp9-x22r-554x').fixedIn, '6.2.11');
  });

  test('severity, CVE and link come from the OSV record', () => {
    const f = find(backend(), 'org.postgresql:postgresql', 'GHSA-24rp-q3w6-vc56');
    assert.equal(f.severity, 'critical');
    assert.deepEqual(f.aliases, ['CVE-2024-1597']);
    assert.equal(f.url, 'https://github.com/advisories/GHSA-24rp-q3w6-vc56');
  });

  test('test scope does not ship; compile and runtime do, even alongside test', () => {
    const r = backend();
    assert.ok(r.findings.filter((f) => f.package.endsWith('jackson-databind')).every((f) => !f.ships));
    assert.ok(r.findings.filter((f) => f.package.endsWith('postgresql')).every((f) => f.ships));
    assert.equal(find(r, 'org.springframework:spring-core', 'GHSA-jmp9-x22r-554x').scope, 'compile, test');
    assert.equal(find(r, 'org.springframework:spring-core', 'GHSA-jmp9-x22r-554x').ships, true);
  });

  test('the real OSV network failure is an audit that could not complete', () => {
    const r = backend({ osvText: fixture('osv-error.json') });
    assert.equal(r.status, 'errored');
    assert.match(r.error, /OSV lookup could not complete.*ECONNREFUSED/);
  });

  test('a Maven failure fails the audit, even next to a good OSV file', () => {
    const r = backend({ mvnExitText: '1\n' });
    assert.equal(r.status, 'errored');
    assert.match(r.error, /Maven could not resolve the dependency graph \(exit 1\)/);
  });

  const broken = [
    ['no Maven exit code', { mvnExitText: null }, /Maven's exit code was not recorded/],
    ['no OSV file', { osvText: null }, /wrote no output file/],
    ['an OSV file that is not JSON', { osvText: '<html>' }, /not JSON/],
    ['an OSV file with no packages', { osvText: '{"packages":[],"vulns":{}}' }, /no packages/],
    [
      'an OSV file whose advisory details are not a map',
      { osvText: JSON.stringify({ packages: [{ name: 'a:b', version: '1', scopes: ['compile'], ids: [] }], vulns: [] }) },
      /no advisory details/,
    ],
    [
      'an OSV file with no advisory details at all',
      { osvText: JSON.stringify({ packages: [{ name: 'a:b', version: '1', scopes: ['compile'], ids: [] }] }) },
      /no advisory details/,
    ],
    [
      'an advisory id with no details',
      { osvText: JSON.stringify({ packages: [{ name: 'a:b', version: '1', scopes: ['compile'], ids: ['GHSA-x'] }], vulns: {} }) },
      /GHSA-x .* details are missing/,
    ],
  ];
  for (const [name, overrides, expected] of broken) {
    test(`could not complete: ${name}`, () => {
      const r = backend(overrides);
      assert.equal(r.status, 'errored');
      assert.match(r.error, expected);
    });
  }

  test('a withdrawn advisory is not a finding', () => {
    const osvText = JSON.stringify({
      packages: [{ name: 'a:b', version: '1.0', scopes: ['compile'], ids: ['GHSA-w'] }],
      vulns: { 'GHSA-w': { id: 'GHSA-w', withdrawn: '2026-01-01T00:00:00Z', severity: 'HIGH', aliases: [], affected: [] } },
    });
    const r = backend({ osvText });
    assert.equal(r.status, 'ok');
    assert.equal(r.findings.length, 0);
  });
});

describe('the OSV client', () => {
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const pkgs = [
    { name: 'g:a', version: '1', scopes: ['compile'] },
    { name: 'g:b', version: '2', scopes: ['test'] },
  ];
  const record = (id) => ({ id, summary: id, aliases: [], database_specific: { severity: 'HIGH' }, affected: [] });

  test('follows next_page_token for the queries that have one, and fetches each advisory once', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init.body ? JSON.parse(init.body) : null]);
      if (url.endsWith('/v1/querybatch') && calls.length === 1) {
        return json({ results: [{ vulns: [{ id: 'GHSA-1' }], next_page_token: 'p2' }, { vulns: [{ id: 'GHSA-1' }] }] });
      }
      if (url.endsWith('/v1/querybatch')) return json({ results: [{ vulns: [{ id: 'GHSA-2' }] }] });
      return json(record(decodeURIComponent(url.split('/').pop())));
    };
    const out = await queryOsv(pkgs, { fetchImpl, sleep: async () => {} });
    assert.deepEqual(calls[1][1].queries, [{ package: { ecosystem: 'Maven', name: 'g:a' }, version: '1', page_token: 'p2' }]);
    assert.deepEqual(out.packages.map((p) => p.ids), [['GHSA-1', 'GHSA-2'], ['GHSA-1']]);
    assert.deepEqual(Object.keys(out.vulns).sort(), ['GHSA-1', 'GHSA-2']);
    assert.equal(calls.filter(([url]) => url.includes('/v1/vulns/')).length, 2);
  });

  test('a short answer from OSV is an error, not a partial result', async () => {
    const fetchImpl = async () => json({ results: [{}] });
    await assert.rejects(queryOsv(pkgs, { fetchImpl, sleep: async () => {} }), /answered 1 results for 2 queries/);
  });

  test('a 5xx is retried', async () => {
    let n = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/v1/querybatch')) return ++n < 3 ? json({ message: 'busy' }, 503) : json({ results: [{}, {}] });
      throw new Error('unexpected');
    };
    const out = await queryOsv(pkgs, { fetchImpl, sleep: async () => {} });
    assert.equal(n, 3);
    assert.deepEqual(Object.keys(out.vulns), []);
  });

  test('a 4xx is not retried', async () => {
    let n = 0;
    const fetchImpl = async () => (n++, json({ message: 'bad' }, 400));
    await assert.rejects(queryOsv(pkgs, { fetchImpl, sleep: async () => {} }), /HTTP 400/);
    assert.equal(n, 1);
  });

  test('a failure fetching one advisory fails the lookup, not only that advisory', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/v1/querybatch')) return json({ results: [{ vulns: [{ id: 'GHSA-1' }, { id: 'GHSA-2' }] }, {}] });
      if (url.endsWith('/GHSA-2')) return json({ message: 'not found' }, 404);
      return json(record('GHSA-1'));
    };
    await assert.rejects(queryOsv(pkgs, { fetchImpl, sleep: async () => {} }), /GET [^ ]+\/v1\/vulns\/GHSA-2 returned HTTP 404/);
  });

  test('an advisory that keeps failing with a 5xx is retried, then fails the lookup', async () => {
    let n = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/v1/querybatch')) return json({ results: [{ vulns: [{ id: 'GHSA-1' }] }, {}] });
      n++;
      return json({ message: 'busy' }, 502);
    };
    await assert.rejects(queryOsv(pkgs, { fetchImpl, sleep: async () => {} }), /\/v1\/vulns\/GHSA-1 returned HTTP 502/);
    assert.equal(n, 3);
  });

  test('more packages than one batch holds: split into batches, each answer kept with its own package', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `g:p${i}`, version: '1', scopes: ['compile'] }));
    const sizes = [];
    const fetchImpl = async (url, init) => {
      if (url.endsWith('/v1/querybatch')) {
        const { queries } = JSON.parse(init.body);
        sizes.push(queries.length);
        // Each package gets an advisory named after it, so a mix-up between batches would show.
        return json({ results: queries.map((q) => ({ vulns: [{ id: `GHSA-${q.package.name.slice(2)}` }] })) });
      }
      return json(record(decodeURIComponent(url.split('/').pop())));
    };
    const out = await queryOsv(many, { fetchImpl, sleep: async () => {}, batchSize: 2 });
    assert.deepEqual(sizes, [2, 2, 1]);
    assert.deepEqual(
      out.packages.map((p) => [p.name, p.ids]),
      many.map((p, i) => [p.name, [`GHSA-p${i}`]]),
    );
    assert.equal(Object.keys(out.vulns).length, 5);
  });

  test('a network failure names its cause after the last attempt', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    };
    await assert.rejects(queryOsv(pkgs, { fetchImpl, sleep: async () => {} }), /failed after 3 attempts: fetch failed \(connect ECONNREFUSED\)/);
  });
});

// -------------------------------------------------------------------------------------------------

describe('the floor', () => {
  const at = (severity, ships) => meetsFloor({ severity, ships });
  test('high or worse counts anywhere', () => {
    assert.equal(at('critical', false), true);
    assert.equal(at('high', false), true);
  });
  test('moderate counts only where it ships', () => {
    assert.equal(at('moderate', true), true);
    assert.equal(at('moderate', false), false);
  });
  test('low and info never count', () => {
    assert.equal(at('low', true), false);
    assert.equal(at('info', true), false);
  });
  test('an advisory with no severity counts as high', () => {
    assert.equal(normaliseSeverity(undefined), 'unrated');
    assert.equal(normaliseSeverity('MEDIUM'), 'moderate');
    assert.equal(at('unrated', false), true);
  });
});

const META = { generatedAt: '2026-10-14T05:23:00.000Z', ref: 'dev', sha: '670b24c0000000000000000000000000000000000', runUrl: null };

const resultsWithFindings = () =>
  buildResults(
    [backend(), npm(), analyseNpmAudit({ area: 'e2e', stdout: fixture('npm-clean.json'), exitCodeText: '0', lockfileText: '{"packages":{}}', ships: 'never' })],
    META,
  );

const cleanResults = () =>
  buildResults(
    [
      backend({ osvText: fixture('osv-clean.json') }),
      npm({ stdout: fixture('npm-clean.json'), exitCodeText: '0' }),
      analyseNpmAudit({ area: 'e2e', stdout: fixture('npm-clean.json'), exitCodeText: '0', lockfileText: '{"packages":{}}', ships: 'never' }),
    ],
    META,
  );

describe('merging and fingerprinting', () => {
  test('counts per area, and only findings at or above the floor are in the fingerprint', () => {
    const r = resultsWithFindings();
    assert.equal(r.errored, false);
    assert.deepEqual(
      r.areas.map((a) => [a.area, a.findingCount, a.actionableCount]),
      [
        ['backend', 23, 16],
        ['frontend', 15, 11],
        ['e2e', 0, 0],
      ],
    );
    assert.equal(r.actionableKeys.length, 27);
  });

  test('sorted by area, then worst first', () => {
    const r = resultsWithFindings();
    assert.equal(r.findings[0].area, 'backend');
    assert.equal(r.findings[0].severity, 'critical');
    const frontend = r.findings.filter((f) => f.area === 'frontend');
    assert.equal(frontend[0].package, 'minimist');
    assert.equal(frontend.at(-1).severity, 'low');
  });

  test('the fingerprint ignores order and changes with the set', () => {
    assert.equal(fingerprint(['b', 'a']), fingerprint(['a', 'b']));
    assert.notEqual(fingerprint(['a']), fingerprint(['a', 'b']));
  });

  test('a change below the floor does not change the fingerprint', () => {
    const r = resultsWithFindings();
    // body-parser's low advisory becomes info: the report changes, the issue's state must not.
    const stdout = fixture('npm-findings.json').replace('"severity": "low"', '"severity": "info"');
    assert.notEqual(stdout, fixture('npm-findings.json'));
    const changed = buildResults(
      [backend(), npm({ stdout }), analyseNpmAudit({ area: 'e2e', stdout: fixture('npm-clean.json'), exitCodeText: '0', lockfileText: '{"packages":{}}', ships: 'never' })],
      META,
    );
    assert.equal(changed.fingerprint.length, 16);
    assert.equal(changed.fingerprint, r.fingerprint);
  });

  test('an area with no result is an audit that could not complete', () => {
    const r = buildResults([backend()], META);
    assert.equal(r.errored, true);
    assert.equal(r.areas.find((a) => a.area === 'frontend').status, 'errored');
  });
});

describe('the report', () => {
  test('a summary table, a section per area, worst first, the floor in bold', () => {
    const md = renderReport(resultsWithFindings());
    assert.match(md, /^## Dependency audit/);
    assert.match(md, /Run of 2026-10-14 on `dev` at `670b24c`\./);
    assert.match(md, /\| Backend \| Maven graph, looked up in OSV \| 3 dependencies \| 23 \| 16 \|/);
    assert.match(md, /\| Frontend \| `npm audit` \| 31 packages \| 15 \| 11 \|/);
    assert.match(md, /### E2E\n\nNo published advisory affects these 803 packages\./);
    assert.match(
      md,
      /\| \*\*critical\*\* \| `org\.postgresql:postgresql` \| `42\.2\.0` \| \[GHSA-24rp-q3w6-vc56\]\(https:\/\/github\.com\/advisories\/GHSA-24rp-q3w6-vc56\) \(CVE-2024-1597\)<br>[^|]+\| `42\.2\.28` \| yes \(runtime\) \|/,
    );
    assert.match(md, /\| moderate \| `com\.fasterxml\.jackson\.core:jackson-databind` \| `2\.13\.0` \|[^\n]+\| no \(test\) \|/);
    const frontend = md.slice(md.indexOf('### Frontend'));
    assert.ok(frontend.indexOf('`minimist`') < frontend.indexOf('`lodash`'));
  });

  test('a failed audit is a warning, and its area says it was not checked', () => {
    const r = buildResults([backend({ mvnExitText: '1' }), npm(), npm({ area: 'e2e', ships: 'never' })], META);
    const md = renderReport(r);
    assert.match(md, /\| Backend \| [^|]+ \| \*\*could not complete\*\* \| — \| — \|/);
    assert.match(md, /> \[!WARNING\]\n> \*\*Backend: the audit could not complete\.\*\* Maven could not resolve/);
    assert.match(md, /### Backend\n\nNot checked/);
  });

  test("belowFloor: 'omit' lists only findings at or above the floor, and counts the rest", () => {
    const r = resultsWithFindings();
    const full = renderReport(r);
    const omitted = renderReport(r, { belowFloor: 'omit' });
    const jackson = /\| moderate \| `com\.fasterxml\.jackson\.core:jackson-databind` \|/;
    assert.match(full, jackson);
    assert.doesNotMatch(full, /below the floor are not listed/);
    assert.doesNotMatch(omitted, jackson);
    const backendPart = omitted.slice(omitted.indexOf('### Backend'), omitted.indexOf('### Frontend'));
    const frontendPart = omitted.slice(omitted.indexOf('### Frontend'), omitted.indexOf('### E2E'));
    assert.match(backendPart, /\n7 finding\(s\) below the floor are not listed here; the workflow run's summary has them\./);
    assert.match(frontendPart, /\n4 finding\(s\) below the floor are not listed here/);
    assert.equal(backendPart.split('\n').filter((l) => l.startsWith('| **')).length, 16);
    assert.equal(frontendPart.split('\n').filter((l) => l.startsWith('| **')).length, 11);
  });

  test('third-party text cannot break the table, mention anyone, or link an issue', () => {
    const r = resultsWithFindings();
    r.findings[0] = { ...r.findings[0], title: 'pipes | and <b>tags</b>, @types/node and #12' };
    const row = renderReport(r).split('\n').find((l) => l.includes('pipes'));
    assert.match(row, /pipes \\\| and &lt;b&gt;tags&lt;\/b&gt;/);
    assert.match(row, /@​types\/node and #​12/);
  });
});

describe('the tracking issue', () => {
  const issueFrom = (number, state, results) => ({
    number,
    state,
    body: `x\n${encodeState({ v: 1, fingerprint: results.fingerprint, keys: results.actionableKeys })}`,
  });

  test('findings and no issue: open one, with area labels, the milestone and the state', () => {
    const r = resultsWithFindings();
    const plan = planIssue({ results: r, issues: [] });
    assert.equal(plan.action, 'create');
    assert.equal(plan.title, issueTitle());
    assert.match(plan.title, /^\[Phase 8\] /);
    assert.deepEqual(plan.labels.sort(), ['backend', 'frontend']);
    assert.equal(plan.milestone, ISSUE.milestone);
    assert.deepEqual(parseState(plan.body), { v: 1, fingerprint: r.fingerprint, keys: r.actionableKeys });
  });

  test('e2e findings are labelled infra', () => {
    const r = buildResults([backend({ osvText: fixture('osv-clean.json') }), npm({ stdout: fixture('npm-clean.json'), exitCodeText: '0' }), npm({ area: 'e2e', ships: 'never' })], META);
    assert.deepEqual(planIssue({ results: r, issues: [] }).labels, ['infra']);
  });

  test('clean and no issue: nothing', () => {
    assert.equal(planIssue({ results: cleanResults(), issues: [] }).action, 'none');
  });

  test('an open issue with the same findings: nothing, which is what keeps it from being weekly', () => {
    const r = resultsWithFindings();
    const plan = planIssue({ results: r, issues: [issueFrom(300, 'open', r)] });
    assert.equal(plan.action, 'none');
    assert.match(plan.reason, /#300 already shows/);
  });

  test('an open issue with different findings: comment on what changed, and rewrite the body', () => {
    const r = resultsWithFindings();
    const added = 'backend|org.postgresql:postgresql|42.2.0|GHSA-24rp-q3w6-vc56';
    assert.ok(r.actionableKeys.includes(added));
    const before = { ...r, actionableKeys: [...r.actionableKeys.filter((k) => k !== added), 'frontend|gone|1.0.0|GHSA-gone-gone-gone'] };
    before.fingerprint = fingerprint(before.actionableKeys);
    const plan = planIssue({ results: r, issues: [issueFrom(300, 'open', before)] });
    assert.equal(plan.action, 'update');
    assert.equal(plan.number, 300);
    assert.match(plan.comment, /New at or above the floor \(1\):\n- \*\*critical\*\* · Backend · `org\.postgresql:postgresql`/);
    assert.match(plan.comment, /No longer reported \(1\):\n- Frontend · `gone` `1\.0\.0` · \[GHSA-gone-gone-gone\]/);
    assert.equal(parseState(plan.body).fingerprint, r.fingerprint);
    assert.deepEqual(plan.addLabels.sort(), ['backend', 'frontend']);
  });

  test('an open issue, now clean: say so once, leave it open, and stay quiet the week after', () => {
    const findings = resultsWithFindings();
    const clean = cleanResults();
    const plan = planIssue({ results: clean, issues: [issueFrom(300, 'open', findings)] });
    assert.equal(plan.action, 'update');
    assert.match(plan.comment, /^\*\*Clean as of 2026-10-14:\*\*/);
    assert.match(plan.comment, /Leaving this open/);
    const nextWeek = planIssue({ results: clean, issues: [{ number: 300, state: 'open', body: plan.body }] });
    assert.equal(nextWeek.action, 'none');
  });

  test('a closed issue with the same findings is not refiled', () => {
    const r = resultsWithFindings();
    const plan = planIssue({ results: r, issues: [issueFrom(300, 'closed', r)] });
    assert.equal(plan.action, 'none');
    assert.match(plan.reason, /All 27 finding\(s\) at or above the floor were in audit issue\(s\) a person closed \(#300\)/);
  });

  test('a closed issue with different findings: open a new one that points back', () => {
    const r = resultsWithFindings();
    const plan = planIssue({ results: r, issues: [issueFrom(300, 'closed', cleanResults())] });
    assert.equal(plan.action, 'create');
    assert.match(plan.body, /The previous set of findings was in #300\./);
  });

  /** `r` with only `findings`, and the keys and fingerprint recomputed as buildResults would. */
  const withFindings = (r, findings) => {
    const actionableKeys = findings.filter((f) => f.atFloor).map(findingKey).sort();
    return { ...r, findings, actionableKeys, fingerprint: fingerprint(actionableKeys) };
  };
  const closedWith = (number, keys) => ({ number, state: 'closed', body: `x\n${encodeState({ v: 1, fingerprint: fingerprint(keys), keys })}` });

  test('review probe 1: a shrunk set, with the original closed, is not refiled', () => {
    const r = resultsWithFindings();
    const dropped = r.findings.find((f) => f.atFloor);
    const shrunk = withFindings(r, r.findings.filter((f) => f !== dropped));
    assert.notEqual(shrunk.fingerprint, r.fingerprint);
    const plan = planIssue({ results: shrunk, issues: [issueFrom(300, 'closed', r)] });
    assert.equal(plan.action, 'none');
    assert.match(plan.reason, /All 26 finding\(s\)/);
  });

  test('review probe 2: two different closed sets that cover the findings between them are not refiled', () => {
    const r = resultsWithFindings();
    const half = Math.floor(r.actionableKeys.length / 2);
    const issues = [closedWith(300, r.actionableKeys.slice(0, half)), closedWith(310, r.actionableKeys.slice(half))];
    const plan = planIssue({ results: r, issues });
    assert.equal(plan.action, 'none');
    assert.match(plan.reason, /\(#310, #300\)/);
  });

  test('a new version of an accepted advisory is not new information', () => {
    const r = resultsWithFindings();
    const bumped = withFindings(
      r,
      r.findings.map((f) => (f.package === 'org.postgresql:postgresql' ? { ...f, version: '42.2.1' } : f)),
    );
    assert.notEqual(bumped.fingerprint, r.fingerprint);
    assert.equal(planIssue({ results: bumped, issues: [issueFrom(300, 'closed', r)] }).action, 'none');
  });

  test('one advisory in no closed issue opens a new issue, listing everything, pointing to the newest closed one', () => {
    const r = resultsWithFindings();
    const fresh = { ...r.findings.find((f) => f.atFloor), id: 'GHSA-new0-new0-new0', url: 'https://github.com/advisories/GHSA-new0-new0-new0' };
    const grown = withFindings(r, [...r.findings, fresh]);
    const half = Math.floor(r.actionableKeys.length / 2);
    const issues = [closedWith(300, r.actionableKeys.slice(0, half)), closedWith(310, r.actionableKeys.slice(half))];
    const plan = planIssue({ results: grown, issues });
    assert.equal(plan.action, 'create');
    assert.match(plan.body, /The previous set of findings was in #310\./);
    assert.match(plan.body, /GHSA-new0-new0-new0/);
    assert.match(plan.body, /GHSA-24rp-q3w6-vc56/);
  });

  test('a closed issue whose state cannot be read accepts nothing', () => {
    const r = resultsWithFindings();
    const plan = planIssue({ results: r, issues: [{ number: 300, state: 'closed', body: 'edited by hand' }] });
    assert.equal(plan.action, 'create');
  });

  test('an unreadable state is treated as changed, and says so', () => {
    const plan = planIssue({ results: resultsWithFindings(), issues: [{ number: 300, state: 'open', body: 'edited by hand' }] });
    assert.equal(plan.action, 'update');
    assert.match(plan.comment, /previous state could not be read/);
  });

  test('with two open issues, only the newest is updated, and that is noted', () => {
    const r = resultsWithFindings();
    const plan = planIssue({ results: r, issues: [issueFrom(300, 'open', cleanResults()), issueFrom(310, 'open', cleanResults())] });
    assert.equal(plan.number, 310);
    assert.match(plan.notes[0], /2 open issues/);
  });

  test('never plans from a run in which an audit could not complete', () => {
    const r = buildResults([backend({ mvnExitText: '1' }), npm(), npm({ area: 'e2e', ships: 'never' })], META);
    assert.throws(() => planIssue({ results: r, issues: [] }), /an audit could not complete/);
  });

  test('too long only because of findings below the floor: those are counted, not listed, and nothing is cut', () => {
    const r = resultsWithFindings();
    const low = Array.from({ length: 500 }, (_, i) => ({
      ...r.findings.find((f) => f.area === 'frontend'),
      id: `GHSA-low${String(i).padStart(3, '0')}-xxxx-xxxx`,
      severity: 'low',
      atFloor: false,
      title: 'y'.repeat(150),
    }));
    const big = { ...r, findings: [...r.findings, ...low] };
    assert.ok(renderReport(big).length > 60000, 'the full report must not fit, or this tests nothing');
    const plan = planIssue({ results: big, issues: [] });
    assert.ok(plan.body.length <= 60000, `body is ${plan.body.length} characters`);
    assert.doesNotMatch(plan.body, /Truncated to fit an issue/);
    assert.match(plan.body, /finding\(s\) below the floor are not listed here/);
    assert.doesNotMatch(plan.body, /GHSA-low000/);
    assert.equal(parseState(plan.body).fingerprint, r.fingerprint);
  });

  /** `count` findings at or above the floor, each with a long title. */
  const manyFindings = (count) => {
    const r = resultsWithFindings();
    const many = Array.from({ length: count }, (_, i) => ({ ...r.findings[0], id: `GHSA-${String(i).padStart(4, '0')}-xxxx-xxxx`, title: 'x'.repeat(150) }));
    return withFindings(r, many);
  };

  // 200 keeps every key; 800 and 3000 are past the cliff before the marker was capped, which for
  // these keys was between 700 findings (a 59,858-character body) and 760 (271,648).
  for (const count of [200, 800, 3000]) {
    test(`a report of ${count} findings still fits an issue, and the fingerprint survives`, () => {
      const big = manyFindings(count);
      const plan = planIssue({ results: big, issues: [] });
      assert.ok(plan.body.length <= 60000, `body is ${plan.body.length} characters`);
      assert.match(plan.body, /Truncated to fit an issue/);
      assert.match(plan.body, /\| \*\*critical\*\* \|/, 'some findings are still listed');
      const state = parseState(plan.body);
      assert.equal(state.fingerprint, big.fingerprint);
      if (count === 200) {
        assert.equal(state.complete, undefined);
        assert.equal(state.keys.length, 200);
      } else {
        // The keys no longer all fit under the marker's cap; the state says so instead of overflowing.
        assert.equal(state.complete, false);
        assert.equal(state.total, count);
        assert.ok(state.keys.length > 100 && state.keys.length < count, `${state.keys.length} keys kept`);
        assert.deepEqual(state.keys, big.actionableKeys.slice(0, state.keys.length));
      }
      // Next week, the same findings are recognised from the fingerprint alone: nothing to write.
      assert.equal(planIssue({ results: big, issues: [{ number: 300, state: 'open', body: plan.body }] }).action, 'none');
    });
  }

  test('after a state that recorded only some keys, the change comment says it cannot list the change', () => {
    const big = manyFindings(3000);
    const body = planIssue({ results: big, issues: [] }).body;
    const plan = planIssue({ results: resultsWithFindings(), issues: [{ number: 300, state: 'open', body }] });
    assert.equal(plan.action, 'update');
    assert.match(plan.comment, /previous state recorded only \d+ of its 3000 findings, so what changed could not be listed/);
    assert.doesNotMatch(plan.comment, /No longer reported/);
  });

  test('a closed issue that recorded only some keys accepts only those', () => {
    const big = manyFindings(3000);
    const body = planIssue({ results: big, issues: [] }).body;
    const plan = planIssue({ results: big, issues: [{ number: 300, state: 'closed', body }] });
    assert.equal(plan.action, 'create');
  });
});

// -------------------------------------------------------------------------------------------------

describe('report.mjs, run as the workflow runs it', () => {
  const script = fileURLToPath(new URL('./report.mjs', import.meta.url));

  /** A directory laid out as the workflow's collect steps leave it, plus a repo root with lockfiles. */
  function layout({ frontend = ['npm-findings.json', '1'], e2e = ['npm-clean.json', '0'], mvnExit = '0', osv = 'osv-findings.json' } = {}) {
    const base = mkdtempSync(path.join(tmpdir(), 'dependency-audit-test-'));
    const dir = path.join(base, 'out');
    const root = path.join(base, 'repo');
    for (const d of [dir, path.join(root, 'frontend'), path.join(root, 'e2e')]) mkdirSync(d, { recursive: true });
    const put = (name, [stdoutFixture, exit]) => {
      if (stdoutFixture) copyFileSync(new URL(`./fixtures/${stdoutFixture}`, import.meta.url), path.join(dir, `${name}.npm-audit.json`));
      if (exit !== null) writeFileSync(path.join(dir, `${name}.npm-audit.exit`), `${exit}\n`);
    };
    if (frontend) put('frontend', frontend);
    if (e2e) put('e2e', e2e);
    if (mvnExit !== null) writeFileSync(path.join(dir, 'backend.mvn.exit'), `${mvnExit}\n`);
    if (osv) copyFileSync(new URL(`./fixtures/${osv}`, import.meta.url), path.join(dir, 'backend.osv.json'));
    writeFileSync(path.join(root, 'frontend', 'package-lock.json'), FRONTEND_LOCK);
    writeFileSync(path.join(root, 'e2e', 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
    return { base, dir, root };
  }

  function run(paths) {
    const summary = path.join(paths.base, 'summary.md');
    const results = path.join(paths.base, 'results.json');
    const out = spawnSync(process.execPath, [script, '--dir', paths.dir, '--root', paths.root, '--summary', summary, '--results', results, '--ref', 'dev', '--sha', 'abcdef0123'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_SERVER_URL: '', GITHUB_RUN_ID: '' },
    });
    const read = (f) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return null;
      }
    };
    return { status: out.status, stdout: out.stdout, summary: read(summary), results: JSON.parse(read(results) ?? 'null') };
  }

  test('findings: exit 0, the summary is written, the results say what was found', () => {
    const paths = layout();
    try {
      const r = run(paths);
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.summary, /^## Dependency audit/);
      assert.equal(r.results.errored, false);
      assert.equal(r.results.actionableKeys.length, 27);
      assert.doesNotMatch(r.stdout, /::error/);
    } finally {
      rmSync(paths.base, { recursive: true, force: true });
    }
  });

  test('an npm audit that errored with the same exit code 1: exit 1, an annotation, and the summary is still written', () => {
    const paths = layout({ e2e: ['npm-error.json', '1'] });
    try {
      const r = run(paths);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /::error title=E2E audit could not complete::npm audit could not complete \(exit 1\)/);
      assert.match(r.summary, /\*\*E2E: the audit could not complete\.\*\*/);
      assert.equal(r.results.errored, true);
      assert.equal(r.results.areas.find((a) => a.area === 'frontend').findingCount, 15);
    } finally {
      rmSync(paths.base, { recursive: true, force: true });
    }
  });

  test('a Maven failure: exit 1', () => {
    const paths = layout({ mvnExit: '1', osv: 'osv-error.json' });
    try {
      const r = run(paths);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /::error title=Backend audit could not complete::Maven could not resolve/);
    } finally {
      rmSync(paths.base, { recursive: true, force: true });
    }
  });

  test('nothing written at all: exit 1, never a clean report', () => {
    const paths = layout({ frontend: null, e2e: null, mvnExit: null, osv: null });
    try {
      const r = run(paths);
      assert.equal(r.status, 1);
      assert.equal(r.results.areas.filter((a) => a.status === 'errored').length, 3);
    } finally {
      rmSync(paths.base, { recursive: true, force: true });
    }
  });

  test('all clean: exit 0, and nothing at or above the floor', () => {
    const paths = layout({ frontend: ['npm-clean.json', '0'], osv: 'osv-clean.json' });
    try {
      const r = run(paths);
      assert.equal(r.status, 0);
      assert.deepEqual(r.results.actionableKeys, []);
    } finally {
      rmSync(paths.base, { recursive: true, force: true });
    }
  });
});

describe('issue.mjs', () => {
  const onDev = { ref: 'refs/heads/dev', defaultBranch: 'dev' };

  test('writes only on schedule and workflow_dispatch', () => {
    assert.doesNotThrow(() => assertWriteAllowed({ event: 'schedule', ...onDev }));
    assert.doesNotThrow(() => assertWriteAllowed({ event: 'workflow_dispatch', ...onDev }));
    assert.throws(() => assertWriteAllowed({ event: 'pull_request', ...onDev }), /Refusing to write: .* a pull_request run/);
    assert.throws(() => assertWriteAllowed({ event: 'pull_request_target', ...onDev }), /Refusing to write/);
    assert.throws(() => assertWriteAllowed({ ...onDev }), /not a workflow run/);
  });

  test('writes only from the default branch', () => {
    const feature = { ref: 'refs/heads/feat/x', defaultBranch: 'dev' };
    assert.throws(() => assertWriteAllowed({ event: 'workflow_dispatch', ...feature }), /only from the default branch, refs\/heads\/dev, and this workflow_dispatch run is on refs\/heads\/feat\/x/);
    assert.throws(() => assertWriteAllowed({ event: 'schedule', ...feature }), /only from the default branch/);
    assert.throws(() => assertWriteAllowed({ event: 'workflow_dispatch', ref: 'refs/tags/v1', defaultBranch: 'dev' }), /only from the default branch/);
    // A branch named like the default one, under it, is not it.
    assert.throws(() => assertWriteAllowed({ event: 'workflow_dispatch', ref: 'refs/heads/dev/x', defaultBranch: 'dev' }), /only from the default branch/);
  });

  test("a schedule's event has no repository to name the default branch: allowed there, refused elsewhere", () => {
    assert.doesNotThrow(() => assertWriteAllowed({ event: 'schedule', ref: 'refs/heads/dev', defaultBranch: '' }));
    assert.throws(() => assertWriteAllowed({ event: 'workflow_dispatch', ref: 'refs/heads/dev', defaultBranch: '' }), /default branch is unknown/);
  });

  const issueScript = fileURLToPath(new URL('./issue.mjs', import.meta.url));
  const runIssue = (env) =>
    spawnSync(process.execPath, [issueScript, '--results', 'unused.json', '--repo', 'o/r', '--write'], {
      encoding: 'utf8',
      // PATH is emptied so that if the gate did not hold, gh could not be found either.
      env: { ...process.env, GITHUB_EVENT_NAME: '', GITHUB_REF: '', DEFAULT_BRANCH: '', ...env, PATH: '' },
    });

  test('--write from a pull_request run refuses before calling GitHub', () => {
    const out = runIssue({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge', DEFAULT_BRANCH: 'dev' });
    assert.equal(out.status, 1);
    assert.match(out.stderr, /::error title=Dependency audit issue::Refusing to write/);
  });

  test('--write from a dispatch on a branch that is not the default refuses before calling GitHub', () => {
    const out = runIssue({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feat/x', DEFAULT_BRANCH: 'dev' });
    assert.equal(out.status, 1);
    assert.match(out.stderr, /::error title=Dependency audit issue::Refusing to write: the issue is filed only from the default branch/);
  });

  /** A fake `gh`: answers from a table of handlers, and records every call. */
  function fakeGh({ milestones = [{ number: 10, title: 'Phase 8', state: 'open' }], labels = ['backend', 'frontend', 'infra'], issues = [], fail = [] } = {}) {
    const calls = [];
    const run = async (args) => {
      const bodyIndex = args.indexOf('--body-file');
      calls.push({ args, body: bodyIndex === -1 ? null : readFileSync(args[bodyIndex + 1], 'utf8') });
      const command = args.slice(0, 2).join(' ');
      if (fail.includes(command)) throw new Error(`gh ${command} failed: HTTP 422`);
      const target = args.find((a) => a.startsWith('repos/')) ?? '';
      if (target.includes('/milestones')) return milestones.map((m) => JSON.stringify(m)).join('\n');
      if (target.includes('/labels/')) {
        const name = decodeURIComponent(target.split('/').pop());
        if (labels.includes(name)) return `${name}\n`;
        throw new Error('gh api repos/o/r/labels failed: gh: Not Found (HTTP 404)');
      }
      if (target.endsWith('/issues')) return issues.map((i) => JSON.stringify(i)).join('\n');
      if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/400\n';
      return '';
    };
    return { gh: createGh('o/r', run), calls };
  }

  test('preflight passes with an open Phase 8 milestone and the three labels', async () => {
    await preflight(fakeGh().gh);
  });

  test('preflight fails with a clear message when the milestone is gone or closed', async () => {
    await assert.rejects(preflight(fakeGh({ milestones: [{ number: 9, title: 'Meta', state: 'open' }] }).gh), /"Phase 8" does not exist.*Set ISSUE\.milestone/);
    await assert.rejects(preflight(fakeGh({ milestones: [{ number: 10, title: 'Phase 8', state: 'closed' }] }).gh), /"Phase 8" is closed/);
  });

  test('preflight fails when an area label is missing', async () => {
    await assert.rejects(preflight(fakeGh({ labels: ['backend', 'frontend'] }).gh), /label\(s\) infra do not exist/);
  });

  test("only the bot's own issues with the marker are candidates", async () => {
    const marked = `x\n${encodeState({ v: 1, fingerprint: 'f', keys: [] })}`;
    const { gh, calls } = fakeGh({
      issues: [
        { number: 1, state: 'open', body: marked, author: ISSUE.bot },
        { number: 2, state: 'open', body: marked, author: 'someone' },
        { number: 3, state: 'open', body: 'no marker', author: ISSUE.bot },
        { number: 4, state: 'closed', body: null, author: ISSUE.bot },
      ],
    });
    assert.deepEqual((await gh.auditIssues()).map((i) => i.number), [1]);
    assert.ok(calls[0].args.includes(`creator=${ISSUE.bot}`));
  });

  test('create passes the title, body, each label and the milestone by title', async () => {
    const { gh, calls } = fakeGh();
    const plan = planIssue({ results: resultsWithFindings(), issues: [] });
    assert.equal(await applyPlan(gh, plan), 'https://github.com/o/r/issues/400');
    const { args, body } = calls[0];
    assert.deepEqual(args.slice(0, 6), ['issue', 'create', '--repo', 'o/r', '--title', issueTitle()]);
    assert.ok(args.join(' ').includes('--label backend --label frontend --milestone Phase 8'));
    assert.equal(body, plan.body);
  });

  test('update rewrites the body and adds labels first, then comments', async () => {
    const { gh, calls } = fakeGh();
    const plan = planIssue({ results: resultsWithFindings(), issues: [{ number: 300, state: 'open', body: 'edited by hand' }] });
    assert.equal(await applyPlan(gh, plan), '#300');
    assert.deepEqual(calls.map((c) => c.args.slice(0, 3).join(' ')), ['issue edit 300', 'issue comment 300']);
    assert.equal(calls[0].body, plan.body);
    assert.ok(calls[0].args.join(' ').includes('--add-label backend --add-label frontend'));
    assert.equal(calls[1].body, plan.comment);
  });

  test('an edit that fails posts no comment, so a failure every week cannot repeat one every week', async () => {
    const { gh, calls } = fakeGh({ fail: ['issue edit'] });
    const plan = planIssue({ results: resultsWithFindings(), issues: [{ number: 300, state: 'open', body: 'edited by hand' }] });
    await assert.rejects(applyPlan(gh, plan), /gh issue edit failed/);
    assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(' ')), ['issue edit']);
  });

  test('a comment that fails after the edit says it is lost, and carries it for posting by hand', async () => {
    const { gh } = fakeGh({ fail: ['issue comment'] });
    const plan = planIssue({ results: resultsWithFindings(), issues: [{ number: 300, state: 'open', body: 'edited by hand' }] });
    await assert.rejects(applyPlan(gh, plan), (error) => {
      assert.match(error.message, /#300's body was updated, but the comment saying what changed was not posted/);
      assert.equal(error.unpostedComment, plan.comment);
      return true;
    });
  });

  test('nothing to do calls nothing', async () => {
    const { gh, calls } = fakeGh();
    assert.equal(await applyPlan(gh, { action: 'none', reason: '', notes: [] }), null);
    assert.equal(calls.length, 0);
  });
});
