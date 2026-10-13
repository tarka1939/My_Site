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

The image gets the same treatment (#285). A step pulls it before Maven runs, reading the name from
`TestPostgres.java`, so a Docker Hub refusal fails within minutes at a step named for the pull. On
2026-10-09 the same refusal cost 45 minutes of retries, and then showed up as 9 errored test classes.
Ryuk, Testcontainers' cleanup container, is switched off for the Maven step
(`TESTCONTAINERS_RYUK_DISABLED`). Its image was the job's only other Docker Hub pull, and a runner
is discarded after the job anyway. After those two changes, the image pull is the job's only
contact with Docker Hub.

## `deploy-backend.yml` and `deploy-frontend.yml` — live on `main`

Both run on push to `main` and by hand (`workflow_dispatch`), in a `production` environment, one at
a time and never cancelled midway. Issue #196.

- **Backend** (#45): builds the jar and ships it over **stdin** to `deploy/deploy.sh`, using an SSH
  key pinned with `command=` so it can run that one script and nothing else. Restarts, verifies, and
  rolls back on failure.
- **Frontend** (#38): builds, asserts the SPA fallback survived into the artifact, publishes to
  Netlify. It **replaces** Netlify's own git build — switch that off first, or two builds race for
  one site.

The owner-side setup in `docs/DEPLOY_PIPELINE_SETUP.md` is done, and both were dispatched green
against `main` on 2026-09-24, with the backend rollback proven against a deliberately broken build.
**Any push or merge to `main` now deploys to production.**

The order, the acceptance criteria and the reasoning are in `docs/CI_PLAN.md`; the decisions behind
them are an ADR in `docs/DECISIONS.md`, 2026-09-04.
