import { expect, test } from '@playwright/test';
import { TAG_ALPHA, TAG_SHARED } from '../support/env';
import {
  FIXTURE_ALPHA,
  FIXTURE_ALPHA_PERIOD,
  FIXTURE_BETA,
  FIXTURE_BETA_PERIOD,
} from '../support/fixtures';

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

  // Both period states on one screen, which is the point of seeding one closed and one ongoing
  // project: a completed span, and a start whose null completion has to read as a claim
  // ("ongoing") rather than as a gap. Asserted through <time> rather than a styling hook -- the
  // datetime attribute is the machine-readable half of the same statement, and asserting it is how
  // the suite proves the stored day never reaches a reader: '2024-03', never '2024-03-01'.
  const alphaItem = page.getByRole('listitem').filter({ hasText: FIXTURE_ALPHA.title });
  const alphaDates = alphaItem.locator('time');
  await expect(alphaDates).toHaveText([
    FIXTURE_ALPHA_PERIOD.start.text,
    FIXTURE_ALPHA_PERIOD.end.text,
  ]);
  await expect(alphaDates.nth(0)).toHaveAttribute('datetime', FIXTURE_ALPHA_PERIOD.start.datetime);
  await expect(alphaDates.nth(1)).toHaveAttribute('datetime', FIXTURE_ALPHA_PERIOD.end.datetime);

  const betaItem = page.getByRole('listitem').filter({ hasText: FIXTURE_BETA.title });
  // One date, not two: an ongoing project must not render a second, empty <time>.
  await expect(betaItem.locator('time')).toHaveText([FIXTURE_BETA_PERIOD.start.text]);
  await expect(betaItem.locator('time')).toHaveAttribute(
    'datetime',
    FIXTURE_BETA_PERIOD.start.datetime,
  );
  await expect(betaItem).toContainText(FIXTURE_BETA_PERIOD.ongoingLabel);

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

  // The detail page renders the period from its own endpoint (GET /projects/{id}), not from the
  // list payload, so it is a genuinely separate path rather than a repeat of the assertion above.
  const detailDates = page.getByRole('article').locator('time');
  await expect(detailDates).toHaveText([
    FIXTURE_ALPHA_PERIOD.start.text,
    FIXTURE_ALPHA_PERIOD.end.text,
  ]);
  await expect(detailDates.nth(0)).toHaveAttribute('datetime', FIXTURE_ALPHA_PERIOD.start.datetime);
  await expect(detailDates.nth(1)).toHaveAttribute('datetime', FIXTURE_ALPHA_PERIOD.end.datetime);

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
