import { expect, test, type Page, type Response } from '@playwright/test';
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
 * `ContactService` allows 5 messages per hour per client IP, counted in the backend's memory
 * (`InMemoryRateLimiter`, since #309), and every submission below reaches the backend from the
 * same address: the Angular dev server's proxy, on loopback. So the two journeys share one budget
 * of 5 per backend per hour, and nothing this suite can do gives any of it back. Deleting
 * messages does not; only restarting the backend, or the hour passing, does.
 *
 * Both journeys are written around that. Journey 2 needs one slot and says plainly what to do
 * when there is none. Journey 3 spends whatever is left and asserts on the refusal, however many
 * submissions it took to reach it, so it holds on a fresh budget and on a spent one alike. The
 * exact number is pinned where it can be, in the backend's `ContactRateLimitIntegrationTest`.
 */

// ContactService.MAX_MESSAGES_PER_WINDOW, per ContactService.RATE_LIMIT_WINDOW (one hour).
const RATE_LIMIT = 5;

// Gives no budget back (see above). It is here so that journey 3's stored count starts from zero
// on every attempt, a CI retry or a rerun included, and so no attempt leaves rows for the next.
// Contact messages only -- deleting the seeded fixture projects here would pull the rug out from
// under the browse/filter journey, which shares this run's dataset.
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
    waitForContactPost(page),
    page.getByRole('button', { name: 'Send message' }).click(),
  ]);

  // A spent budget is not an application bug, and a bare "expected 201, received 429" reads like
  // one. It is what a second run inside the hour meets on a backend Playwright reused, since
  // journey 3 spends the rest of the budget every run.
  //
  // A retry of this test (CI's one) runs in a fresh worker *before* journey 3: Playwright runs a
  // retried job's tests in file order, so journey 3 has spent nothing yet. If the failed attempt's
  // submission got through, the retry spends one more slot and journey 3 makes do with fewer; if
  // the failure was this 429, the retry meets it again and fails with the same message.
  if (response.status() === 429) {
    throw new Error(
      `POST /api/v1/contact -> 429 Too Many Requests\n` +
        `ContactService allows ${RATE_LIMIT} contact messages per hour per IP, every submission ` +
        `here comes from the same loopback address, and the rate-limit journey spends whatever ` +
        `this one leaves, so a backend reused from an earlier run inside the hour has none (a ` +
        `message sent by hand through the dev server costs one too). The limiter is in-memory ` +
        `and deleting messages does not refund it: restart the backend, or wait out the hour.`,
    );
  }
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
  // Up to six full submissions, each needing its own page load (the component swaps the form out
  // for a confirmation once it succeeds). Well within reason, but not within the default timeout.
  test.slow();

  const email = `flooder${E2E_EMAIL_DOMAIN}`;

  // Submit until the backend refuses one. How many get through first depends on what is left of
  // this backend's budget, and every answer up to the limit is the limit working: 4 on a fresh
  // backend in a full run (journey 2 has spent one), 5 when this runs alone, and none on a spent
  // budget -- a reused backend inside the hour, or CI's retry of this test after an attempt that
  // reached the refusal. Then the refusal comes on the first try and is asserted exactly as a
  // later one would be. A sixth success is the one result that is not the limit working, so the
  // loop stops there. Going through the browser matters: the backend keys the limit on the
  // requester IP it actually sees, which for browser traffic is the dev server's proxy, not this
  // process.
  let accepted = 0;
  let rejected: Response | undefined;
  for (let attempt = 1; attempt <= RATE_LIMIT + 1; attempt++) {
    await page.goto('/contact');
    await fillContactForm(page, {
      name: 'E2E Flooder',
      email,
      message: `Playwright journey 3 -- submission ${attempt}`,
    });
    const [response] = await Promise.all([
      waitForContactPost(page),
      page.getByRole('button', { name: 'Send message' }).click(),
    ]);
    if (response.status() === 429) {
      rejected = response;
      break;
    }
    expect(response.status()).toBe(201);
    await expect(page.getByText("Thanks for reaching out")).toBeVisible();
    accepted++;
  }
  test.info().annotations.push({
    type: 'contact budget',
    description: `${accepted} submission(s) accepted before the 429`,
  });

  expect(
    rejected,
    `${RATE_LIMIT + 1} submissions in a row were accepted: the contact form's limit of ` +
      `${RATE_LIMIT} per hour is not being enforced.`,
  ).toBeDefined();
  expect(accepted).toBeLessThanOrEqual(RATE_LIMIT);
  expect(await rejected!.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });

  // The rejection has to reach the user, not just the network tab: errorInterceptor turns a 429
  // into a global notification, and the form must stay on screen rather than showing the
  // success state.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Too many contact messages' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.getByText("Thanks for reaching out")).toBeHidden();

  // Exactly the accepted ones were stored -- the refused one was rejected, not silently kept.
  // Exact because `beforeEach` emptied this address's messages before the attempt began.
  const stored = (await listAllContactMessages(await requireCachedToken())).filter(
    (m) => m.email === email,
  );
  expect(stored).toHaveLength(accepted);
});

function waitForContactPost(page: Page): Promise<Response> {
  return page.waitForResponse(
    (r) => r.url().includes('/api/v1/contact') && r.request().method() === 'POST',
  );
}

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
