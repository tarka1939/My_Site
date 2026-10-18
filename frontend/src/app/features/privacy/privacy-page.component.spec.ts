import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { clearSeoTags, seoContent, seoTagCount } from '../../../testing/seo-tags';
import { routes } from '../../app.routes';
import { SeoTitleStrategy } from '../../core/seo/seo-title.strategy';
import { META_DESCRIPTION_MAX_CHARS } from '../../core/seo/site-meta';
import { PRIVACY_ROUTES } from './privacy.routes';

/**
 * Reached through the real route table and the real SeoTitleStrategy, so the title and the meta
 * description asserted here are the ones a visitor's tab and a crawler get.
 *
 * The copy is the owner's and may change, so these pin its shape (one h1, the sections in
 * order, the list, the router link) and the claims the code has to keep true, not every word.
 */
describe('PrivacyPageComponent', () => {
  const originalTitle = document.title;

  /** Read off the route rather than copied, so editing the prose cannot break this. */
  const DESCRIPTION = PRIVACY_ROUTES[0].data?.['description'] as string;

  beforeEach(() => {
    clearSeoTags();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), { provide: TitleStrategy, useClass: SeoTitleStrategy }],
    });
  });

  afterEach(() => {
    clearSeoTags();
    document.title = originalTitle;
  });

  async function open(): Promise<{ harness: RouterTestingHarness; page: HTMLElement }> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/privacy');
    const page = harness.routeNativeElement!;
    expect(page.tagName.toLowerCase()).toBe('app-privacy-page');
    return { harness, page };
  }

  function texts(elements: Iterable<Element>): (string | undefined)[] {
    return [...elements].map((element) => element.textContent?.replace(/\s+/g, ' ').trim());
  }

  it('has its own title and meta description, and stays indexable', async () => {
    await open();

    expect(document.title).toBe('Krzysztof Tarka - Privacy');
    expect(DESCRIPTION.length).toBeGreaterThan(0);
    // Within the budget as written, so SeoService never has to cut it short with an ellipsis.
    expect(DESCRIPTION.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX_CHARS);
    expect(seoContent('meta[name="description"]')).toBe(DESCRIPTION);
    expect(seoContent('meta[property="og:description"]')).toBe(DESCRIPTION);
    // A public page in the sitemap: no robots tag, unlike the admin and reset-password routes.
    expect(seoTagCount('meta[name="robots"]')).toBe(0);
  });

  it('is headed Privacy, with the draft sections as h2s in order', async () => {
    const { page } = await open();

    expect(texts(page.querySelectorAll('h1'))).toEqual(['Privacy']);
    expect(texts(page.querySelectorAll('h2'))).toEqual([
      'What is counted',
      'How',
      'What is not collected',
      'Opting out',
      'The contact form',
      'Hosting',
    ]);
    // Nothing below h2: the draft has two levels and the page must not invent a third.
    expect(page.querySelector('h3, h4, h5, h6')).toBeNull();
  });

  it('lists what is counted as a list, not as run-on paragraphs', async () => {
    const { page } = await open();

    const items = texts(page.querySelectorAll('ul > li'));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/^Which pages are viewed: the About page/);
    expect(items[1]).toMatch(/^Clicks on a project's own links/);
  });

  it('names both opt-out signals the tracker honours', async () => {
    // The page's promise and analytics-tracker.ts have to agree; this is the page's half.
    const { page } = await open();

    expect(page.textContent).toContain('Do Not Track');
    expect(page.textContent).toContain('Global Privacy Control');
  });

  it('links "contact form" to the contact page through the router', async () => {
    const { harness, page } = await open();

    const link = [...page.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'contact form');
    expect(link?.getAttribute('href')).toBe('/contact');

    // A router link, not a plain href: the click navigates inside the app, without a page load.
    link!.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/contact');
    expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe('app-contact-form');
  });
});
