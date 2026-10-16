/**
 * Opens or updates the dependency audit's tracking issue. Part of #273.
 *
 *   node .github/scripts/dependency-audit/issue.mjs --results <results.json> --repo <owner/name> [--write]
 *
 * Without --write it is a dry run: it reads the repository (the milestone, the labels, the issues
 * this workflow opened before) and prints what it would do, writing nothing. With --write it does
 * it, and only when GITHUB_EVENT_NAME is `schedule` or `workflow_dispatch`. The workflow gates the
 * job on the event already; this is a second gate, so neither a pull_request run nor a person
 * running the script by hand can write, whatever their token allows.
 *
 * Why `gh` rather than actions/github-script: gh is preinstalled on the runner, and the same script
 * runs unchanged on a laptop, so the dry run below reads the real repository through the same
 * calls the workflow makes. github-script would put the logic inside YAML, or behind an Octokit
 * object that only exists inside the action, and there is nothing to dry-run it with.
 *
 * Which issue: the newest open one that GITHUB_TOKEN's account opened and that carries the state
 * marker in its body; failing that, the newest closed one. lib.mjs's planIssue() says what then.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AREAS, hasMarker, ISSUE, isMain, planIssue } from './lib.mjs';

const WRITE_EVENTS = ['schedule', 'workflow_dispatch'];

export function assertWriteAllowed(event) {
  if (!WRITE_EVENTS.includes(event)) {
    throw new Error(
      `Refusing to write: the issue is filed only by schedule and workflow_dispatch runs, and this is ${event ? `a ${event} run` : 'not a workflow run'}.`,
    );
  }
}

function runGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/** A body goes through a file, not an argument: it can be tens of kilobytes. */
async function withBodyFile(body, use) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dependency-audit-'));
  const file = path.join(dir, 'body.md');
  try {
    writeFileSync(file, body);
    return await use(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ndjson = (out) =>
  out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

/** The GitHub calls this script makes, through `gh`. `run` is replaceable for the tests. */
export function createGh(repo, run = runGh) {
  return {
    milestones: async () =>
      ndjson(await run(['api', '--paginate', `repos/${repo}/milestones?state=all&per_page=100`, '--jq', '.[] | {number, title, state}'])),

    labelExists: async (name) => {
      try {
        await run(['api', `repos/${repo}/labels/${encodeURIComponent(name)}`, '--jq', '.name']);
        return true;
      } catch (error) {
        if (/HTTP 404/.test(error.message)) return false;
        throw error;
      }
    },

    // `creator` filters on the server; the author check repeats it, so a change in what the API
    // returns cannot make the script edit an issue someone else opened.
    auditIssues: async () =>
      ndjson(
        await run([
          'api',
          '--paginate',
          '-X',
          'GET',
          `repos/${repo}/issues`,
          '-f',
          'state=all',
          '-f',
          `creator=${ISSUE.bot}`,
          '-f',
          'per_page=100',
          '--jq',
          '.[] | select(.pull_request == null) | {number, state, body, author: .user.login}',
        ]),
      ).filter((issue) => issue.author === ISSUE.bot && hasMarker(issue.body)),

    create: ({ title, body, labels, milestone }) =>
      withBodyFile(body, (file) =>
        run(['issue', 'create', '--repo', repo, '--title', title, '--body-file', file, ...labels.flatMap((l) => ['--label', l]), '--milestone', milestone]),
      ),

    comment: (number, body) => withBodyFile(body, (file) => run(['issue', 'comment', String(number), '--repo', repo, '--body-file', file])),

    edit: (number, body, addLabels) =>
      withBodyFile(body, (file) =>
        run(['issue', 'edit', String(number), '--repo', repo, '--body-file', file, ...addLabels.flatMap((l) => ['--add-label', l])]),
      ),
  };
}

/**
 * Every issue here needs area labels and a milestone. Checked on every run, not only when an issue
 * is about to be opened: a milestone closed in a quiet week would otherwise surface only on the
 * week something is found, which is when the issue is needed.
 */
export async function preflight(gh) {
  const milestone = (await gh.milestones()).find((m) => m.title === ISSUE.milestone);
  const fix = `Set ISSUE.milestone in .github/scripts/dependency-audit/lib.mjs to the current phase's milestone title.`;
  if (!milestone) {
    throw new Error(`The milestone "${ISSUE.milestone}" does not exist, and every issue in this repository needs one. ${fix}`);
  }
  if (milestone.state !== 'open') {
    throw new Error(`The milestone "${ISSUE.milestone}" is closed, so the project has moved past it. ${fix}`);
  }
  const missing = [];
  for (const label of new Set(AREAS.map((a) => a.issueLabel))) {
    if (!(await gh.labelExists(label))) missing.push(label);
  }
  if (missing.length) {
    throw new Error(`The label(s) ${missing.join(', ')} do not exist; this workflow labels its issue by area with them.`);
  }
}

/**
 * Rewrite the body first, then comment. An edit that fails writes nothing, so the next run retries
 * it cleanly. The other order posted the comment and then failed the edit, and an edit that fails
 * every week (a body GitHub rejects) would have posted the same comment every week.
 *
 * The cost: a comment that fails after the edit is lost, because the new fingerprint is already in
 * the body and the next run sees nothing to do. So that failure says exactly that, and carries the
 * comment, which main() prints for posting by hand. The body itself shows the current findings.
 */
export async function applyPlan(gh, plan) {
  if (plan.action === 'create') return String(await gh.create(plan)).trim();
  if (plan.action === 'update') {
    await gh.edit(plan.number, plan.body, plan.addLabels);
    try {
      await gh.comment(plan.number, plan.comment);
    } catch (error) {
      throw Object.assign(
        new Error(`#${plan.number}'s body was updated, but the comment saying what changed was not posted, and no later run will post it: ${error.message}`),
        { unpostedComment: plan.comment },
      );
    }
    return `#${plan.number}`;
  }
  return null;
}

async function main() {
  const { values } = parseArgs({
    options: { results: { type: 'string' }, repo: { type: 'string' }, write: { type: 'boolean', default: false } },
  });
  if (!values.results || !values.repo) {
    console.error('Usage: node issue.mjs --results <results.json> --repo <owner/name> [--write]');
    process.exitCode = 2;
    return;
  }
  if (values.write) assertWriteAllowed(process.env.GITHUB_EVENT_NAME);

  const results = JSON.parse(readFileSync(values.results, 'utf8'));
  if (results.version !== 1) throw new Error(`${values.results} is results version ${results.version}; this script reads version 1.`);

  const gh = createGh(values.repo);
  await preflight(gh);
  const issues = await gh.auditIssues();
  const plan = planIssue({ results, issues });
  console.log(`Found ${issues.length} earlier audit issue(s). Plan: ${plan.action}. ${plan.reason}`);
  for (const note of plan.notes) console.log(`::warning title=Dependency audit issue::${note}`);

  if (!values.write) {
    console.log('Dry run: nothing was written.');
    if (plan.action === 'create') console.log(`\nWould open "${plan.title}", labels ${plan.labels.join(', ')}, milestone ${plan.milestone}:\n\n${plan.body}`);
    if (plan.action === 'update') console.log(`\nWould comment on #${plan.number}:\n\n${plan.comment}\n\nand set its body to:\n\n${plan.body}`);
    return;
  }
  const where = await applyPlan(gh, plan);
  if (where) console.log(`Done: ${where}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    if (error.unpostedComment) console.log(`The comment that was not posted:\n\n${error.unpostedComment}`);
    const message = String(error.message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error title=Dependency audit issue::${message}`);
    process.exitCode = 1;
  });
}
