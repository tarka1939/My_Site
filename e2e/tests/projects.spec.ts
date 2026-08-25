import { expect, test } from '@playwright/test';
import { TAG_ALPHA, TAG_SHARED } from '../support/env';
import {
  ALT_TEXT_MUST_NOT_CLAIM,
  CARD_DESCRIPTION_CLAMP_LINES,
  FIXTURE_ALPHA,
  FIXTURE_ALPHA_CARD_TEXT,
  FIXTURE_ALPHA_IMAGES,
  FIXTURE_ALPHA_IMAGE_ALTS,
  FIXTURE_ALPHA_PERIOD,
  FIXTURE_BETA,
  FIXTURE_BETA_PERIOD,
} from '../support/fixtures';
import { waitForFontsReady } from '../support/fonts';
import { stubFixtureImages } from '../support/images';

/**
 * Journey 1 -- the primary visitor path from `SPEC.md`'s user stories 1 and 2:
 * browse projects -> filter by tag -> open a project's detail page.
 */
test('a visitor can browse projects, filter by tag, and open a project detail page', async ({
  page,
}) => {
  await stubFixtureImages(page);
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

  // --- The card summarises a long description rather than reprinting it (issue #86) -------------
  //
  // Located by class, against this suite's own "prefer role- and label-based locators" rule,
  // because there is no alternative: a card holds two <p> elements (the period and the summary)
  // and a paragraph carries no role, name or label to tell them apart. The exception is noted
  // rather than quietly taken.
  const alphaDescription = alphaItem.locator('p.card-description');
  await expect(alphaDescription).toBeVisible();

  // `textContent`, not `innerText`: what is under test here is the *payload* the excerpt pipe put
  // into the DOM -- the text a screen reader announces and the bytes the page ships -- not the
  // portion the CSS clamp leaves visible. Those are two different bounds and the next block
  // asserts the other one. Safe in this element specifically: it is a single interpolated text
  // node with no `aria-hidden` or `visually-hidden` siblings to concatenate.
  const cardExcerpt = (await alphaDescription.textContent()) ?? '';

  expect(cardExcerpt, 'the card must summarise a long description, not reprint it').toMatch(/…$/);
  expect(cardExcerpt.length).toBeLessThan(FIXTURE_ALPHA_CARD_TEXT.firstParagraph.length);

  // A prefix of the opening paragraph, cut somewhere -- deliberately not an equality check against
  // an expected excerpt string. That would pin `CARD_EXCERPT_MAX_CHARS` in a second place and make
  // tuning a purely visual cap fail a journey. Where the cut lands is the unit tests' business;
  // that there is a cut at all, and that it never runs past the paragraph it started in, is this
  // suite's.
  const excerptBody = cardExcerpt.replace(/…$/, '');
  expect(
    FIXTURE_ALPHA_CARD_TEXT.firstParagraph.startsWith(excerptBody),
    `card excerpt is not a prefix of the fixture's first paragraph: ${JSON.stringify(excerptBody)}`,
  ).toBe(true);

  // Text past the cut, and text from a later paragraph, must not reach a card at all.
  for (const marker of FIXTURE_ALPHA_CARD_TEXT.hiddenOnCard) {
    expect(cardExcerpt).not.toContain(marker);
  }

  // Beta is the control: short enough that no cap can bind, so its card carries the description
  // whole and with no ellipsis. Without this, "the excerpt truncates" would be indistinguishable
  // from "the excerpt always truncates".
  const betaDescription = betaItem.locator('p.card-description');
  await expect(betaDescription).toHaveText(FIXTURE_BETA.description);

  // --- The stylesheet clamps the summary to N rendered lines ------------------------------------
  //
  // THE assertion this fixture exists for. `-webkit-box-orient: vertical` was once deleted and the
  // whole Vitest suite stayed green: jsdom resolves the cascade but performs no layout, so it can
  // see `line-clamp: 3` on the element and never that the element is eight lines tall. A real
  // browser is the only place the difference exists, so measure the *box*, never the declaration --
  // asserting `-webkit-line-clamp: 3` is present is precisely the check that passed while the bug
  // was live.
  //
  // The wait is not optional. This assertion's stability used to rest on the site being `system-ui`
  // with no webfonts, so there was no font swap to race; the 2026-08-22 visual direction self-hosts
  // Archivo and IBM Plex at `font-display: swap` and that assumption is gone. Measuring mid-swap
  // would compare a fallback's line count against a webfont's -- which is exactly the kind of
  // failure that looks like flake, gets re-run, and passes.
  await waitForFontsReady(page);

  const clamp = await alphaDescription.evaluate((el) => {
    const rendered = el.getBoundingClientRect();

    // What the same text needs *without* the clamp, measured rather than assumed, so the test
    // states its own precondition: if the fixture ever stops overflowing three lines then a
    // three-line box proves nothing, and that must fail loudly instead of passing vacuously.
    // The clone is absolutely positioned, hidden, pinned to the live element's width, and removed
    // inside this same synchronous block -- it never reflows the card and nothing can observe it.
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.width = `${rendered.width}px`;
    clone.style.display = 'block';
    clone.style.overflow = 'visible';
    clone.style.maxHeight = 'none';
    // Both spellings: the prefixed property and the standard one that newer Chromium honours on a
    // block container. Neutralising only one would leave the "unclamped" measurement clamped.
    clone.style.setProperty('-webkit-line-clamp', 'none');
    clone.style.setProperty('line-clamp', 'none');
    el.parentElement?.appendChild(clone);
    const naturalHeight = clone.getBoundingClientRect().height;
    clone.remove();

    return {
      lineHeight: getComputedStyle(el).lineHeight,
      renderedHeight: rendered.height,
      naturalHeight,
    };
  });

  // `line-height: normal` computes to the string "normal" and would silently make every division
  // below NaN, which compares false against everything and reads like a layout failure.
  expect(clamp.lineHeight, 'need a resolved px line-height to count lines').toMatch(/^[\d.]+px$/);
  const lineHeight = Number.parseFloat(clamp.lineHeight);
  const naturalLines = Math.round(clamp.naturalHeight / lineHeight);
  const renderedLines = Math.round(clamp.renderedHeight / lineHeight);

  expect(
    naturalLines,
    `the fixture description no longer overflows ${CARD_DESCRIPTION_CLAMP_LINES} lines at this ` +
      `card width, so the clamp assertion below would pass without the clamp doing anything`,
  ).toBeGreaterThan(CARD_DESCRIPTION_CLAMP_LINES);
  expect(
    renderedLines,
    `card description renders ${renderedLines} lines (unclamped it would be ${naturalLines}); ` +
      `the line clamp in projects-list.component.scss is not laying out`,
  ).toBe(CARD_DESCRIPTION_CLAMP_LINES);

  // --- Card thumbnails --------------------------------------------------------------------------
  //
  // Alpha's thumbnail is decorative by W3C/WAI's test -- it sits inside a link whose visible text is
  // already the project title -- so it must carry `alt=""` and stay out of the accessibility tree.
  // `getByRole('img')` therefore cannot find it, which is itself the assertion: a non-empty alt here
  // would make the link announce the title twice.
  const alphaThumbnail = alphaItem.locator('img');
  await expect(alphaThumbnail).toHaveCount(1);
  await expect(alphaThumbnail).toHaveAttribute('alt', '');
  await expect(alphaThumbnail).toHaveAttribute('src', FIXTURE_ALPHA_IMAGES[0]);
  await expect(alphaItem.getByRole('img')).toHaveCount(0);

  // Beta has no images, so its card must render no <img> at all -- not one with an empty src.
  await expect(betaItem.locator('img')).toHaveCount(0);

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

  // The whole description, every paragraph of it -- the other half of the excerpt claim. The card
  // is allowed to cut only because this page does not: both markers the card had to suppress have
  // to be here. Class locator for the same reason as on the card: the article holds two <p>
  // elements and a paragraph has no role or name.
  const detailDescription = page.locator('p.description');
  await expect(detailDescription).toHaveText(FIXTURE_ALPHA.description);
  for (const marker of FIXTURE_ALPHA_CARD_TEXT.hiddenOnCard) {
    await expect(detailDescription).toContainText(marker);
  }
  await expect(detailDescription).toContainText(FIXTURE_ALPHA_CARD_TEXT.lastParagraphMarker);

  // --- Gallery alt text (issue #87) -------------------------------------------------------------
  //
  // Looked up *by accessible name*, which is the assertion: this is the string a screen reader
  // announces, and `getByRole('img', { name })` fails if the alt text is wrong in any way that
  // matters to a reader. The position clause ("image 1 of 2") is why the fixture carries two
  // images -- with one, the alt text is the title alone and there is no position to get wrong.
  const gallery = page.getByRole('list', { name: 'Project images' });
  await expect(gallery.getByRole('img')).toHaveCount(2);
  for (const [index, alt] of FIXTURE_ALPHA_IMAGE_ALTS.entries()) {
    const image = gallery.getByRole('img', { name: alt, exact: true });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', FIXTURE_ALPHA_IMAGES[index]);
  }

  // Nothing anywhere on the page may claim to know what an image *contains*. The frontend has no
  // per-image metadata to know it from -- `images` is a bare array of URLs -- so "screenshot" was
  // a confident falsehood for entries whose images are architecture diagrams. Swept over every
  // <img> in the article rather than the two above, so a future image somewhere else in the
  // template inherits the rule instead of escaping it.
  const alts = await page
    .getByRole('article')
    .locator('img')
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).alt));
  expect(alts).toHaveLength(2);
  for (const alt of alts) {
    expect(alt, 'alt text must not claim what an image contains').not.toMatch(
      ALT_TEXT_MUST_NOT_CLAIM,
    );
  }

  // The images really decode, so the gallery lays out at an image's size rather than at a
  // broken-image placeholder. Polled: `src` is set at render, the bytes arrive from
  // `stubFixtureImages` a tick later.
  await expect
    .poll(() =>
      gallery
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);

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
