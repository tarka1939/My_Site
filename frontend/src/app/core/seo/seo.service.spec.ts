import { TestBed } from '@angular/core/testing';
import { SeoService } from './seo.service';
import { META_DESCRIPTION_MAX_CHARS, SITE_DESCRIPTION, SITE_NAME } from './site-meta';

/** Every selector the service owns, in the `name=`/`property=` form `index.html` declares them. */
const SEO_SELECTORS = [
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
];

function clearSeoTags(): void {
  for (const selector of SEO_SELECTORS) {
    for (const tag of document.head.querySelectorAll(selector)) {
      tag.remove();
    }
  }
}

function tags(selector: string): Element[] {
  return [...document.head.querySelectorAll(selector)];
}

function content(selector: string): string | null {
  const found = tags(selector);
  expect(found).toHaveLength(1); // never two: that is the bug this whole suite exists to catch
  return found[0].getAttribute('content');
}

/**
 * The subset of `index.html`'s static tags that the runtime overwrites, seeded into the test
 * document so replacement can be tested against the real starting state rather than an empty head.
 */
function seedStaticTags(description = 'STATIC SITE DESCRIPTION'): void {
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

describe('SeoService', () => {
  const originalTitle = document.title;

  beforeEach(() => clearSeoTags());

  afterEach(() => {
    clearSeoTags();
    document.title = originalTitle;
  });

  function createService(): SeoService {
    // Constructed here rather than in beforeEach: the service captures the document's description
    // at construction, so tests that seed static tags must do it first.
    return TestBed.inject(SeoService);
  }

  it('writes a page description into the description, og and twitter tags together', () => {
    createService().applyPage({ title: 'My Site - Contact', description: 'Say hello.' });

    expect(content('meta[name="description"]')).toBe('Say hello.');
    expect(content('meta[property="og:description"]')).toBe('Say hello.');
    expect(content('meta[name="twitter:description"]')).toBe('Say hello.');
    expect(document.title).toBe('My Site - Contact');
    expect(content('meta[property="og:title"]')).toBe('My Site - Contact');
    expect(content('meta[name="twitter:title"]')).toBe('My Site - Contact');
  });

  it('rewrites the static tags in place rather than appending a second set', () => {
    // The failure mode: `addTag` (or a selector that does not match index.html's attribute) leaves
    // the static tag first in the document and the fresh one after it. A scraper reads the first,
    // so the page would silently keep advertising the site-level description forever.
    seedStaticTags();
    createService().applyPage({ title: 'My Site - Projects', description: 'The portfolio.' });

    expect(tags('meta[name="description"]')).toHaveLength(1);
    expect(tags('meta[property="og:description"]')).toHaveLength(1);
    expect(tags('meta[name="twitter:description"]')).toHaveLength(1);
    expect(content('meta[name="description"]')).toBe('The portfolio.');
    expect(content('meta[property="og:title"]')).toBe('My Site - Projects');

    // Tags the runtime does not own must survive untouched -- they are the ones a non-JS scraper
    // relies on, and og:type/twitter:card are only ever declared statically.
    expect(content('meta[property="og:type"]')).toBe('website');
    expect(content('meta[name="twitter:card"]')).toBe('summary');
  });

  it('keeps exactly one tag per selector across repeated applications', () => {
    const seo = createService();

    seo.applyPage({ title: 'One', description: 'First.' });
    seo.applyPage({ title: 'Two', description: 'Second.' });
    seo.applyPage({ title: 'Three', description: 'Third.' });

    expect(tags('meta[name="description"]')).toHaveLength(1);
    expect(tags('meta[property="og:description"]')).toHaveLength(1);
    expect(tags('meta[name="twitter:description"]')).toHaveLength(1);
    expect(tags('meta[property="og:title"]')).toHaveLength(1);
    expect(content('meta[name="description"]')).toBe('Third.');
  });

  it('restores the static site description for a page that declares none', () => {
    // Without this, a page with no description of its own inherits whatever the previous page set
    // -- so leaving a project and landing on the contact form would describe the contact form as
    // the project. The fallback is what makes per-page tags safe to set at all.
    seedStaticTags('STATIC SITE DESCRIPTION');
    const seo = createService();

    seo.applyPage({ description: 'A specific project.' });
    expect(content('meta[name="description"]')).toBe('A specific project.');

    seo.applyPage({ title: 'My Site - Contact' });
    expect(content('meta[name="description"]')).toBe('STATIC SITE DESCRIPTION');
    expect(content('meta[property="og:description"]')).toBe('STATIC SITE DESCRIPTION');
  });

  it('falls back to the built-in description only when the document declares none', () => {
    // No seeded tags: the harness page has no description, which is the only case the constant is
    // for. It exists so tests and any non-index.html host still get a sentence rather than ''.
    createService().applyPage({ title: 'My Site' });

    expect(content('meta[name="description"]')).toBe(SITE_DESCRIPTION);
  });

  it('treats a blank or whitespace-only description as absent', () => {
    seedStaticTags('STATIC SITE DESCRIPTION');
    const seo = createService();

    seo.applyPage({ description: '   \n\t  ' });
    expect(content('meta[name="description"]')).toBe('STATIC SITE DESCRIPTION');

    seo.applyPage({ description: null });
    expect(content('meta[name="description"]')).toBe('STATIC SITE DESCRIPTION');
  });

  it('truncates a long description to the meta budget, on a word boundary', () => {
    const long = `${'word '.repeat(200)}end`;

    createService().applyPage({ description: long });

    const written = content('meta[name="description"]')!;
    // +1 for the appended ellipsis, which is deliberately outside the character budget.
    expect(written.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX_CHARS + 1);
    expect(written.endsWith('…')).toBe(true);
    expect(written).not.toMatch(/wor…$/); // cut between words, not through one
  });

  it('collapses newlines and takes only the first paragraph', () => {
    createService().applyPage({
      description: 'Opening line one\nline two.\n\nA second paragraph nobody asked for.',
    });

    expect(content('meta[name="description"]')).toBe('Opening line one line two.');
  });

  it('stores quotes, angle brackets and ampersands verbatim without injecting markup', () => {
    // A description is admin-authored free text (openapi.yaml allows 5000 characters of anything),
    // so it can contain the exact characters that terminate an HTML attribute. Meta writes through
    // setAttribute, which takes a string rather than markup, so the value round-trips and the
    // browser escapes it on serialisation. Building the tag by string concatenation instead --
    // head.innerHTML += ... -- would break out of the attribute here.
    const nasty = 'He said "hi" & <script>alert(1)</script> — 5 < 6';
    const scriptsBefore = document.querySelectorAll('script').length;

    createService().applyPage({ description: nasty });

    expect(content('meta[name="description"]')).toBe(nasty);
    expect(content('meta[property="og:description"]')).toBe(nasty);
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);

    // Serialised markup: the quote must come back as an entity, or the attribute would end early.
    const markup = tags('meta[name="description"]')[0].outerHTML;
    expect(markup).toContain('&quot;');
    expect(markup).toContain('&amp;');
    expect(markup).not.toContain('content="He said "hi"');
  });

  it('points og:url at the live origin and path, dropping query and fragment', () => {
    createService().applyPage({ url: '/projects/abc?tag=dsp&page=2#gallery' });

    expect(content('meta[property="og:url"]')).toBe(`${location.origin}/projects/abc`);
  });

  it('leaves the static og:url placeholder alone when the page has no url', () => {
    seedStaticTags();
    createService().applyPage({ description: 'No url supplied.' });

    expect(content('meta[property="og:url"]')).toBe('https://REPLACE-WITH-CANONICAL-ORIGIN.invalid/');
  });

  it('adds a robots tag on request and removes it again on the next page', () => {
    // The removal half is the one that silently de-indexes a site: navigate /admin -> / and a
    // leftover noindex tells the crawler the public landing page is off limits.
    const seo = createService();

    seo.applyPage({ title: 'My Site - Admin login', robots: 'noindex, nofollow' });
    expect(content('meta[name="robots"]')).toBe('noindex, nofollow');

    seo.applyPage({ title: 'My Site - Projects' });
    expect(tags('meta[name="robots"]')).toHaveLength(0);
  });

  it('falls back to the site name when a page declares no title', () => {
    const seo = createService();

    seo.applyPage({ title: 'My Site - Contact' });
    seo.applyPage({});

    expect(document.title).toBe(SITE_NAME);
    expect(content('meta[property="og:title"]')).toBe(SITE_NAME);
  });
});
