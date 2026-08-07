import { test as teardown } from '@playwright/test';
import { discardCachedToken, purgeE2eData, requireCachedToken } from '../support/api';
import { removeE2eAdmin } from '../support/db';

/**
 * Leaves the local database as close to how the suite found it as possible. Correctness does
 * not depend on this running -- `global.setup.ts` purges before it seeds -- but a developer's
 * dev database shouldn't slowly fill with `[E2E]` rows, and an admin account whose password is
 * published in this repository should not outlive the run that needed it.
 *
 * That last promise is the reason this file is written the way it is rather than as three
 * sequential `await`s. Revoking the credentials must be **unconditional**, because the run most
 * likely to leave them behind is precisely the run that failed:
 *
 * - `global.setup.ts` inserts `e2e-admin` in its *first* test and acquires a token in its
 *   *second*. A failure in between -- `AuthService` allows 5 logins per 15 minutes per IP, so
 *   roughly the 5th run in a window gets a 429 -- leaves the row inserted and no token cached.
 * - Playwright still runs teardown after a failed setup. When `requireCachedToken()` was the
 *   first statement here, it threw, and every line below it was skipped: the published-password
 *   admin survived in `mysite_dev`, the same database `mvn spring-boot:run` uses.
 *
 * Neither revocation step needs a token, a reachable backend, or a successful purge -- both are
 * a direct DB delete and a file delete -- so nothing upstream is allowed to gate them. Failures
 * are collected rather than thrown in place, so an early one cannot skip a later step, and are
 * re-thrown at the end so a purge that silently stopped working still fails the run.
 */

/** Runs `step`, recording a failure instead of letting it abort the steps that follow. */
async function collect(failures: unknown[], step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    failures.push(error);
  }
}

teardown('remove fixture data and the E2E admin account', async () => {
  const failures: unknown[] = [];

  // Fixture data first: it is the only step that needs the token, which the steps below revoke.
  await collect(failures, async () => {
    const purged = await purgeE2eData(await requireCachedToken());
    console.log(`Removed ${purged.projects} project(s) and ${purged.messages} contact message(s)`);
  });

  // Both credentials, unconditionally. Deleting the row alone is not enough: the backend is a
  // stateless resource server that never re-checks the token's subject, so a cached JWT keeps
  // working for the rest of its hour.
  await collect(failures, removeE2eAdmin);
  await collect(failures, discardCachedToken);

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'E2E teardown failed at more than one step');
  }
});
