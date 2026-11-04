/**
 * The logic of the weekly dependency audit (#273, .github/workflows/dependency-audit.yml).
 *
 * Parses each audit's output, decides whether an audit *found* something or *could not complete*,
 * merges the three areas, fingerprints the result, renders the report, and plans what to do with
 * the tracking issue. Pure functions only: no network, no filesystem, no child processes. The CLIs
 * beside this file (osv-query.mjs, report.mjs, issue.mjs) do the I/O and call in here, so every
 * decision below is covered by dependency-audit.test.mjs on fixtures.
 *
 * Node standard library only, like content-seed/: nothing to install, and no third-party code runs
 * in a workflow that holds `issues: write`.
 */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/**
 * The three dependency trees, in report order.
 *
 * `issueLabel` follows the repository's area-only label set. E2E maps to `infra` because the suite
 * is test tooling, never deployed.
 *
 * `ships` says how to tell whether an npm finding reaches production: `lockfile` reads each
 * package's `dev` flag, so a runtime dependency (bundled into the site) ships and a build or test
 * tool does not; `never` is for e2e/, which is never deployed at all. The backend uses Maven's
 * scope instead: everything except `test` is in the jar.
 */
export const AREAS = [
  { id: 'backend', label: 'Backend', tool: 'Maven graph, looked up in OSV', unit: 'dependencies', issueLabel: 'backend' },
  { id: 'frontend', label: 'Frontend', tool: '`npm audit`', unit: 'packages', issueLabel: 'frontend', ships: 'lockfile' },
  { id: 'e2e', label: 'E2E', tool: '`npm audit`', unit: 'packages', issueLabel: 'infra', ships: 'never' },
];

export const areaDef = (id) => AREAS.find((a) => a.id === id);

/**
 * Where the tracking issue goes. Looked up by title, not number, because milestone numbers here do
 * not match phase numbers. When the project moves past Phase 8, change it here; issue.mjs fails
 * the run with a message saying so if the milestone is closed or gone, rather than file an issue
 * without one.
 */
export const ISSUE = {
  milestone: 'Phase 8',
  marker: 'dependency-audit:state',
  // The account GITHUB_TOKEN acts as. Only issues it opened are candidates, so an issue anyone
  // else opens with a copied marker is never edited by the workflow.
  bot: 'github-actions[bot]',
};

export const issueTitle = () =>
  `[${ISSUE.milestone}] Dependency audit: published advisories affect this project's dependencies`;

// ---------------------------------------------------------------------------------------------
// Severity and the floor
// ---------------------------------------------------------------------------------------------

/**
 * Worst first. `unrated` is an advisory that carries no severity; it sorts and counts as high, so
 * a missing rating can never be the reason something is filtered out.
 */
export const SEVERITY_ORDER = ['critical', 'high', 'unrated', 'moderate', 'low', 'info'];

const rank = (severity) => {
  const i = SEVERITY_ORDER.indexOf(severity);
  return i === -1 ? SEVERITY_ORDER.indexOf('unrated') : i;
};

export function normaliseSeverity(raw) {
  if (typeof raw !== 'string') return 'unrated';
  const s = raw.trim().toLowerCase();
  if (s === 'medium') return 'moderate';
  return SEVERITY_ORDER.includes(s) ? s : 'unrated';
}

/**
 * The floor for opening or updating the issue. Everything is still in the run summary; the floor
 * only decides what is worth a notification.
 *
 * High or worse anywhere: every advisory this project has filed by hand so far (#244, #265, #267,
 * #272) was high or critical, including the dev-tooling ones, and dev tooling runs in CI and in the
 * deploy pipelines. Moderate counts only in something that ships, such as markdown-it in the
 * browser bundle or anything in the jar: a moderate XSS there is real, while moderate advisories
 * in build tools are the commonest npm finding and would make the issue weekly noise. Low and
 * info never open an issue.
 */
export const FLOOR_TEXT =
  '**high** or worse in any dependency, or **moderate** or worse in one that ships. An advisory with no severity counts as high.';

export function meetsFloor(finding) {
  const r = rank(finding.severity);
  if (r <= rank('unrated')) return true;
  return finding.ships === true && r <= rank('moderate');
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * A UTF-8 byte-order mark is not JSON, and some Windows shells write one: PowerShell's `>` does when
 * its output encoding has been set to UTF-8. Bash's `>`, which the workflow uses, never does. Stock
 * Windows PowerShell 5.1 writes UTF-16LE instead, which nothing here decodes: that output reads as
 * unreadable and the audit fails closed, never as a clean result (tested).
 */
const stripBom = (text) => text.replace(/^\uFEFF/, '');

export function parseJson(text) {
  return JSON.parse(stripBom(text));
}

/** An exit code as the workflow recorded it (`echo $? > file`), or null if absent or garbled. */
export function parseExitCode(text) {
  if (text == null) return null;
  const t = stripBom(text).trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

const excerpt = (text, max = 200) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return JSON.stringify(flat.length > max ? `${flat.slice(0, max)}…` : flat);
};

const errored = (area, error) => ({ area, status: 'errored', error, checked: null, findings: [] });
const ok = (area, findings, checked) => ({ area, status: 'ok', error: null, checked, findings });

/** True when `metaUrl` is the module Node was started with, so a CLI can also be imported. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(metaUrl);
  const started = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

export function advisoryUrl(id) {
  return /^GHSA-/i.test(id) ? `https://github.com/advisories/${id}` : `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------------------------
// npm: semver, just enough for advisory ranges
// ---------------------------------------------------------------------------------------------

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v).trim());
  if (!m) return null;
  return { nums: [BigInt(m[1]), BigInt(m[2]), BigInt(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0 or 1; null if either side is not a full semver version. */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  }
  if (!x.pre.length || !y.pre.length) {
    if (x.pre.length === y.pre.length) return 0;
    return x.pre.length ? -1 : 1; // a prerelease sorts before its release
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (BigInt(p) !== BigInt(q)) return BigInt(p) < BigInt(q) ? -1 : 1;
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

/** One `||` alternative of an advisory range, as comparators; [] for "any"; null if unreadable. */
function parseComparators(alternative) {
  const s = alternative.trim().replace(/(<=|>=|<|>|=)\s+/g, '$1');
  if (s === '' || s === '*') return [];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(s);
  if (hyphen) {
    if (!parseSemver(hyphen[1]) || !parseSemver(hyphen[2])) return null;
    return [{ op: '>=', v: hyphen[1] }, { op: '<=', v: hyphen[2] }];
  }
  const out = [];
  for (const token of s.split(/\s+/)) {
    const m = /^(<=|>=|<|>|=)?(.+)$/.exec(token);
    if (!m || !parseSemver(m[2])) return null;
    out.push({ op: m[1] ?? '=', v: m[2] });
  }
  return out;
}

function satisfiesAll(version, comparators) {
  return comparators.every(({ op, v }) => {
    const c = compareSemver(version, v);
    return { '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0, '=': c === 0 }[op];
  });
}

/** Whether `version` is inside an advisory's range: true, false, or null when either is unreadable. */
export function satisfiesRange(version, range) {
  if (typeof range !== 'string' || !parseSemver(version)) return null;
  for (const alternative of range.split('||')) {
    const comparators = parseComparators(alternative);
    if (!comparators) return null;
    if (satisfiesAll(version, comparators)) return true;
  }
  return false;
}

/**
 * The fixed version an npm advisory implies for `version`, from the upper bound of the range
 * alternative that contains it: `<X` means X fixes it, `<=X` means only a later version can, and no
 * upper bound means no fix is published. npm's report does not state a fixed version itself.
 */
export function npmFixedIn(range, version) {
  if (typeof range !== 'string' || !parseSemver(version)) return null;
  for (const alternative of range.split('||')) {
    const comparators = parseComparators(alternative);
    if (!comparators) return null;
    if (!satisfiesAll(version, comparators)) continue;
    const upper = comparators.find((c) => c.op === '<' || c.op === '<=');
    if (!upper) return null;
    return upper.op === '<' ? upper.v : `> ${upper.v}`;
  }
  return null;
}

function npmFixNote(fixAvailable, name) {
  if (fixAvailable === false) return 'npm audit fix cannot fix this';
  if (!isPlainObject(fixAvailable)) return null;
  const major = fixAvailable.isSemVerMajor ? ', a semver-major change' : '';
  if (fixAvailable.name === name) return major ? `npm audit fix${major}` : null;
  return `through ${fixAvailable.name} ${fixAvailable.version}${major}`;
}

// ---------------------------------------------------------------------------------------------
// npm audit: found versus could not complete
// ---------------------------------------------------------------------------------------------

/**
 * Turns one `npm audit --json --package-lock-only` run into an area result.
 *
 * `npm audit` exits 1 both when it finds something and when it fails, so the exit code alone
 * cannot tell those apart. The JSON can: a failure prints `{ message, error: { summary, detail } }`
 * (see fixtures/npm-error.json, from a real unreachable registry), while a report has
 * `auditReportVersion: 2` and a `vulnerabilities` map. Anything that is neither, or that
 * contradicts its own exit code, is treated as a failed audit: an audit that silently reads as
 * clean is the failure this workflow exists to prevent.
 *
 * @param {object} input
 * @param {string} input.area           'frontend' or 'e2e'
 * @param {string|null} input.stdout    npm's stdout, or null if the file was never written
 * @param {string|null} input.exitCodeText
 * @param {string|null} input.lockfileText  the package-lock.json that was audited
 * @param {'lockfile'|'never'} input.ships
 */
export function analyseNpmAudit({ area, stdout, exitCodeText, lockfileText, ships }) {
  const exitCode = parseExitCode(exitCodeText);
  if (stdout == null) {
    return errored(area, 'npm audit wrote no output file: the step did not run, or failed before npm started.');
  }
  if (exitCode == null) return errored(area, "npm audit's exit code was not recorded.");
  if (stdout.trim() === '' || stripBom(stdout).trim() === '') {
    return errored(area, `npm audit wrote nothing to stdout (exit ${exitCode}). Its stderr is in the step's log.`);
  }

  let report;
  try {
    report = parseJson(stdout);
  } catch {
    return errored(area, `npm audit's output is not JSON (exit ${exitCode}): ${excerpt(stdout)}`);
  }
  if (!isPlainObject(report)) return errored(area, `npm audit's output is not a JSON object: ${excerpt(stdout)}`);

  if (report.error !== undefined || (report.message !== undefined && report.auditReportVersion === undefined)) {
    const parts = [report.message, report.error?.code, report.error?.summary, report.error?.detail].filter(nonEmpty);
    return errored(area, `npm audit could not complete (exit ${exitCode}): ${parts.join(' / ') || 'it gave no message'}`);
  }
  if (report.auditReportVersion !== 2 || !isPlainObject(report.vulnerabilities)) {
    return errored(
      area,
      `npm audit's output is not a version 2 audit report (auditReportVersion is ${JSON.stringify(report.auditReportVersion)}). ` +
        'This script reads version 2; npm may have changed its format.',
    );
  }

  const entries = Object.entries(report.vulnerabilities);
  if (exitCode > 1) {
    return errored(area, `npm audit exited ${exitCode}, which is neither 0 (clean) nor 1 (found something).`);
  }
  if (exitCode !== 0 && entries.length === 0) {
    return errored(area, `npm audit exited ${exitCode} but reported no vulnerabilities, so its report cannot be trusted.`);
  }

  let lockfile;
  try {
    lockfile = parseJson(lockfileText ?? '');
  } catch {
    return errored(area, 'The audited package-lock.json could not be read, so installed versions are unknown.');
  }
  if (!isPlainObject(lockfile?.packages)) {
    return errored(
      area,
      `package-lock.json has no "packages" map (lockfileVersion ${JSON.stringify(lockfile?.lockfileVersion)}); this script reads lockfileVersion 2 or 3.`,
    );
  }

  const findings = new Map();
  for (const [name, vuln] of entries) {
    // Each node is one installed copy. Its version and dev flag come from the lockfile, which is
    // what npm audited. A node the lockfile does not know is kept as "unknown" and counted as
    // shipping: overstating reach is the safer error.
    const nodePaths = Array.isArray(vuln?.nodes) && vuln.nodes.length ? vuln.nodes : [null];
    const nodes = nodePaths.map((node) => {
      const entry = node === null ? undefined : lockfile.packages[node];
      return { version: entry?.version ?? 'unknown', dev: entry?.dev === true };
    });

    for (const via of Array.isArray(vuln?.via) ? vuln.via : []) {
      // A string names another vulnerable package this one depends on. Its advisories are
      // reported on that package, so they are not repeated here.
      if (!isPlainObject(via)) continue;
      const id = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(via.url ?? ''))?.[0] ?? `npm-${via.source ?? 'unknown'}`;
      const affected = nodes.filter((n) => n.version === 'unknown' || satisfiesRange(n.version, via.range) !== false);
      const byVersion = new Map();
      for (const n of affected.length ? affected : nodes) {
        byVersion.set(n.version, [...(byVersion.get(n.version) ?? []), n]);
      }
      for (const [version, copies] of byVersion) {
        const shipsHere = ships === 'never' ? false : copies.some((n) => !n.dev);
        const finding = {
          area,
          package: name,
          version,
          id,
          url: /^https:\/\//.test(via.url ?? '') ? via.url : advisoryUrl(id),
          title: typeof via.title === 'string' ? via.title : '',
          aliases: [],
          severity: normaliseSeverity(via.severity),
          fixedIn: npmFixedIn(via.range, version),
          fixNote: npmFixNote(vuln.fixAvailable, name),
          ships: shipsHere,
          scope: ships === 'never' ? 'E2E only' : shipsHere ? 'prod' : 'dev',
        };
        findings.set(findingKey(finding), finding);
      }
    }
  }

  if (entries.length > 0 && findings.size === 0) {
    return errored(area, `npm audit listed ${entries.length} vulnerable package(s) but no advisory in them could be read.`);
  }
  const checked = Number.isInteger(report.metadata?.dependencies?.total) ? report.metadata.dependencies.total : null;
  return ok(area, [...findings.values()], checked);
}

// ---------------------------------------------------------------------------------------------
// Maven: the dependency graph, and version order
// ---------------------------------------------------------------------------------------------

const MAVEN_SCOPES = new Set(['compile', 'provided', 'runtime', 'test', 'system', 'import']);

/**
 * Parses the file `mvn dependency:list -DoutputFile=...` writes: a header, then one
 * `group:artifact:type[:classifier]:version:scope` per line, which plugin 3.10.0 (the version
 * Spring Boot's parent manages) follows with ` (optional)` for an optional dependency and then
 * ` -- module name`. A line that fits neither is an error, not a skip: a format change must fail
 * the audit, never shrink it.
 *
 * Optional is read and dropped. It only stops a dependency being passed on to a project that
 * depends on this one; this project still has it, and Spring Boot's repackage puts it in the jar.
 * So an optional dependency ships or not by its scope, like any other.
 */
export function parseMavenDependencyList(text) {
  const deps = [];
  const unreadable = [];
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line === 'none' || /^The following files have been resolved:?$/.test(line)) continue;
    const coords = line.replace(/\s+--\s.*$/, '').replace(/\s+\(optional\)$/, '');
    const parts = coords.split(':');
    const scope = parts.at(-1);
    if ((parts.length === 5 || parts.length === 6) && MAVEN_SCOPES.has(scope) && parts.every((p) => p !== '')) {
      deps.push({
        group: parts[0],
        artifact: parts[1],
        type: parts[2],
        classifier: parts.length === 6 ? parts[3] : null,
        version: parts.at(-2),
        scope,
      });
    } else {
      unreadable.push(line);
    }
  }
  if (unreadable.length) {
    throw new Error(
      `Maven's dependency list has ${unreadable.length} line(s) this script cannot read, starting with ` +
        `${unreadable.slice(0, 3).map((l) => JSON.stringify(l)).join(', ')}. The plugin's output format may have changed.`,
    );
  }
  if (!deps.length) throw new Error("Maven's dependency list contains no dependencies.");
  return deps;
}

/** One OSV query per group:artifact@version, with every scope it appears in. */
export function osvPackages(deps) {
  const byKey = new Map();
  for (const d of deps) {
    const name = `${d.group}:${d.artifact}`;
    const key = `${name}@${d.version}`;
    const entry = byKey.get(key) ?? { name, version: d.version, scopes: [] };
    if (!entry.scopes.includes(d.scope)) entry.scopes.push(d.scope);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const QUALIFIER_ORDER = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const QUALIFIER_ALIASES = { a: 'alpha', b: 'beta', m: 'milestone', cr: 'rc', ga: '', final: '', release: '' };

function mavenItems(version) {
  const items = [];
  for (const part of String(version).toLowerCase().split(/[.-]/)) {
    for (const token of part.match(/\d+|[^\d]+/g) ?? []) {
      items.push(/^\d+$/.test(token) ? { n: BigInt(token) } : { q: QUALIFIER_ALIASES[token] ?? token });
    }
  }
  return items;
}

const qualifierRank = (q) => {
  const i = QUALIFIER_ORDER.indexOf(q);
  return i === -1 ? QUALIFIER_ORDER.length : i;
};

/**
 * Maven version order, simplified from Maven's ComparableVersion: numbers compare numerically,
 * a missing part counts as 0 or as a release, alpha < beta < milestone < rc < snapshot < release
 * < sp, unknown qualifiers sort after those, and a number outranks a qualifier. So 11.0.0-M1 <
 * 11.0.0 < 11.0.8, and 2.9.8 < 2.9.10.3. Only used to pick a fixed version to display; OSV itself
 * decides what is affected.
 */
export function compareMavenVersions(a, b) {
  const x = mavenItems(a);
  const y = mavenItems(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    let p = x[i];
    let q = y[i];
    if (p === undefined) p = q && 'q' in q ? { q: '' } : { n: 0n };
    if (q === undefined) q = 'q' in p ? { q: '' } : { n: 0n };
    if ('n' in p && 'n' in q) {
      if (p.n !== q.n) return p.n < q.n ? -1 : 1;
    } else if ('q' in p && 'q' in q) {
      const d = qualifierRank(p.q) - qualifierRank(q.q);
      if (d) return d < 0 ? -1 : 1;
      if (p.q !== q.q) return p.q < q.q ? -1 : 1;
    } else {
      return 'n' in p ? 1 : -1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// OSV: trimming records, and turning them into findings
// ---------------------------------------------------------------------------------------------

/**
 * Keeps what the report uses from an OSV record. The full records list every affected version and
 * run to hundreds of kilobytes for a library like Tomcat; the artifact does not need that.
 */
export function trimOsvRecord(record, packageNames) {
  return {
    id: record.id,
    summary: typeof record.summary === 'string' ? record.summary : '',
    aliases: Array.isArray(record.aliases) ? record.aliases : [],
    withdrawn: record.withdrawn ?? null,
    severity: record.database_specific?.severity ?? null,
    affected: (record.affected ?? [])
      .filter((a) => a?.package?.ecosystem === 'Maven' && packageNames.has(a.package.name))
      .map((a) => ({
        name: a.package.name,
        ranges: (a.ranges ?? []).filter((r) => r.type === 'ECOSYSTEM').map((r) => ({ events: r.events ?? [] })),
      })),
  };
}

/**
 * The lowest fixed version above the installed one. OSV ranges come in introduced/fixed pairs
 * per release line (Tomcat's 11.0.8, 10.1.42, 9.0.106), and those lines do not overlap, so the
 * smallest fix above the installed version is the one on its line, or the next line up when its
 * own line has no fix (spring-core 6.1.x, fixed only in 6.2.11).
 */
export function mavenFixedIn(record, name, version) {
  const fixed = (record.affected ?? [])
    .filter((a) => a.name === name)
    .flatMap((a) => a.ranges.flatMap((r) => r.events.filter((e) => typeof e.fixed === 'string').map((e) => e.fixed)));
  const later = fixed.filter((f) => compareMavenVersions(f, version) > 0).sort(compareMavenVersions);
  return later[0] ?? null;
}

/**
 * OSV can hold two GitHub advisories for one CVE, each aliasing the other (postgresql's
 * GHSA-673j-qm5f-xpv8 and GHSA-727h-hrw8-jg8q). One finding is enough; the more severe is kept.
 */
function dedupeAliases(records) {
  const sorted = [...records].sort(
    (a, b) =>
      rank(normaliseSeverity(a.severity)) - rank(normaliseSeverity(b.severity)) ||
      Number(!/^GHSA-/.test(a.id)) - Number(!/^GHSA-/.test(b.id)) ||
      a.id.localeCompare(b.id),
  );
  const seen = new Set();
  const kept = [];
  for (const r of sorted) {
    const names = [r.id, ...(r.aliases ?? [])];
    if (names.some((n) => seen.has(n))) continue;
    names.forEach((n) => seen.add(n));
    kept.push(r);
  }
  return kept;
}

/**
 * Turns the backend's two outputs into an area result: Maven's exit code, and what osv-query.mjs
 * wrote. Maven is checked first, because a failed resolve leaves a partial or stale list that
 * would audit as clean.
 */
export function analyseBackend({ mvnExitText, osvText }) {
  const area = 'backend';
  const mvnExit = parseExitCode(mvnExitText);
  if (mvnExit == null) {
    return errored(area, "Maven's exit code was not recorded: the step did not run, or failed before Maven started.");
  }
  if (mvnExit !== 0) {
    return errored(area, `Maven could not resolve the dependency graph (exit ${mvnExit}). Its output is in the step's log.`);
  }
  return analyseOsv(area, osvText);
}

/**
 * What osv-query.mjs wrote, as an area result. The backend's audit reads it here once Maven has
 * resolved, and so does the OSV canary (CANARIES), which has no Maven step.
 */
export function analyseOsv(area, osvText) {
  if (osvText == null) return errored(area, 'The OSV lookup wrote no output file.');

  let osv;
  try {
    osv = parseJson(osvText);
  } catch {
    return errored(area, `The OSV lookup's output is not JSON: ${excerpt(osvText)}`);
  }
  if (!isPlainObject(osv)) return errored(area, "The OSV lookup's output is not a JSON object.");
  if (osv.error !== undefined) return errored(area, `The OSV lookup could not complete: ${osv.error}`);
  if (!Array.isArray(osv.packages) || osv.packages.length === 0 || !isPlainObject(osv.vulns)) {
    return errored(area, "The OSV lookup's output has no packages or no advisory details.");
  }

  const findings = new Map();
  for (const pkg of osv.packages) {
    if (!nonEmpty(pkg?.name) || !nonEmpty(pkg?.version) || !Array.isArray(pkg.ids) || !Array.isArray(pkg.scopes)) {
      return errored(area, `The OSV lookup's output has a malformed package entry: ${excerpt(JSON.stringify(pkg))}`);
    }
    const records = [];
    for (const id of pkg.ids) {
      const record = osv.vulns[id];
      if (!isPlainObject(record)) {
        return errored(area, `OSV listed ${id} for ${pkg.name} ${pkg.version}, but its details are missing.`);
      }
      if (!record.withdrawn) records.push(record);
    }
    for (const record of dedupeAliases(records)) {
      const finding = {
        area,
        package: pkg.name,
        version: pkg.version,
        id: record.id,
        url: advisoryUrl(record.id),
        title: record.summary ?? '',
        aliases: (record.aliases ?? []).filter((a) => /^CVE-/.test(a)),
        severity: normaliseSeverity(record.severity),
        fixedIn: mavenFixedIn(record, pkg.name, pkg.version),
        fixNote: null,
        ships: pkg.scopes.some((s) => s !== 'test'),
        scope: pkg.scopes.join(', '),
      };
      findings.set(findingKey(finding), finding);
    }
  }
  return ok(area, [...findings.values()], osv.packages.length);
}

// ---------------------------------------------------------------------------------------------
// Canaries: a source that answers empty
// ---------------------------------------------------------------------------------------------

/**
 * Every check above fails an audit whose source errors. None can fail one whose source answers
 * with a valid, empty result, and that reads exactly like a clean week: `npm audit` did it under
 * `npm_config_offline=true` in the review of #295, exiting 0 with no vulnerabilities. So each run
 * also audits a canary per source (#303), something with published advisories, through the same
 * tool, flags and code as the real audits. A canary that finds nothing, or cannot complete, marks
 * every audit on its source as one that could not complete.
 *
 * At least one finding, not a fixed count: an advisory being withdrawn or merged upstream would
 * fail a count with nothing wrong here. The canaries' findings are counted and dropped. They never
 * reach the report, results.json or the issue.
 *
 * `file` is relative to this directory, and the workflow names the same two paths (tested):
 *   - npm: the lockfile behind fixtures/npm-findings.json, whose audit listed 6 vulnerable packages
 *     on 2026-10-19. The workflow audits a copy named package-lock.json in a directory of its own.
 *   - OSV: canary-dependency-list.txt, one line in `mvn dependency:list`'s format naming
 *     org.postgresql:postgresql 42.2.0, for which OSV listed 8 advisories on 2026-10-19 (7 findings,
 *     once two that alias one CVE are kept as one).
 */
export const CANARIES = [
  { source: 'npm', label: 'npm audit', file: 'fixtures/npm-findings.lockfile.json', areas: ['frontend', 'e2e'] },
  { source: 'osv', label: 'OSV', file: 'canary-dependency-list.txt', areas: ['backend'] },
];

/**
 * Why a canary's result cannot vouch for its source, or null when it can. The label is plain text,
 * not Markdown: this reaches `::error` annotations, which show backticks as they are. An errored
 * canary's own error can point at "the step's log", so the text names the canary's step as the
 * one to read, not the area's.
 */
export function canaryProblem(canary, result) {
  if (!result) return `the ${canary.label} canary produced no result`;
  if (result.status === 'errored') {
    return `the ${canary.label} canary's own step could not complete: ${result.error.replace(/[.\s]+$/, '')}`;
  }
  if (result.findings.length === 0) {
    return `the ${canary.label} canary, which has published advisories, came back with none`;
  }
  return null;
}

/**
 * Marks every area whose source's canary failed as an audit that could not complete, findings or
 * not: a source that answered one query empty may have answered another one short. An area that
 * already could not complete keeps its own error, the more specific of the two.
 *
 * @param {object[]} areaResults  from analyseNpmAudit and analyseBackend
 * @param {{ npm?: object, osv?: object }} canaryResults  each canary's own result, read by the same
 *     functions as the areas it vouches for
 */
export function applyCanaries(areaResults, canaryResults) {
  return areaResults.map((r) => {
    if (r.status === 'errored') return r;
    const canary = CANARIES.find((c) => c.areas.includes(r.area));
    const problem = canary && canaryProblem(canary, canaryResults[canary.source]);
    if (!problem) return r;
    return errored(
      r.area,
      `Not trusted this run: ${problem}. Without a canary that finds something, this area's result cannot be told apart from a source that answered empty (#303).`,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Merging and fingerprinting
// ---------------------------------------------------------------------------------------------

export const findingKey = (f) => `${f.area}|${f.package}|${f.version}|${f.id}`;

export function compareFindings(a, b) {
  const areaIndex = (id) => AREAS.findIndex((x) => x.id === id);
  return (
    areaIndex(a.area) - areaIndex(b.area) ||
    rank(a.severity) - rank(b.severity) ||
    a.package.localeCompare(b.package) ||
    a.version.localeCompare(b.version) ||
    a.id.localeCompare(b.id)
  );
}

/** Order-independent, so the same findings in a different order are the same state. */
export function fingerprint(keys) {
  return createHash('sha256').update([...keys].sort().join('\n')).digest('hex').slice(0, 16);
}

/**
 * Merges the three area results into what report.mjs writes to results.json, and what issue.mjs
 * reads back. An area with no result at all counts as an audit that could not complete.
 */
export function buildResults(areaResults, meta = {}) {
  const areas = AREAS.map((def) => areaResults.find((r) => r.area === def.id) ?? errored(def.id, 'This audit produced no result.'));
  const findings = areas
    .flatMap((a) => a.findings)
    .map((f) => ({ ...f, atFloor: meetsFloor(f) }))
    .sort(compareFindings);
  const actionableKeys = findings.filter((f) => f.atFloor).map(findingKey).sort();
  return {
    version: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    ref: meta.ref ?? null,
    sha: meta.sha ?? null,
    runUrl: meta.runUrl ?? null,
    errored: areas.some((a) => a.status === 'errored'),
    areas: areas.map(({ findings: own, ...rest }) => ({
      ...rest,
      findingCount: own.length,
      actionableCount: own.filter(meetsFloor).length,
    })),
    findings,
    actionableKeys,
    fingerprint: fingerprint(actionableKeys),
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/**
 * Third-party text (advisory titles, notes) inside a table cell. Pipes would split the cell, angle
 * brackets would be read as HTML, and in an issue `@name` notifies whoever owns that name and `#12`
 * links this repository's issue 12. npm scopes such as `@types` hit the first constantly, so a
 * zero-width space after `@` and `#` keeps both from triggering while reading the same.
 */
function cell(text, max = 160) {
  let s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([@#])/g, '$1\u200B');
}

/** A code span; mentions and issue links do not fire inside one. */
const code = (s) => `\`${String(s).replace(/`/g, "'").replace(/\|/g, '\\|')}\``;

function findingRow(f) {
  const severity = f.atFloor ? `**${f.severity}**` : f.severity;
  const link = f.url ? `[${f.id}](${f.url})` : f.id;
  const aliases = f.aliases?.length ? ` (${f.aliases.join(', ')})` : '';
  const title = f.title ? `<br>${cell(f.title)}` : '';
  const fixed = `${f.fixedIn ? code(f.fixedIn) : '-'}${f.fixNote ? `<br>${cell(f.fixNote)}` : ''}`;
  const ships = `${f.ships ? 'yes' : 'no'} (${f.scope})`;
  return `| ${severity} | ${code(f.package)} | ${code(f.version)} | ${link}${aliases}${title} | ${fixed} | ${ships} |`;
}

const runLine = (results) => {
  const parts = [`Run of ${results.generatedAt.slice(0, 10)}`];
  if (results.ref) parts.push(`on ${code(results.ref)}`);
  if (results.sha) parts.push(`at ${code(results.sha.slice(0, 7))}`);
  return `${parts.join(' ')}${results.runUrl ? ` ([workflow run](${results.runUrl}))` : ''}.`;
};

/**
 * The Markdown report: a summary table, a warning per audit that could not complete, then each
 * area's findings worst first. With `belowFloor: 'omit'` (the issue body's fallback when the full
 * report would not fit) findings under the floor are counted instead of listed.
 */
export function renderReport(results, { headingLevel = 2, belowFloor = 'list' } = {}) {
  const h = '#'.repeat(headingLevel);
  const lines = [`${h} Dependency audit`, '', runLine(results), ''];
  lines.push(`The issue floor is ${FLOOR_TEXT} Findings at or above it have their severity in bold.`, '');

  lines.push('| Area | Audit | Checked | Findings | At or above the floor |', '|---|---|---|--:|--:|');
  for (const a of results.areas) {
    const def = areaDef(a.area);
    if (a.status === 'errored') {
      lines.push(`| ${def.label} | ${def.tool} | **could not complete** | - | - |`);
    } else {
      lines.push(`| ${def.label} | ${def.tool} | ${a.checked ?? '?'} ${def.unit} | ${a.findingCount} | ${a.actionableCount} |`);
    }
  }

  for (const a of results.areas.filter((x) => x.status === 'errored')) {
    lines.push('', '> [!WARNING]', `> **${areaDef(a.area).label}: the audit could not complete.** ${cell(a.error, 600)}`);
  }

  for (const a of results.areas) {
    const def = areaDef(a.area);
    lines.push('', `${h}# ${def.label}`, '');
    if (a.status === 'errored') {
      lines.push('Not checked: the audit could not complete (above).');
      continue;
    }
    const own = results.findings.filter((f) => f.area === a.area);
    const listed = belowFloor === 'omit' ? own.filter((f) => f.atFloor) : own;
    if (own.length === 0) {
      lines.push(`No published advisory affects these ${a.checked ?? ''} ${def.unit}.`.replace('  ', ' '));
      continue;
    }
    if (listed.length) {
      lines.push('| Severity | Package | Installed | Advisory | Fixed in | Ships |', '|---|---|---|---|---|---|');
      lines.push(...listed.map(findingRow));
    }
    const hidden = own.length - listed.length;
    if (hidden) lines.push('', `${hidden} finding(s) below the floor are not listed here; the workflow run's summary has them.`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// The tracking issue
// ---------------------------------------------------------------------------------------------

/**
 * The issue's state lives in its body as an HTML comment: the fingerprint, plus the keys behind it
 * so the next change can say what was added and what went away. Base64, because an HTML comment
 * cannot safely hold arbitrary text (`--` ends it, and npm package names may contain that).
 */
export function encodeState(state) {
  return `<!-- ${ISSUE.marker} ${Buffer.from(JSON.stringify(state), 'utf8').toString('base64')} -->`;
}

export const hasMarker = (body) => typeof body === 'string' && body.includes(`<!-- ${ISSUE.marker} `);

/** The state from an issue body, or null if absent or unreadable (a hand edit, say). */
export function parseState(body) {
  if (typeof body !== 'string') return null;
  const m = new RegExp(`<!-- ${ISSUE.marker} ([A-Za-z0-9+/=]+) -->`).exec(body);
  if (!m) return null;
  try {
    const state = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    if (typeof state?.fingerprint !== 'string' || !Array.isArray(state.keys)) return null;
    return state;
  } catch {
    return null;
  }
}

/** An issue body or comment must stay under GitHub's 65,536 characters. */
const BODY_LIMIT = 60000;

/**
 * The state marker's share of the body: about 250 keys. Each key costs roughly 80 characters once
 * encoded, so without a cap the marker alone outgrew the body at several hundred findings (about
 * 650 on the review of #295), and GitHub would have rejected the edit every week after.
 */
const STATE_LIMIT = 20000;

/**
 * How a person accepts what an issue records; planIssue reads `state_reason` to match. "Records",
 * not "lists": a body cut for length shows fewer rows than the saved keys a close accepts.
 */
export const ACCEPT_RULE =
  'To accept the advisories this issue records, close it as not planned. Closing it as completed, including from a PR, accepts nothing.';

/**
 * The state to save: the fingerprint always, and as many keys as fit under STATE_LIMIT. When they
 * do not all fit, `complete: false` and `total` say so, the next change comment says it cannot list
 * what changed, and an issue closed as not planned accepts only the keys it recorded (see planIssue).
 *
 * `accepted` holds the acceptance keys already accepted by an issue closed as not planned. When the
 * keys do not all fit, the ones not yet accepted are kept first. Otherwise each new issue would
 * record the same leading keys as the last, and the keys past the cap could never be accepted: the
 * issue would come back every week however many times it was closed as not planned.
 */
export function boundedState(results, { accepted = new Set() } = {}) {
  const state = { v: 1, fingerprint: results.fingerprint, keys: results.actionableKeys };
  if (encodeState(state).length <= STATE_LIMIT) return state;
  const fresh = results.actionableKeys.filter((k) => !accepted.has(acceptanceKey(k)));
  const old = results.actionableKeys.filter((k) => accepted.has(acceptanceKey(k)));
  const keys = [...fresh, ...old];
  const total = keys.length;
  const partial = (n) => ({ ...state, keys: keys.slice(0, n), complete: false, total });
  let lo = 0;
  let hi = total - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodeState(partial(mid)).length <= STATE_LIMIT) lo = mid;
    else hi = mid - 1;
  }
  return partial(lo);
}

/** `accepted` is boundedState's: acceptance keys an issue closed as not planned already accepts. */
export function renderIssueBody(results, { previous = null, accepted = new Set() } = {}) {
  const intro = [
    'This issue is kept up to date by the weekly dependency audit, `.github/workflows/dependency-audit.yml` (#273). ' +
      'It is edited only when the set of findings at or above the floor changes, with a comment saying what changed.',
    '',
    'It never closes itself. Once the findings are fixed, close it as completed. ' +
      `${ACCEPT_RULE} Accepting covers each advisory listed here for its package, at any version: none of them opens ` +
      'an issue again. A new issue opens only for an advisory that is in no audit issue closed as not planned.',
  ];
  if (previous) intro.push('', `The previous set of findings was in #${previous}.`);
  const state = encodeState(boundedState(results, { accepted }));

  const compose = (report) => [...intro, '', report, '', state].join('\n');
  let body = compose(renderReport(results, { headingLevel: 2 }));
  if (body.length > BODY_LIMIT) body = compose(renderReport(results, { headingLevel: 2, belowFloor: 'omit' }));
  if (body.length > BODY_LIMIT) {
    const report = renderReport(results, { headingLevel: 2, belowFloor: 'omit' });
    const note = "\n\n**Truncated to fit an issue.** The workflow run's summary has the full report.";
    // Never negative: slice() with a negative end counts back from the end, and keeps nearly all.
    const room = Math.max(0, BODY_LIMIT - compose('').length - note.length);
    const cut = report.slice(0, room).replace(/\n[^\n]*$/, '');
    body = compose(`${cut}${note}`);
  }
  // Unreachable while STATE_LIMIT and the intro leave room; kept so a change that breaks that fails
  // here, before anything is written, rather than as GitHub rejecting the edit.
  if (body.length > BODY_LIMIT) throw new Error(`The issue body is ${body.length} characters even truncated; the limit is ${BODY_LIMIT}.`);
  return body;
}

function bulletFor(f) {
  const link = f.url ? `[${f.id}](${f.url})` : f.id;
  return `- **${f.severity}** · ${areaDef(f.area).label} · ${code(f.package)} ${code(f.version)} · ${link} · ${f.ships ? 'ships' : 'does not ship'}`;
}

function bulletForKey(key) {
  const [area, pkg, version, id] = key.split('|');
  return `- ${areaDef(area)?.label ?? area} · ${code(pkg)} ${code(version)} · [${id}](${advisoryUrl(id)})`;
}

function capped(items, max = 50) {
  return items.length > max ? [...items.slice(0, max), `- …and ${items.length - max} more.`] : items;
}

export function renderChangeComment(previousState, results) {
  const date = results.generatedAt.slice(0, 10);
  const before = new Set(previousState?.keys ?? []);
  const now = results.findings.filter((f) => f.atFloor);
  const nowKeys = new Set(now.map(findingKey));
  const added = now.filter((f) => !before.has(findingKey(f)));
  const gone = [...before].filter((k) => !nowKeys.has(k)).sort();

  const lines = [
    `**The findings changed** in the run of ${date}${results.runUrl ? ` ([workflow run](${results.runUrl}))` : ''}. The body now shows the current report.`,
  ];
  if (previousState?.complete === false) {
    lines.push(
      '',
      `This issue's previous state recorded only ${previousState.keys.length} of its ${previousState.total ?? 'many'} findings, ` +
        'so what changed could not be listed.',
    );
    return lines.join('\n');
  }
  if (!previousState) {
    lines.push('', "This issue's previous state could not be read, so every current finding is listed as new.");
  }
  if (added.length) lines.push('', `New at or above the floor (${added.length}):`, ...capped(added.map(bulletFor)));
  if (gone.length) lines.push('', `No longer reported (${gone.length}):`, ...capped(gone.map(bulletForKey)));
  return lines.join('\n');
}

export function renderCleanComment(results) {
  const date = results.generatedAt.slice(0, 10);
  const below = results.findings.length;
  return [
    `**Clean as of ${date}:** no finding at or above the floor${results.runUrl ? ` ([workflow run](${results.runUrl}))` : ''}.` +
      (below ? ` ${below} below it are listed in the body.` : ''),
    '',
    'Leaving this open: a person closes it, after checking that the earlier findings were dealt with rather than only no longer reported.',
  ].join('\n');
}

/** A finding's key without its version: what closing an issue as not planned accepts. */
const acceptanceKey = (key) => {
  const [area, pkg, , id] = key.split('|');
  return `${area}|${pkg}|${id}`;
};

/**
 * Decides what to do with the tracking issue. `issues` are the issues the bot opened that carry
 * the marker, open and closed, as `{ number, state, state_reason, body }`.
 *
 *   - An open issue with the same fingerprint: nothing. This is what keeps it from being weekly.
 *   - An open issue, and now clean: comment that it is clean, and record the clean state so the
 *     next clean week stays quiet. It stays open; a person closes it.
 *   - An open issue, findings changed: comment with what changed, and rewrite the body.
 *   - No open issue, and every finding at or above the floor already accepted: nothing.
 *   - Otherwise, findings at or above the floor open a new issue.
 *
 * What is accepted, decided by the owner on the review of #295: an advisory in a package, by
 * `area|package|advisory`, without the version, listed in an audit issue a person closed as not
 * planned. A new issue opens only when some finding's key is in no such issue's saved state,
 * taking all of them together, not only the newest. Closing as not planned is the owner accepting
 * those advisories for those packages, so the same set does not come back, a subset of it does not
 * come back, and nor does a patch bump that is still inside the affected range: none of those is
 * new information.
 *
 * Only `not_planned` accepts (ACCEPT_RULE). A close as completed, which is also what a closing
 * keyword in a merged PR does, says the findings were fixed, and accepts nothing: a PR that fixed
 * one finding and said so would otherwise accept every other finding in the issue with it. A
 * missing or unknown `state_reason` accepts nothing too. So does a closed issue whose state cannot
 * be read, and one that recorded only some of its keys (boundedState) accepts only those, so the
 * error is always towards filing.
 */
export function planIssue({ results, issues }) {
  if (results.errored) {
    throw new Error('Refusing to touch the issue: an audit could not complete, and its missing findings would read as fixed.');
  }
  const ours = issues.map((i) => ({ ...i, saved: parseState(i.body) })).sort((a, b) => b.number - a.number);
  const open = ours.filter((i) => i.state === 'open');
  const closed = ours.filter((i) => i.state === 'closed');
  const actionable = results.findings.filter((f) => f.atFloor);
  const labels = [...new Set(actionable.map((f) => areaDef(f.area).issueLabel))];
  const notes = open.length > 1 ? [`${open.length} open issues carry the marker; only the newest, #${open[0].number}, is updated.`] : [];
  // Acceptance key -> the newest issue closed as not planned that lists it.
  const acceptedBy = new Map();
  for (const issue of closed.filter((i) => i.state_reason === 'not_planned')) {
    for (const key of issue.saved?.keys ?? []) {
      const k = acceptanceKey(key);
      if (!acceptedBy.has(k)) acceptedBy.set(k, issue.number);
    }
  }
  // An open issue's body orders its state by this too, since it can be closed as not planned later.
  const accepted = new Set(acceptedBy.keys());

  const target = open[0];
  if (target) {
    if (target.saved?.fingerprint === results.fingerprint) {
      return { action: 'none', reason: `#${target.number} already shows this set of findings.`, notes };
    }
    if (actionable.length === 0) {
      return {
        action: 'update',
        number: target.number,
        comment: renderCleanComment(results),
        body: renderIssueBody(results, { accepted }),
        addLabels: [],
        reason: `Clean now; #${target.number} still showed findings.`,
        notes,
      };
    }
    return {
      action: 'update',
      number: target.number,
      comment: renderChangeComment(target.saved, results),
      body: renderIssueBody(results, { accepted }),
      addLabels: labels,
      reason: `The findings at or above the floor changed since #${target.number} was last updated.`,
      notes,
    };
  }

  if (actionable.length === 0) {
    return { action: 'none', reason: 'No finding at or above the floor, and no open issue.', notes };
  }
  const lastClosed = closed[0];
  const actionableKeys = actionable.map((f) => acceptanceKey(findingKey(f)));
  if (actionableKeys.every((k) => acceptedBy.has(k))) {
    const by = [...new Set(actionableKeys.map((k) => acceptedBy.get(k)))].sort((a, b) => b - a);
    return {
      action: 'none',
      reason:
        `All ${actionable.length} finding(s) at or above the floor were in audit issue(s) a person closed as not planned ` +
        `(${by.map((n) => `#${n}`).join(', ')}), which accepts them; not refiling.`,
      notes,
    };
  }
  return {
    action: 'create',
    title: issueTitle(),
    body: renderIssueBody(results, { previous: lastClosed?.number ?? null, accepted }),
    labels,
    milestone: ISSUE.milestone,
    reason: `${actionable.length} finding(s) at or above the floor, and no open issue.`,
    notes,
  };
}
