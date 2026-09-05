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

There is also an explicit `docker info` step before the backend tests. Thirteen test files use
Testcontainers, and `@Testcontainers` is deliberately *not* set to `disabledWithoutDocker` — so a
runner without Docker fails rather than skips, and the step names that cause instead of leaving a
confusing container error to be interpreted.

## Still to come

- **Backend deploy** on merge to `main` — #45. Ships the jar, restarts, verifies, rolls back on
  failure, using an SSH key restricted with `command=` so it can run one script and nothing else.
- **Frontend deploy** — #38. Only worth doing if it *replaces* Netlify's native build rather than
  racing it; running both would mean two builds competing for one site.

The order, the acceptance criteria and the reasoning are in `docs/CI_PLAN.md`; the decisions behind
them are an ADR in `docs/DECISIONS.md`, 2026-09-04.
