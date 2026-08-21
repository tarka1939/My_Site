import { expect, test } from '@playwright/test';
import { listProjectsByTag, purgeE2eProjectsByTag, requireCachedToken } from '../support/api';
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_USERNAME,
  E2E_TITLE_PREFIX,
  TAG_ADMIN_CREATED,
} from '../support/env';
import { stubFixtureImages } from '../support/images';

/**
 * Journey 4 -- `SPEC.md`'s admin content-management story, end to end through the UI:
 * log in -> create a project -> see it on the public site -> log out -> the guard locks the
 * admin area again.
 *
 * The account this logs in with is provisioned by `setup/global.setup.ts`; see `support/db.ts`
 * for why that has to bypass the API.
 */

/**
 * Makes the test idempotent across attempts, which `retries: 1` under CI requires.
 *
 * This journey creates a project through the UI and then asserts that exactly one project
 * carries `TAG_ADMIN_CREATED`. `TAG_ADMIN_CREATED` is fixed (per `support/env.ts`, unique
 * per-run tags would leave orphan rows in the filter UI), and nothing runs between a failed
 * attempt and its retry -- `setup` has already been and gone. So once the POST has succeeded,
 * a retry that fails for any *later* reason used to be unwinnable: it would create a second
 * project under the same tag and die on `toHaveLength(1)` with "expected 1, received 2", a
 * message that points at a double submit rather than at whatever actually broke.
 *
 * Purging before each attempt rather than after each one is deliberate: an attempt killed hard
 * enough to skip its own cleanup still cannot poison the next. Same reasoning as
 * `global.setup.ts` purging before it seeds.
 */
test.beforeEach(async () => {
  await purgeE2eProjectsByTag(await requireCachedToken(), TAG_ADMIN_CREATED);
});
test('an admin can log in, publish a project, and log back out', async ({ page }) => {
  const title = `${E2E_TITLE_PREFIX} Admin-created ${Date.now()}`;
  const description = 'Created through the admin UI by the Playwright E2E suite.';

  // This journey reaches the public project list further down, where the seeded Alpha fixture's
  // thumbnail points at a deliberately unresolvable `.invalid` host. Serve it locally rather than
  // spending a DNS failure on every card image -- see support/images.ts.
  await stubFixtureImages(page);

  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'Admin login', level: 1 })).toBeVisible();

  await page.getByRole('textbox', { name: 'Username' }).fill(E2E_ADMIN_USERNAME);
  await page.getByLabel('Password').fill(E2E_ADMIN_PASSWORD);

  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/login') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);
  expect(loginResponse.status()).toBe(200);

  // `/admin` redirects to `/admin/projects`; reaching it at all means authGuard let us through.
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(page.getByRole('heading', { name: 'Manage projects', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

  await page.getByRole('link', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: 'New project', level: 1 })).toBeVisible();

  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Description' }).fill(description);
  await page.getByRole('textbox', { name: 'Tags' }).fill(TAG_ADMIN_CREATED);
  // The seeded fixtures cover *reading* a period; this covers writing one, which is a different
  // path end to end (<input type="date"> -> form value -> POST body -> date column). Left ongoing
  // deliberately: a null completedOn is the state the admin form has to be able to produce, and
  // an empty completion input is the only way to say it -- so leaving the field alone is the
  // assertion, and the persisted null below is what proves it was not filled in for us.
  await page.getByLabel('Start date').fill('2025-11-01');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/projects') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Save project' }).click(),
  ]);
  // A 201 specifically, not merely "the page navigated" -- a silently-swallowed failure would
  // otherwise still leave the form's success path looking plausible.
  expect(createResponse.status()).toBe(201);

  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(page.getByRole('cell', { name: title })).toBeVisible();

  // The write also has to be visible to an anonymous visitor, which is a different code path
  // (public list endpoint, no bearer token) than the admin table above.
  await page.goto('/');
  await page.getByRole('button', { name: TAG_ADMIN_CREATED, exact: true }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(1);

  // The date the admin typed survives to the public page, at month precision and announced as
  // ongoing rather than trailing off after the start.
  const publishedCard = page.getByRole('listitem').filter({ hasText: title });
  await expect(publishedCard.locator('time')).toHaveText(['November 2025']);
  await expect(publishedCard.locator('time')).toHaveAttribute('datetime', '2025-11');
  await expect(publishedCard).toContainText('ongoing');

  // ...and it really is one persisted project, not two from a double submit. Trustworthy as a
  // double-submit check only because `beforeEach` guarantees the tag started this attempt empty.
  const persisted = await listProjectsByTag(TAG_ADMIN_CREATED);
  expect(persisted).toHaveLength(1);
  // Day precision in storage, month/year in the UI -- so the stored value keeps the day the form
  // sent, and the null completion is a real null rather than an empty string coerced somewhere.
  expect(persisted[0].startedOn).toBe('2025-11-01');
  expect(persisted[0].completedOn).toBeNull();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden();

  // The real point of logging out: the guard has to lock the admin area again, and hand the
  // attempted destination back as returnUrl rather than dropping it.
  await page.goto('/admin/projects');
  await expect(page).toHaveURL(/\/admin\/login\?returnUrl=%2Fadmin%2Fprojects$/);
  await expect(page.getByRole('heading', { name: 'Admin login', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manage projects' })).toBeHidden();
});
