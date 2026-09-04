import { TestBed } from '@angular/core/testing';
import {
  canonicalHref,
  clearSeoTags,
  seedStaticSeoTags as seedStaticTags,
  seoContent as content,
  seoTagCount,
  seoTags as tags,
} from '../../../testing/seo-tags';
import { SeoService } from './seo.service';
import { META_DESCRIPTION_MAX_CHARS, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from './site-meta';

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
    createService().applyPage({ title: 'Krzysztof Tarka - Contact', description: 'Say hello.' });

    expect(content('meta[name="description"]')).toBe('Say hello.');
    expect(content('meta[property="og:description"]')).toBe('Say hello.');
    expect(content('meta[name="twitter:description"]')).toBe('Say hello.');
    expect(document.title).toBe('Krzysztof Tarka - Contact');
    expect(content('meta[property="og:title"]')).toBe('Krzysztof Tarka - Contact');
    expect(content('meta[name="twitter:title"]')).toBe('Krzysztof Tarka - Contact');
  });

  it('rewrites the static tags in place rather than appending a second set', () => {
    // The failure mode: `addTag` (or a selector that does not match index.html's attribute) leaves
    // the static tag first in the document and the fresh one after it. A scraper reads the first,
    // so the page would silently keep advertising the site-level description forever.
    seedStaticTags();
    createService().applyPage({ title: 'Krzysztof Tarka - Projects', description: 'The portfolio.' });

    expect(seoTagCount('meta[name="description"]')).toBe(1);
    expect(seoTagCount('meta[property="og:description"]')).toBe(1);
    expect(seoTagCount('meta[name="twitter:description"]')).toBe(1);
    expect(content('meta[name="description"]')).toBe('The portfolio.');
    expect(content('meta[property="og:title"]')).toBe('Krzysztof Tarka - Projects');

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

    expect(seoTagCount('meta[name="description"]')).toBe(1);
    expect(seoTagCount('meta[property="og:description"]')).toBe(1);
    expect(seoTagCount('meta[name="twitter:description"]')).toBe(1);
    expect(seoTagCount('meta[property="og:title"]')).toBe(1);
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

    seo.applyPage({ title: 'Krzysztof Tarka - Contact' });
    expect(content('meta[name="description"]')).toBe('STATIC SITE DESCRIPTION');
    expect(content('meta[property="og:description"]')).toBe('STATIC SITE DESCRIPTION');
  });

  it('captures a static description full of quotes and markup as its fallback, intact', () => {
    // index.html's description is admin-authored prose and can legitimately contain the characters
    // that terminate an HTML attribute. This asserts the capture survives them -- and doubles as
    // the guard on seedStaticSeoTags, which builds the seeded tags with setAttribute: interpolated
    // into markup instead, the first quote here would end the attribute and the seeded head would
    // quietly be something other than what this test asked for.
    const nasty = 'He said "hi" & <script>alert(1)</script> — 5 < 6';
    const scriptsBefore = document.querySelectorAll('script').length;
    seedStaticTags(nasty);
    const seo = createService();

    expect(content('meta[name="description"]')).toBe(nasty);
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);

    seo.applyPage({ description: 'A specific project.' });
    seo.applyPage({ title: 'Krzysztof Tarka - Contact' });

    expect(content('meta[name="description"]')).toBe(nasty);
  });

  it('falls back to the built-in description only when the document declares none', () => {
    // No seeded tags: the harness page has no description, which is the only case the constant is
    // for. It exists so tests and any non-index.html host still get a sentence rather than ''.
    createService().applyPage({ title: 'Krzysztof Tarka' });

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

  it('writes a self-referencing canonical link for the page being viewed', () => {
    // Netlify answers every path with 200 and the same shell, so without this a crawler can treat
    // any decorated or invented URL as its own page. Same origin+path as og:url, query and fragment
    // dropped -- a canonical that differs from og:url would be two answers to the same question.
    createService().applyPage({ url: '/projects/abc?tag=dsp&page=2#gallery' });

    expect(canonicalHref()).toBe(`${location.origin}/projects/abc`);
    expect(canonicalHref()).toBe(content('meta[property="og:url"]'));
  });

  it('rewrites the canonical link across navigations instead of adding a second one', () => {
    // Google discards *all* canonicals on a page that declares more than one, so an appended
    // duplicate does not merely point somewhere stale -- it turns the tag off entirely.
    const seo = createService();

    seo.applyPage({ url: '/' });
    seo.applyPage({ url: '/contact' });
    seo.applyPage({ url: '/projects/abc' });

    expect(seoTagCount('link[rel="canonical"]')).toBe(1);
    expect(canonicalHref()).toBe(`${location.origin}/projects/abc`);
  });

  it('writes no canonical at all for a page with no url', () => {
    // index.html carries no canonical on purpose -- the only origin it could name is the
    // unresolvable placeholder, and a canonical pointing at a host that does not exist is a worse
    // instruction than none. So "no url" must leave the document without one, not invent one.
    seedStaticTags();
    createService().applyPage({ description: 'No url supplied.' });

    expect(canonicalHref()).toBeNull();
    expect(seoTagCount('link[rel="canonical"]')).toBe(0);
  });

  it('adds a robots tag on request and removes it again on the next page', () => {
    // The removal half is the one that silently de-indexes a site: navigate /admin -> / and a
    // leftover noindex tells the crawler the public landing page is off limits.
    const seo = createService();

    seo.applyPage({ title: 'Krzysztof Tarka - Admin login', robots: 'noindex, nofollow' });
    expect(content('meta[name="robots"]')).toBe('noindex, nofollow');

    seo.applyPage({ title: 'Krzysztof Tarka - Projects' });
    expect(seoTagCount('meta[name="robots"]')).toBe(0);
  });

  it('falls back to the site’s own title when a page declares no title', () => {
    const seo = createService();

    seo.applyPage({ title: 'Krzysztof Tarka - Contact' });
    seo.applyPage({});

    // The same string index.html ships in <title>, og:title and twitter:title -- so a page that
    // names nothing more specific reads as the site, not as the page before it and not as a
    // bare brand word that disagrees with what a shared link previews as.
    expect(document.title).toBe(SITE_TITLE);
    expect(content('meta[property="og:title"]')).toBe(SITE_TITLE);
    expect(SITE_TITLE.startsWith(SITE_NAME)).toBe(true);
  });
});
