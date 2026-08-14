/**
 * Test-only helpers for reading and resetting the SEO meta tags in the document head.
 *
 * Meta tags are global state that outlives a component fixture: `SeoService` writes straight into
 * `document.head`, so without an explicit reset one test's description is still there for the next.
 * Every spec that touches SEO tags should call {@link clearSeoTags} in both `beforeEach` (so it
 * starts from a known head) and `afterEach` (so it leaves one).
 *
 * Deliberately free of `expect` assertions -- {@link seoTagCount} returns a number so each spec
 * asserts in its own voice, rather than hiding a failure inside a shared helper.
 */

/**
 * Every selector the runtime writes -- the meta tags in the `name=`/`property=` form `index.html`
 * declares them, plus the canonical link, which `SeoService` creates at runtime and `index.html`
 * deliberately does not carry.
 */
export const SEO_SELECTORS = [
  'link[rel="canonical"]',
  'meta[name="description"]',
  'meta[name="robots"]',
  'meta[name="twitter:card"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
  'meta[property="og:type"]',
  'meta[property="og:site_name"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:url"]',
] as const;

/** Removes every SEO tag from the head, including duplicates a regression would have created. */
export function clearSeoTags(): void {
  for (const selector of SEO_SELECTORS) {
    for (const tag of document.head.querySelectorAll(selector)) {
      tag.remove();
    }
  }
}

/** All tags matching `selector`, in document order. More than one is itself the bug. */
export function seoTags(selector: string): Element[] {
  return [...document.head.querySelectorAll(selector)];
}

/** How many tags match `selector` -- 1 for a tag in use, 0 for one correctly removed. */
export function seoTagCount(selector: string): number {
  return document.head.querySelectorAll(selector).length;
}

/**
 * The `content` of the *first* tag matching `selector`, or `null` if there is none.
 *
 * First rather than last on purpose: that is the one a crawler reads, so if a regression appends a
 * duplicate, this returns the stale value the crawler would actually get.
 */
export function seoContent(selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

/**
 * The `href` of the canonical link, or `null` if there is none.
 *
 * Separate from {@link seoContent} because a `<link>` carries its value in `href`, not `content` --
 * reading it with the wrong attribute returns `null`, which looks exactly like "no canonical".
 */
export function canonicalHref(): string | null {
  return document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
}

/**
 * Seeds the subset of `index.html`'s static tags that the runtime overwrites, so replacement can be
 * tested against the real starting state rather than an empty head. The unit-test harness page is
 * not `index.html`, so nothing else puts them there.
 */
export function seedStaticSeoTags(description = 'STATIC SITE DESCRIPTION'): void {
  document.head.insertAdjacentHTML(
    'beforeend',
    `<meta name="description" content="${description}">
     <meta property="og:type" content="website">
     <meta property="og:title" content="My Site — project portfolio">
     <meta property="og:description" content="${description}">
     <meta property="og:url" content="https://REPLACE-WITH-CANONICAL-ORIGIN.invalid/">
     <meta name="twitter:card" content="summary">
     <meta name="twitter:title" content="My Site — project portfolio">
     <meta name="twitter:description" content="${description}">`,
  );
}
