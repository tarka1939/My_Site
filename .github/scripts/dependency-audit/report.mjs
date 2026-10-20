/**
 * Reads the three audits' outputs, writes the report, and decides whether the run fails. Part of #273.
 *
 *   node .github/scripts/dependency-audit/report.mjs --dir <audit outputs> --root <repo root>
 *        [--summary <file to append the Markdown to>] [--results <results.json to write>]
 *        [--ref <branch>] [--sha <commit>]
 *
 * Expects in --dir, as the workflow's collect steps write them:
 *
 *   frontend.npm-audit.json, frontend.npm-audit.exit   npm audit's stdout, and its exit code
 *   e2e.npm-audit.json, e2e.npm-audit.exit
 *   backend.mvn.exit                                    mvn dependency:list's exit code
 *   backend.osv.json                                    what osv-query.mjs wrote
 *   canary.npm-audit.json, canary.npm-audit.exit        npm audit of the canary lockfile (#303)
 *   canary.osv.json                                     osv-query.mjs on the canary list
 *
 * and reads the audited lockfiles from --root, and the canary lockfile from beside this script. A
 * missing file is not an error here: the area it belongs to is reported as an audit that could not
 * complete, and a missing canary output does the same to every area on that canary's source.
 *
 * Exit code: 0 when every audit completed, whatever they found, because a finding is reported
 * through the issue, not by failing the run. 1 when any audit could not complete, after writing the
 * summary, so what did complete is still there to read.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyseBackend, analyseNpmAudit, analyseOsv, applyCanaries, areaDef, buildResults, CANARIES, isMain, renderReport } from './lib.mjs';

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** A workflow command's message must have %, CR and LF escaped, or it is cut at the first newline. */
const annotation = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function collect({ dir, root, env = process.env, ref, sha }) {
  const npmArea = (area) =>
    analyseNpmAudit({
      area,
      stdout: read(path.join(dir, `${area}.npm-audit.json`)),
      exitCodeText: read(path.join(dir, `${area}.npm-audit.exit`)),
      lockfileText: read(path.join(root, area, 'package-lock.json')),
      ships: areaDef(area).ships,
    });
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null;
  // Read with the same functions as the areas they vouch for, so a canary is judged exactly as a
  // real audit would be. Their findings go no further than applyCanaries.
  const canaryFile = (source) => fileURLToPath(new URL(CANARIES.find((c) => c.source === source).file, import.meta.url));
  const canaries = {
    npm: analyseNpmAudit({
      area: 'canary',
      stdout: read(path.join(dir, 'canary.npm-audit.json')),
      exitCodeText: read(path.join(dir, 'canary.npm-audit.exit')),
      lockfileText: read(canaryFile('npm')),
      ships: 'never',
    }),
    osv: analyseOsv('canary', read(path.join(dir, 'canary.osv.json'))),
  };
  return buildResults(
    applyCanaries(
      [
        analyseBackend({ mvnExitText: read(path.join(dir, 'backend.mvn.exit')), osvText: read(path.join(dir, 'backend.osv.json')) }),
        npmArea('frontend'),
        npmArea('e2e'),
      ],
      canaries,
    ),
    { ref: ref ?? env.AUDIT_REF ?? env.GITHUB_REF_NAME ?? null, sha: sha ?? env.GITHUB_SHA ?? null, runUrl },
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      root: { type: 'string', default: '.' },
      summary: { type: 'string' },
      results: { type: 'string' },
      ref: { type: 'string' },
      sha: { type: 'string' },
    },
  });
  if (!values.dir) {
    console.error('Usage: node report.mjs --dir <audit outputs> [--root <repo root>] [--summary <file>] [--results <file>]');
    process.exitCode = 2;
    return;
  }

  const results = collect({ dir: values.dir, root: values.root, ref: values.ref, sha: values.sha });
  const markdown = renderReport(results);
  process.stdout.write(`${markdown}\n`);
  if (values.summary) appendFileSync(values.summary, `${markdown}\n`);
  if (values.results) writeFileSync(values.results, `${JSON.stringify(results, null, 2)}\n`);

  for (const area of results.areas.filter((a) => a.status === 'errored')) {
    console.log(`::error title=${areaDef(area.area).label} audit could not complete::${annotation(area.error)}`);
  }
  if (results.errored) process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
