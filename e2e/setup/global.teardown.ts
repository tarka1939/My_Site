import { test as teardown } from '@playwright/test';
import { purgeE2eData, requireCachedToken } from '../support/api';
import { removeE2eAdmin } from '../support/db';

/**
 * Leaves the local database as close to how the suite found it as possible. Correctness does
 * not depend on this running -- `global.setup.ts` purges before it seeds -- but a developer's
 * dev database shouldn't slowly fill with `[E2E]` rows, and an admin account whose password is
 * published in this repository should not outlive the run that needed it.
 */

teardown('remove fixture data and the E2E admin account', async () => {
  const token = await requireCachedToken();
  const purged = await purgeE2eData(token);
  console.log(`Removed ${purged.projects} project(s) and ${purged.messages} contact message(s)`);

  await removeE2eAdmin();
});
