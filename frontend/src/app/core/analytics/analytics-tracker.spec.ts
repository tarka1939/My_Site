import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { clearSeoTags } from '../../../testing/seo-tags';
import { appConfig, httpInterceptors } from '../../app.config';
import { routes } from '../../app.routes';
import { provideApi } from '../api';
import { AuthService } from '../auth/auth.service';
import { SKIP_ERROR_TOAST } from '../http/error.interceptor';
import { NotificationService } from '../notifications/notification.service';
import { AnalyticsTracker, PRIVACY_SIGNALS } from './analytics-tracker';

const API = environment.apiBaseUrl;
const PAGE_VIEWS = `${API}/analytics/page-views`;
const LINK_CLICKS = `${API}/analytics/link-clicks`;
const PROJECT_ID = '3f2b8c1e-7d4a-4e9b-a6c5-0d1e2f3a4b5c';
const OTHER_PROJECT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** A navigator the specs can change between events. */
interface FakeSignals {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

/**
 * The tracker against the real route table, so a route that loses its `analyticsPage` fails here,
 * and the real interceptor chain, so "no toast" is what errorInterceptor actually does with these
 * requests rather than what a stub says. No outlet is rendered: the router still activates the
 * routes and emits NavigationEnd, but no page component is created, so no page makes requests of
 * its own.
 */
describe('AnalyticsTracker', () => {
  let signals: FakeSignals;
  let httpMock: HttpTestingController;
  let router: Router;
  let tracker: AnalyticsTracker;
  let notifications: NotificationService;
  const originalTitle = document.title;

  beforeEach(() => {
    // AuthService reads the stored session in its constructor.
    sessionStorage.clear();
    signals = { doNotTrack: null, globalPrivacyControl: false };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors(httpInterceptors)),
        provideHttpClientTesting(),
        provideApi(API),
        { provide: PRIVACY_SIGNALS, useValue: signals },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    notifications = TestBed.inject(NotificationService);
    tracker = TestBed.inject(AnalyticsTracker);
    tracker.start();
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
    document.title = originalTitle;
  });

  /** The one page view the last navigation sent, answered 204. */
  function expectPageView(): TestRequest {
    const request = httpMock.expectOne(PAGE_VIEWS);
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });
    return request;
  }

  function logIn(forMs: number): void {
    TestBed.inject(AuthService).setSession({
      token: 't',
      expiresAt: new Date(Date.now() + forMs).toISOString(),
    });
  }

  describe('which page is counted', () => {
    it.each([
      ['/', { page: 'about' }],
      // The old About URL redirects to the root, and is counted as what it shows.
      ['/about', { page: 'about' }],
      ['/projects', { page: 'projects' }],
      [`/projects/${PROJECT_ID}`, { page: 'project', projectId: PROJECT_ID }],
      ['/contact', { page: 'contact' }],
    ])('counts %s as %j', async (url, body) => {
      await router.navigateByUrl(url);

      expect(expectPageView().request.body).toEqual(body);
    });

    it.each([
      // A URL here can carry a token, which is why the page list is closed.
      '/reset-password?token=secret-token',
      '/admin/login',
      '/admin/forgot-password',
      // Guarded: the guard sends a visitor to the login page, which is not counted either.
      '/admin/projects',
      '/no-such-page',
    ])('sends nothing for %s', async (url) => {
      await router.navigateByUrl(url);

      httpMock.expectNone(PAGE_VIEWS);
    });

    it('sends nothing for a project URL whose id is not a UUID', async () => {
      // No project can have it, and the server would refuse it: projectId is `format: uuid`.
      await router.navigateByUrl('/projects/not-a-project');

      httpMock.expectNone(PAGE_VIEWS);
    });

    it('counts each project by its own id', async () => {
      await router.navigateByUrl(`/projects/${PROJECT_ID}`);
      expect(expectPageView().request.body).toEqual({ page: 'project', projectId: PROJECT_ID });

      // The same component instance is reused between the two, which must not matter here.
      await router.navigateByUrl(`/projects/${OTHER_PROJECT_ID}`);
      expect(expectPageView().request.body).toEqual({ page: 'project', projectId: OTHER_PROJECT_ID });
    });

    it('sends nothing more for a navigation that stays on the page, and counts a return to it', async () => {
      await router.navigateByUrl('/contact');
      expectPageView();

      // The skip link's fragment is a router navigation of its own.
      await router.navigateByUrl('/contact#main-content');
      httpMock.expectNone(PAGE_VIEWS);

      await router.navigateByUrl('/projects');
      expectPageView();
      await router.navigateByUrl('/contact');
      expect(expectPageView().request.body).toEqual({ page: 'contact' });
    });

    it('counts a page again after a navigation to a page that is not counted', async () => {
      await router.navigateByUrl('/contact');
      expectPageView();
      await router.navigateByUrl('/admin/login');
      httpMock.expectNone(PAGE_VIEWS);

      await router.navigateByUrl('/contact');
      expectPageView();
    });

    it('starts once however often start() is called', async () => {
      tracker.start();
      tracker.start();

      await router.navigateByUrl('/contact');

      // expectOne fails on two matching requests.
      expectPageView();
    });
  });

  describe('who is not counted', () => {
    it('sends nothing while the browser sends Do Not Track', async () => {
      signals.doNotTrack = '1';

      await router.navigateByUrl('/contact');

      httpMock.expectNone(PAGE_VIEWS);
    });

    it('counts a browser whose Do Not Track is not "1"', async () => {
      signals.doNotTrack = '0';

      await router.navigateByUrl('/contact');

      expectPageView();
    });

    it('sends nothing while the browser sends Global Privacy Control', async () => {
      signals.globalPrivacyControl = true;

      await router.navigateByUrl('/contact');

      httpMock.expectNone(PAGE_VIEWS);
    });

    it('reads both signals when it sends, not once at start', async () => {
      await router.navigateByUrl('/contact');
      expectPageView();

      signals.globalPrivacyControl = true;
      await router.navigateByUrl('/projects');
      httpMock.expectNone(PAGE_VIEWS);

      signals.globalPrivacyControl = false;
      signals.doNotTrack = '1';
      await router.navigateByUrl('/contact');
      httpMock.expectNone(PAGE_VIEWS);

      signals.doNotTrack = null;
      await router.navigateByUrl('/projects');
      expectPageView();
    });

    it('counts a browser with no navigator at all', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes),
          provideHttpClient(withInterceptors(httpInterceptors)),
          provideHttpClientTesting(),
          provideApi(API),
          { provide: PRIVACY_SIGNALS, useValue: null },
        ],
      });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.inject(AnalyticsTracker).start();

      await TestBed.inject(Router).navigateByUrl('/contact');

      expectPageView();
    });

    it('sends nothing while the admin is logged in, and counts again after logout', async () => {
      logIn(60_000);
      await router.navigateByUrl('/contact');
      httpMock.expectNone(PAGE_VIEWS);

      TestBed.inject(AuthService).logout();
      await router.navigateByUrl('/projects');
      expectPageView();
    });

    it('counts a session that has expired by the clock as a visitor, and sends it no token', async () => {
      // isLoggedIn() is false here though the token is still held (#151), and authInterceptor
      // attaches only a token isLoggedIn() vouches for. So the request is anonymous, and a 401 for
      // a refused token, the one failure SKIP_ERROR_TOAST does not silence, cannot come back.
      logIn(-60_000);
      expect(TestBed.inject(AuthService).hasToken()).toBe(true);

      await router.navigateByUrl('/contact');

      expect(expectPageView().request.headers.has('Authorization')).toBe(false);
    });
  });

  describe('a failure', () => {
    it('sends every page view with the toast switched off', async () => {
      await router.navigateByUrl('/contact');

      expect(expectPageView().request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    });

    const problem = (status: number, extra: Record<string, unknown> = {}) =>
      (request: TestRequest) =>
        request.flush({ type: 'about:blank', title: 'Error', status, ...extra }, { status, statusText: 'Error' });

    it.each<[string, (request: TestRequest) => void]>([
      ['a 404, which is what the endpoint answers while analytics is off', problem(404)],
      ['a 429', problem(429, { title: 'Too Many Requests' })],
      [
        'a 400 with field errors',
        problem(400, { errors: [{ field: 'projectId', message: 'must be a published project' }] }),
      ],
      ['a 400 without field errors', problem(400, { detail: 'Malformed JSON' })],
      ['a network error (status 0)', (request) => request.error(new ProgressEvent('error'))],
      ['a 500', problem(500)],
      ['a bare 503 from a proxy', (request) => request.flush(null, { status: 503, statusText: 'Error' })],
      // A visitor holds no token, so a 401 here is not a session ending.
      ['a bare 401', (request) => request.flush(null, { status: 401, statusText: 'Unauthorized' })],
    ])('is swallowed without a toast: %s', async (_, fail) => {
      const error = vi.spyOn(notifications, 'error');
      const info = vi.spyOn(notifications, 'info');

      await router.navigateByUrl('/contact');
      fail(httpMock.expectOne(PAGE_VIEWS));

      expect(error).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(notifications.notifications()).toEqual([]);
      expect(router.url).toBe('/contact');

      // And counting carries on: each event is its own request.
      await router.navigateByUrl('/projects');
      expectPageView();
    });
  });

  describe('link clicks', () => {
    const URL = 'https://github.com/tarka1939/Equalizer';

    it('sends the project id and the URL as given, with the toast switched off', () => {
      tracker.recordLinkClick(PROJECT_ID, URL);

      const request = httpMock.expectOne(LINK_CLICKS);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ projectId: PROJECT_ID, url: URL });
      expect(request.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
      request.flush(null, { status: 204, statusText: 'No Content' });
    });

    it.each<[string, () => void]>([
      ['Do Not Track', () => (signals.doNotTrack = '1')],
      ['Global Privacy Control', () => (signals.globalPrivacyControl = true)],
      ['a logged-in admin', () => logIn(60_000)],
    ])('sends nothing for %s', (_, arrange) => {
      arrange();

      tracker.recordLinkClick(PROJECT_ID, URL);

      httpMock.expectNone(LINK_CLICKS);
    });

    it('swallows a failure without a toast', () => {
      const error = vi.spyOn(notifications, 'error');

      tracker.recordLinkClick(PROJECT_ID, URL);
      httpMock
        .expectOne(LINK_CLICKS)
        .flush({ title: 'Not Found', status: 404 }, { status: 404, statusText: 'Not Found' });

      expect(error).not.toHaveBeenCalled();
      expect(notifications.notifications()).toEqual([]);
    });
  });
});

/**
 * The wiring the suite above cannot see, since it calls start() itself: that the app starts the
 * tracker at bootstrap, with nothing else asking it to.
 */
describe('AnalyticsTracker, as app.config.ts starts it', () => {
  afterEach(() => {
    clearSeoTags();
    sessionStorage.clear();
  });

  it('counts a page shown with nothing but the app config', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: PRIVACY_SIGNALS, useValue: {} },
      ],
    });
    const httpMock = TestBed.inject(HttpTestingController);

    await TestBed.inject(Router).navigateByUrl('/contact');

    const request = httpMock.expectOne(PAGE_VIEWS);
    expect(request.request.body).toEqual({ page: 'contact' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.verify();
  });
});
