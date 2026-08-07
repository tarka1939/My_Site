import { expect, test } from '@playwright/test';
import { TAG_ALPHA, TAG_SHARED } from '../support/env';
import { FIXTURE_ALPHA, FIXTURE_BETA } from '../support/fixtures';

/**
 * Journey 1 -- the primary visitor path from `SPEC.md`'s user stories 1 and 2:
 * browse projects -> filter by tag -> open a project's detail page.
 */
test('a visitor can browse projects, filter by tag, and open a project detail page', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();

  // Each card is an <a> wrapping the project's <h2>, so its accessible name is the title.
  // The seeded fixtures are the newest projects (the list sorts by createdAt DESC), so they
  // land on the first page even if the developer's database already has content of its own.
  const alphaCard = page.getByRole('link', { name: FIXTURE_ALPHA.title, exact: true });
  const betaCard = page.getByRole('link', { name: FIXTURE_BETA.title, exact: true });
  await expect(alphaCard).toBeVisible();
  await expect(betaCard).toBeVisible();

  // Filtering by a tag only one fixture carries is what makes this a real assertion: the filter
  // has to both keep Alpha and drop Beta. Asserting only "Alpha is still visible" would pass
  // even if the filter did nothing at all.
  const alphaFilter = page.getByRole('button', { name: TAG_ALPHA, exact: true });
  await expect(alphaFilter).toHaveAttribute('aria-pressed', 'false');
  await alphaFilter.click();

  await expect(alphaFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(alphaCard).toBeVisible();
  await expect(betaCard).toBeHidden();

  await alphaCard.click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  // Real rendered content, not just a URL change: the title, the description the API stored,
  // the project's tags, and its outbound link all have to survive the round trip.
  await expect(page.getByRole('heading', { name: FIXTURE_ALPHA.title, level: 1 })).toBeVisible();
  await expect(page.getByText(FIXTURE_ALPHA.description)).toBeVisible();

  // Tag *membership*, not order: the backend holds tags in a HashSet and hands them to
  // Set.copyOf, whose iteration order is randomized per JVM run -- so the rendered order is
  // stable within a backend process but can differ after a restart. The OpenAPI contract does
  // not promise an order either, so asserting one would be testing an accident.
  const tagList = page.getByRole('list', { name: 'Tags' });
  await expect(tagList.getByRole('listitem')).toHaveCount(2);
  await expect(tagList).toContainText(TAG_SHARED);
  await expect(tagList).toContainText(TAG_ALPHA);

  const sourceLink = page.getByRole('link', { name: FIXTURE_ALPHA.links![0].label });
  await expect(sourceLink).toHaveAttribute('href', FIXTURE_ALPHA.links![0].url);

  await page.getByRole('link', { name: 'Back to projects' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
});
