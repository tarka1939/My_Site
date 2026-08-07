import { expect, test, type Page } from '@playwright/test';
import {
  listAllContactMessages,
  purgeE2eContactMessages,
  requireCachedToken,
  type ContactMessage,
} from '../support/api';
import { E2E_EMAIL_DOMAIN } from '../support/env';

/**
 * Journeys 2 and 3 -- `SPEC.md` user story 3 (send a message via the contact form), plus the
 * rate-limit path that guards it.
 *
 * `ContactService` derives the rate limit from `count(*)` over `contact_message` rows in the
 * trailing hour, so both tests here mutate shared, persistent server state. Purging this
 * suite's own rows before each test reclaims the slots the suite itself used, which is what
 * makes the file rerunnable and order-independent instead of "passes once per hour".
 *
 * Note the limit of that: the count is keyed on `requester_ip_hash`, not on email, so the purge
 * reclaims only this suite's slots. Anything a developer submitted by hand from this machine
 * inside the trailing hour still occupies one, and nothing that stays inside the suite's own
 * namespace can free it. The rate-limit journey needs all five slots, so it checks that
 * precondition explicitly rather than failing mid-loop with a misleading 429.
 */

// ContactService: 5 messages per hour per requester IP hash.
const RATE_LIMIT = 5;

// ContactService.RATE_LIMIT_WINDOW.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Contact messages only -- deleting the seeded fixture projects here would pull the rug out
// from under the browse/filter journey, which shares this run's dataset.
test.beforeEach(async () => {
  await purgeE2eContactMessages(await requireCachedToken());
});

test('a visitor can submit the contact form and the message is persisted', async ({ page }) => {
  const email = `visitor${E2E_EMAIL_DOMAIN}`;
  const body = `Playwright journey 2 -- ${Date.now()}`;

  await page.goto('/contact');
  await expect(page.getByRole('heading', { name: 'Contact', level: 1 })).toBeVisible();

  // Client-side validation first: an empty form must not reach the API at all. Asserting on the
  // absence of a request rather than on an error message is deliberate -- the component only
  // renders field errors that came back from the server, so an invalid local submit is silent.
  let postCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/contact')) {
      postCount++;
    }
  });
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
  expect(postCount).toBe(0);

  await fillContactForm(page, { name: 'E2E Visitor', email, message: body });

  // Wait on the real response so the assertion is against an actual 201, not just a rendered
  // confirmation -- `PROJECT_TODO.md`'s Definition of Done is explicit about this.
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/contact') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Send message' }).click(),
  ]);
  expect(response.status()).toBe(201);
  expect(postCount).toBe(1);

  await expect(page.getByText("Thanks for reaching out")).toBeVisible();

  // ...and that it actually landed, read back through the admin API rather than trusting the
  // confirmation banner.
  const stored = await findMessage(email, body);
  expect(stored).toBeDefined();
  expect(stored!.name).toBe('E2E Visitor');
});

test('the contact form surfaces the backend rate limit after too many submissions', async ({
  page,
}) => {
  // Six full submissions, each needing its own page load (the component swaps the form out for
  // a confirmation once it succeeds). Well within reason, but not within the default timeout.
  test.slow();

  const email = `flooder${E2E_EMAIL_DOMAIN}`;

  // This journey needs the whole window, and `beforeEach` can only give back the part of it the
  // suite itself spent -- `ContactService` counts by requester IP hash regardless of email, so a
  // single message submitted by hand from this machine in the last hour already costs a slot and
  // the loop below would then get its 429 an iteration early. Asserted up front because the
  // failure it replaces ("expected 201, received 429" on submission 5) reads like an app bug
  // rather than a dirty database.
  //
  // Deliberately conservative: the API does not expose `requester_ip_hash`, so this cannot tell
  // which messages share this run's origin and assumes they all do. On a local stack -- the only
  // place this suite is allowed to run -- that is very nearly exact.
  const preexisting = (await listAllContactMessages(await requireCachedToken())).filter(
    (m) =>
      !m.email.endsWith(E2E_EMAIL_DOMAIN) &&
      Date.now() - Date.parse(m.createdAt) < RATE_LIMIT_WINDOW_MS,
  );
  expect(
    preexisting,
    `${preexisting.length} contact message(s) not created by this suite were submitted in the ` +
      `last hour. ContactService counts them against the same per-IP window this journey needs ` +
      `all ${RATE_LIMIT} slots of, and cleanup here only ever matches ${E2E_EMAIL_DOMAIN} ` +
      `addresses -- deleting a developer's real messages is not this suite's call. Wait for the ` +
      `window to roll over, or delete them yourself via DELETE /api/v1/contact-messages/{id}.`,
  ).toHaveLength(0);

  // Fill the window through the UI. Going through the browser matters: the backend keys the
  // limit on the requester IP it actually sees, which for browser traffic is the Angular dev
  // server's proxy, not this Node process.
  for (let i = 0; i < RATE_LIMIT; i++) {
    await page.goto('/contact');
    await fillContactForm(page, {
      name: 'E2E Flooder',
      email,
      message: `Playwright journey 3 -- submission ${i + 1}`,
    });
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/contact') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Send message' }).click(),
    ]);
    expect(response.status()).toBe(201);
    await expect(page.getByText("Thanks for reaching out")).toBeVisible();
  }

  await page.goto('/contact');
  await fillContactForm(page, {
    name: 'E2E Flooder',
    email,
    message: 'Playwright journey 3 -- one too many',
  });
  const [rejected] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/contact') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Send message' }).click(),
  ]);

  expect(rejected.status()).toBe(429);
  expect(await rejected.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });

  // The rejection has to reach the user, not just the network tab: errorInterceptor turns a 429
  // into a global notification, and the form must stay on screen rather than showing the
  // success state.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Too many contact messages' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.getByText("Thanks for reaching out")).toBeHidden();

  // Exactly the allowed number got through -- the 6th was rejected, not silently stored.
  const stored = (await listAllContactMessages(await requireCachedToken())).filter(
    (m) => m.email === email,
  );
  expect(stored).toHaveLength(RATE_LIMIT);
});

async function fillContactForm(
  page: Page,
  values: { name: string; email: string; message: string },
): Promise<void> {
  await page.getByRole('textbox', { name: 'Name' }).fill(values.name);
  await page.getByRole('textbox', { name: 'Email' }).fill(values.email);
  await page.getByRole('textbox', { name: 'Message' }).fill(values.message);
}

async function findMessage(email: string, message: string): Promise<ContactMessage | undefined> {
  const all = await listAllContactMessages(await requireCachedToken());
  return all.find((m) => m.email === email && m.message === message);
}
