# /.github/workflows

## `ci.yml` — tests on every pull request

Runs the backend suite, the frontend suite, and a check that the committed API client still matches
`docs/openapi.yaml`. Issue #193.

Deliberately deploys nothing. It needs no secrets and has no deploy target, so it cannot break
production — which is why it was separated out of #38 and #45 and shipped first. Before it existed,
every test run in this repository happened because a person remembered to run one.

Three things in it are repository-specific rather than generic CI, and each encodes a mistake that
has already happened here:

- **`mvn -B test`, never `-q`.** The quiet flag suppresses the `Tests run:` summary line, and a
  count derived from `target/surefire-reports` instead of read from Maven has been wrong here once,
  by 22 tests.
- **`npm ci` before `npm test`.** Without an install step `ng` does not exist, and the failure reads
  as a broken test rather than a missing dependency.
- **`git add -A && git diff --cached --numstat` for the client check** — not `git status
  --porcelain` (false positive on Windows line endings) and not `git diff --numstat` (blind to newly
  generated files, which is exactly the shape of a stale client after a schema is added).

There is also an explicit `docker info` step before the backend tests. The integration tests start
Postgres through Testcontainers, on the image named in `TestPostgres.java`, and `@Testcontainers` is
deliberately *not* set to `disabledWithoutDocker` — so a runner without Docker fails rather than
skips, and the step names that cause instead of leaving a confusing container error to be
interpreted.

The image gets the same treatment (#285). `.github/scripts/pull-test-image.sh` pulls it before Maven
runs, reading the name from `TestPostgres.java`, so a Docker Hub refusal fails within minutes at a
step named for the pull. On 2026-10-09 the same refusal cost 45 minutes of retries, and then showed
up as 9 errored test classes. Ryuk, Testcontainers' cleanup container, is switched off for the Maven
step (`TESTCONTAINERS_RYUK_DISABLED`). Its image was the job's only other Docker Hub pull, and a
runner is discarded after the job anyway. After those two changes, the image pull is the job's only
contact with Docker Hub. `deploy-backend.yml` does both as well (#287), with the same script, so the
release path runs what every pull request has already run.

## `dependency-audit.yml` — weekly advisory check, one tracking issue

Audits all three dependency trees every Monday and keeps one issue up to date with what it finds.
Issue #273. Before it existed, every advisory found here (#244, #265, #267, and 16 against the
backend in #272) was found because someone went looking.

- **Frontend and E2E:** `npm audit --json --package-lock-only --offline=false --include=dev` on
  each lockfile. It audits what `npm ci` would install without installing it, so no install script
  runs. The last two flags override settings that would shrink the audit without failing it. They
  were measured on 2026-10-16:
  - `npm_config_offline=true` made `npm audit` exit 0 with no vulnerabilities at all.
  - `npm_config_omit=dev` or `NODE_ENV=production` dropped every dev-only package.
- **Backend:** `mvn dependency:list` resolves the real graph, including every version Spring
  Boot's BOM manages, and `osv-query.mjs` (Node standard library only) looks each one up in
  [OSV](https://osv.dev). It needs no account and no secret. OWASP dependency-check needs an NVD
  key to be usable, and Sonatype OSS Index needs credentials.

**Not audited:**

- Maven's build plugins and their own dependencies. `dependency:list` covers what the backend
  depends on, not what builds it.
- The `openapi-generator-cli` jar that `npm run generate:api` downloads when it runs. `npm audit`
  sees the npm wrapper package in the frontend lockfile, not the Java jar the wrapper fetches.

**A finding never fails the run. An audit that could not complete always does.** `npm audit` exits
1 in both cases, so the exit code cannot tell them apart. `report.mjs` decides from the JSON
instead. A registry or network error, unreadable output, a Maven failure or an OSV failure fails
the run with an annotation naming the area. That matters because an audit that silently did not
happen reads exactly like a clean one. The Markdown report goes to the run summary on every run
that reaches the report step, including one where an audit failed. A run that is cancelled, or
stopped by the job's 20-minute timeout, writes no report.

**What "ships" means.** Every scope is audited, dev and test included, and each finding says whether
it ships:

- Frontend: a package ships unless the lockfile marks every copy of it `dev`.
- Backend: a package ships unless its only scope is `test`. `provided` counts as shipping, because
  Spring Boot's repackage includes it.
- E2E: nothing ships.

**Floor for the issue:**

- An issue is opened for **high or worse in anything**, or **moderate or worse in something that
  ships**.
- An advisory with no severity counts as high.
- Low and info are reported in the summary and never open an issue.

Dev tooling is held to high for two reasons:

- Every advisory filed here by hand was high or critical, including the ones in dev tooling, and
  dev tooling runs in CI and in the deploy pipelines.
- Moderate advisories in build tools are the commonest npm finding, and would make the issue weekly
  noise.

**The issue:**

- Only `schedule` runs, and `workflow_dispatch` runs **from the default branch**, touch it. A
  dispatch from any other branch audits that branch and only writes the report. That is gated
  twice: by the `file-issue` job's `if`, and by `issue.mjs --write`, which checks the event and
  `GITHUB_REF` against the default branch. A schedule's event carries no repository, so neither
  check can compare its branch, and neither needs to: GitHub runs a schedule only from the default
  branch.
- That job alone has `issues: write`. The audit job, which runs Maven, has `contents: read` only.
- The job is skipped when an audit errored, so a partial result never rewrites the issue as though
  the findings it is missing had been fixed.
- The body carries a fingerprint of the findings in an HTML comment.
  - With the same findings as last week, nothing is written.
  - With changed findings, the body is rewritten, then a comment says what changed. That order
    means an edit GitHub rejects posts nothing, instead of the same comment every week. If the
    comment fails after the edit, the run fails and prints the comment for posting by hand.
  - The body always fits an issue, and always carries the fingerprint. A report too long for it is
    cut, and the run summary has all of it. Past about 250 findings at or above the floor, the
    saved state keeps only some of their keys. In that case the next change comment says it cannot
    list what changed, and closing that issue as not planned accepts only the keys it kept. Keys
    not yet accepted are kept first, so the next issue lists the rest, and closing it as not
    planned too accepts them all.
  - When the findings are all gone, there is a comment, and the issue is left open for a person to
    close as completed.
- **To accept the listed advisories, close the issue as not planned. Closing it as completed,
  including from a PR, accepts nothing.** The script reads the close's `state_reason`, and only
  `not_planned` accepts. A closing keyword in a merged PR closes as completed, so a PR that fixes
  one finding and says so cannot accept the rest of the issue with it. A missing `state_reason`
  accepts nothing either.
- With no issue open, a new one opens only when some finding at or above the floor is in none of
  the audit issues closed as not planned. Findings are compared by area, package and advisory,
  without the version, and against every such issue together, not only the newest. Neither the
  same set, nor a subset of it, nor a version bump that is still affected brings an issue back:
  none of those is new information. A new advisory does, and the new issue lists every finding and
  links the last closed one. This was the owner's decision on the review of #295; the not-planned
  rule came from the review after.
- Labels are `backend`, `frontend` and `infra` (for E2E), by the areas affected. The milestone is
  **Phase 8**, looked up by title.
- If that milestone is closed or gone, or a label is missing, the run fails with a message. When
  the phase changes, update `ISSUE.milestone` in `.github/scripts/dependency-audit/lib.mjs`.
- `gh` rather than `actions/github-script`: the logic stays in plain Node modules that the tests run
  directly, and `gh` is already on the runner.

**It audits `dev`, not `main`.** A scheduled run always uses the workflow file on the default branch
and checks that branch out. `main` is what is deployed, and lags `dev` by whatever has not been
promoted yet. GitHub sends a failed scheduled run's notification to whoever last changed the cron
line.

**Not part of `ci.yml`, on purpose.** An audit there would fail unrelated pull requests whenever an
advisory is published, with no change in this repository. That was option 2 in #273, and it was
rejected. For the same reason, a PR that only changes a lockfile or `pom.xml` does not trigger this
workflow. A PR that changes the workflow or its scripts does, and that run reports without filing.

Tests, with recorded real output as fixtures:
`node --test .github/scripts/dependency-audit/dependency-audit.test.mjs`. Pass the file, not the
directory: Node 24 treats a directory argument as a module and fails. A pull request that triggers
this workflow runs them as a job of its own, `unit-tests`. The audit does not wait for it, so a
failing test is a red check rather than an audit reported as unable to complete. Nothing in
`ci.yml` runs them, and the scheduled run skips them.

**GitHub disables a public repository's scheduled workflows after 60 days with no activity.** A
quiet stretch on this repository would stop the audit without a failure to notice. The Actions tab
shows the workflow as disabled, and enabling it there resumes the schedule.

To run the whole pipeline locally without writing anything, run the workflow's steps from the
repository root, in bash (Git Bash on Windows). The report step writes `results.json`. `issue.mjs`
without `--write` then reads the repository through an authenticated `gh` and prints what it would
do. Windows PowerShell's `>` writes UTF-16LE, which the scripts reject as unreadable output.

```bash
out=$(mktemp -d)
(cd frontend && npm audit --json --package-lock-only --offline=false --include=dev > "$out/frontend.npm-audit.json"; echo $? > "$out/frontend.npm-audit.exit")
(cd e2e && npm audit --json --package-lock-only --offline=false --include=dev > "$out/e2e.npm-audit.json"; echo $? > "$out/e2e.npm-audit.exit")
(cd backend && mvn -B -ntp dependency:list -Dsort=true -DoutputFile="$out/backend.deps.txt"; echo $? > "$out/backend.mvn.exit")
node .github/scripts/dependency-audit/osv-query.mjs "$out/backend.deps.txt" "$out/backend.osv.json"
node .github/scripts/dependency-audit/report.mjs --dir "$out" --root . --results "$out/results.json"
node .github/scripts/dependency-audit/issue.mjs --results "$out/results.json" --repo tarka1939/My_Site
```

## `deploy-backend.yml` and `deploy-frontend.yml` — live on `main`

Both run on push to `main` and by hand (`workflow_dispatch`), in a `production` environment, one at
a time and never cancelled midway. Issue #196.

- **Backend** (#45): builds the jar and ships it over **stdin** to `deploy/deploy.sh`, using an SSH
  key pinned with `command=` so it can run that one script and nothing else. Restarts, verifies, and
  rolls back on failure. The build runs the full backend suite, so it pulls the test image first,
  as CI does (#287).
- **Frontend** (#38): builds, asserts the SPA fallback survived into the artifact, publishes to
  Netlify. It **replaces** Netlify's own git build — switch that off first, or two builds race for
  one site.

The owner-side setup in `docs/DEPLOY_PIPELINE_SETUP.md` is done, and both were dispatched green
against `main` on 2026-09-24, with the backend rollback proven against a deliberately broken build.
**Any push or merge to `main` now deploys to production.**

The order, the acceptance criteria and the reasoning are in `docs/CI_PLAN.md`; the decisions behind
them are an ADR in `docs/DECISIONS.md`, 2026-09-04.
