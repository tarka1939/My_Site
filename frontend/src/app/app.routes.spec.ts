import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { App } from './app';
import { routes } from './app.routes';
import { AboutService } from './core/api/api/about.service';
import { ProjectsService } from './core/api/api/projects.service';
import { TagsService } from './core/api/api/tags.service';
import { Project } from './core/api/model/project';

/**
 * The real route table, end to end: which URL renders which page. About became the landing page
 * on 2026-09-24 and the projects list moved from `/` to `/projects`, so these pin the URL scheme
 * itself -- including that the old `/about` URL still works, and that the move did not strand
 * `/projects/:id` deep links (the failure mode app.routes.ts's comments are about).
 */

const PROJECT: Project = {
  id: 'p1',
  title: 'Equalizer',
  description: 'A DSP project',
  links: [],
  images: [],
  tags: [],
  startedOn: null,
  completedOn: null,
  published: true,
  repoFullName: null,
  lastPushedAt: null,
  defaultBranch: null,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const EMPTY_PAGE = { content: [], page: 0, size: 12, totalElements: 0, totalPages: 0 };

function configure(): void {
  // AuthService reads the stored session in its constructor; the nav test below renders App.
  sessionStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: AboutService, useValue: { getAboutPage: () => of({ body: '', updatedAt: '2026-09-20T10:00:00Z' }) } },
      {
        provide: ProjectsService,
        useValue: { listProjects: () => of(EMPTY_PAGE), getProject: () => of(PROJECT) },
      },
      { provide: TagsService, useValue: { listTags: () => of([]) } },
    ],
  });
}

/** The routed component's own tag -- `routeNativeElement` is the component's host element. */
function renderedPage(harness: RouterTestingHarness): string | undefined {
  return harness.routeNativeElement?.tagName.toLowerCase();
}

describe('application routes', () => {
  beforeEach(configure);

  it('renders the About page at the site root', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');

    expect(TestBed.inject(Router).url).toBe('/');
    expect(renderedPage(harness)).toBe('app-about-page');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('About');
  });

  it('redirects the old /about URL to the site root', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/about');

    // A redirect, not a second route to the same page: the address itself must end up at '/',
    // so there is one canonical URL for About.
    expect(TestBed.inject(Router).url).toBe('/');
    expect(renderedPage(harness)).toBe('app-about-page');
  });

  it('renders the projects list at /projects', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects');

    expect(TestBed.inject(Router).url).toBe('/projects');
    expect(renderedPage(harness)).toBe('app-projects-list');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Projects');
  });

  it('still reaches a project by its deep link', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects/p1');

    expect(renderedPage(harness)).toBe('app-project-detail');
  });

  it('renders not-found for an unknown URL rather than a page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/no-such-page');

    expect(renderedPage(harness)).toBe('app-not-found');
  });
});

describe('primary navigation against the real routes', () => {
  beforeEach(configure);

  async function renderAt(url: string) {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav[aria-label="Primary"]')!;
    const link = (text: string) =>
      Array.from(nav.querySelectorAll('a')).find((a) => a.textContent?.trim() === text)!;
    return { projects: link('Projects'), about: link('About'), brand: nav.querySelector('.site-nav__brand')! };
  }

  it('links Projects to /projects, and About and the site name to /', async () => {
    const { projects, about, brand } = await renderAt('/');

    expect(projects.getAttribute('href')).toBe('/projects');
    expect(about.getAttribute('href')).toBe('/');
    expect(brand.getAttribute('href')).toBe('/');
  });

  it('marks only About active on the landing page', async () => {
    const { projects, about } = await renderAt('/');

    expect(about.classList.contains('is-active')).toBe(true);
    expect(projects.classList.contains('is-active')).toBe(false);
  });

  it('marks only Projects active on the list and on a project', async () => {
    // About's match is exact because every URL starts with '/'; without that it would stay lit
    // here too.
    for (const url of ['/projects', '/projects/p1']) {
      const { projects, about } = await renderAt(url);
      expect(projects.classList.contains('is-active'), url).toBe(true);
      expect(about.classList.contains('is-active'), url).toBe(false);
    }
  });
});
