import { expect, test as setup } from '@playwright/test';
import { acquireToken, createProject, listProjectsByTag, purgeE2eData } from '../support/api';
import { dbTargetDescription, provisionE2eAdmin } from '../support/db';
import { E2E_ADMIN_USERNAME, TAG_SHARED } from '../support/env';
import { SEEDED_PROJECTS } from '../support/fixtures';

/**
 * Runs once before the journeys, as a Playwright *project* rather than `globalSetup`, so the
 * `webServer`s in playwright.config.ts are guaranteed to be up before any of this executes and
 * failures show up in the report like any other test.
 */

// Serial: seeding is meaningless if provisioning failed, and running it anyway would leave the
// database half-mutated by a setup that already knows it is broken.
setup.describe.configure({ mode: 'serial' });

setup('provision the E2E admin account', async () => {
  // The only direct database write in the whole suite -- see support/db.ts for why it has to
  // exist and what stops it from ever running anywhere but a local throwaway Postgres.
  console.log(`Provisioning "${E2E_ADMIN_USERNAME}" in ${dbTargetDescription}`);
  await provisionE2eAdmin();
});

setup('purge leftovers and seed fixture projects', async () => {
  // Everything from here on goes through the real API -- exercising the contract is the point.
  const token = await acquireToken();

  // Purge *before* seeding, not only in teardown: a run that was interrupted (Ctrl-C, a crashed
  // browser) leaves its rows behind, and "expect exactly one project with this tag" would then
  // fail on the next run for reasons that have nothing to do with the app.
  const purged = await purgeE2eData(token);
  if (purged.projects || purged.messages) {
    console.log(`Purged leftovers: ${purged.projects} project(s), ${purged.messages} message(s)`);
  }

  for (const project of SEEDED_PROJECTS) {
    await createProject(token, project);
  }

  // Assert the seed actually landed, rather than assuming a 201 means the list endpoint will
  // agree -- tag filtering goes through a different query path than the write.
  const seeded = await listProjectsByTag(TAG_SHARED);
  expect(seeded.map((p) => p.title).sort()).toEqual(SEEDED_PROJECTS.map((p) => p.title).sort());
});
