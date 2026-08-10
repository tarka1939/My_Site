import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Routes, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes as applicationRoutes } from '../../app.routes';
import { CONTACT_ROUTES } from '../../features/contact/contact.routes';
import { PROJECTS_ROUTES } from '../../features/projects/projects.routes';
import { SeoTitleStrategy } from './seo-title.strategy';
import { NOINDEX, SITE_DESCRIPTION } from './site-meta';

@Component({ selector: 'app-test-page', template: '<p>page</p>' })
class TestPageComponent {}

/**
 * A stand-in for the real route table, exercising the three shapes that matter: a route with its
 * own description, a route with none, and a parent whose `robots` must cover children that override
 * the description and children that do not.
 */
const TEST_ROUTES: Routes = [
  {
    path: 'plain',
    component: TestPageComponent,
    title: 'My Site - Plain',
    data: { description: 'A plain page.' },
  },
  { path: 'bare', component: TestPageComponent, title: 'My Site - Bare' },
  {
    path: 'admin',
    data: { description: 'Administration.', robots: NOINDEX },
    children: [
      {
        path: 'login',
        component: TestPageComponent,
        title: 'My Site - Admin login',
        data: { description: 'Sign in.' },
      },
      { path: 'deep', component: TestPageComponent, title: 'My Site - Deep' },
    ],
  },
];

const SEO_SELECTORS = [
  'meta[name="description"]',
  'meta[name="robots"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
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

function content(selector: string): string | null {
  const found = [...document.head.querySelectorAll(selector)];
  expect(found).toHaveLength(1);
  return found[0].getAttribute('content');
}

function count(selector: string): number {
  return document.head.querySelectorAll(selector).length;
}

describe('SeoTitleStrategy', () => {
  const originalTitle = document.title;

  beforeEach(() => {
    clearSeoTags();
    TestBed.configureTestingModule({
      providers: [provideRouter(TEST_ROUTES), { provide: TitleStrategy, useClass: SeoTitleStrategy }],
    });
  });

  afterEach(() => {
    clearSeoTags();
    document.title = originalTitle;
  });

  it('applies a route’s title and description on navigation', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/plain');

    expect(document.title).toBe('My Site - Plain');
    expect(content('meta[name="description"]')).toBe('A plain page.');
    expect(content('meta[property="og:description"]')).toBe('A plain page.');
    expect(content('meta[property="og:title"]')).toBe('My Site - Plain');
    expect(content('meta[property="og:url"]')).toBe(`${location.origin}/plain`);
  });

  it('replaces the previous route’s tags instead of adding to them', async () => {
    // Three navigations, one tag each. With addTag semantics this ends with three description tags
    // and a crawler reads the first -- i.e. the page it was on two navigations ago.
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/plain');
    await harness.navigateByUrl('/admin/login');
    await harness.navigateByUrl('/plain');

    expect(count('meta[name="description"]')).toBe(1);
    expect(count('meta[property="og:description"]')).toBe(1);
    expect(count('meta[name="twitter:description"]')).toBe(1);
    expect(count('meta[property="og:title"]')).toBe(1);
    expect(content('meta[name="description"]')).toBe('A plain page.');
  });

  it('falls back to the site description on a route that declares none', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/plain');
    await harness.navigateByUrl('/bare');

    // Not 'A plain page.' -- a route without a description must not inherit the last one shown.
    expect(content('meta[name="description"]')).toBe(SITE_DESCRIPTION);
    expect(document.title).toBe('My Site - Bare');
  });

  it('inherits a parent route’s robots and description down the subtree', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/deep');

    expect(content('meta[name="robots"]')).toBe(NOINDEX);
    expect(content('meta[name="description"]')).toBe('Administration.');
  });

  it('lets a child override the inherited description while keeping robots', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/login');

    expect(content('meta[name="description"]')).toBe('Sign in.');
    expect(content('meta[name="robots"]')).toBe(NOINDEX);
  });

  it('removes noindex when navigating from the admin area back to a public route', async () => {
    // The de-indexing bug: a robots tag left behind after leaving /admin tells crawlers the public
    // landing page must not be indexed, and nothing in the UI shows it.
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/admin/login');
    expect(count('meta[name="robots"]')).toBe(1);

    await harness.navigateByUrl('/plain');
    expect(count('meta[name="robots"]')).toBe(0);
  });
});

describe('application route table', () => {
  // The tests above prove the mechanism against stand-in routes. These assert the real table
  // actually feeds it -- a correct strategy over a table with no `data` would set nothing.
  function routeByPath(routes: typeof applicationRoutes, path: string) {
    const route = routes.find((candidate) => candidate.path === path);
    expect(route, `no route with path '${path}'`).toBeDefined();
    return route!;
  }

  it('describes the public routes', () => {
    expect(routeByPath(PROJECTS_ROUTES, '')['data']?.['description']).toBeTruthy();
    expect(routeByPath(PROJECTS_ROUTES, 'projects/:id')['data']?.['description']).toBeTruthy();
    expect(routeByPath(CONTACT_ROUTES, '')['data']?.['description']).toBeTruthy();
  });

  it('keeps the admin area, the reset form and the 404 view out of the index', () => {
    expect(routeByPath(applicationRoutes, 'admin')['data']?.['robots']).toBe(NOINDEX);
    expect(routeByPath(applicationRoutes, 'reset-password')['data']?.['robots']).toBe(NOINDEX);
    expect(routeByPath(applicationRoutes, '**')['data']?.['robots']).toBe(NOINDEX);
  });

  it('leaves the public routes indexable', () => {
    expect(routeByPath(PROJECTS_ROUTES, '')['data']?.['robots']).toBeUndefined();
    expect(routeByPath(PROJECTS_ROUTES, 'projects/:id')['data']?.['robots']).toBeUndefined();
    expect(routeByPath(CONTACT_ROUTES, '')['data']?.['robots']).toBeUndefined();
  });
});
