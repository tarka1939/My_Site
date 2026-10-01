import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notification.service';
import { ApiProblem } from './api-problem';
import { errorInterceptor, SKIP_ERROR_TOAST } from './error.interceptor';

@Component({ template: '' })
class StubComponent {}

/** Mirrors the generated client's `${basePath}/auth/login`, with the same basePath app.config.ts
 * hands provideApi(). Derived rather than written out so it survives Phase 5 picking a real host. */
const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;

describe('errorInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let notifications: NotificationService;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'admin/login', component: StubComponent },
          { path: 'admin/projects', component: StubComponent },
          { path: 'contact', component: StubComponent },
        ]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    notifications = TestBed.inject(NotificationService);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  it('normalizes a validation ProblemDetail body into an ApiProblem with fieldErrors', async () => {
    const promise = firstValueFrom(httpClient.post('/api/v1/contact', {})).catch((problem: ApiProblem) => problem);

    httpMock.expectOne('/api/v1/contact').flush(
      {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        errors: [{ field: 'email', message: 'must not be blank' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );

    const problem = (await promise) as ApiProblem;
    expect(problem.status).toBe(400);
    expect(problem.fieldErrors).toEqual([{ field: 'email', message: 'must not be blank' }]);
    expect(notifications.notifications()).toHaveLength(0);
  });

  it('flags 429 responses as rateLimited and posts a global notification', async () => {
    const promise = firstValueFrom(httpClient.post('/api/v1/contact', {})).catch((problem: ApiProblem) => problem);

    httpMock
      .expectOne('/api/v1/contact')
      .flush({ type: 'about:blank', title: 'Too Many Requests', status: 429 }, { status: 429, statusText: 'Too Many Requests' });

    const problem = (await promise) as ApiProblem;
    expect(problem.rateLimited).toBe(true);
    expect(notifications.notifications()).toHaveLength(1);
  });

  /**
   * A 401, and everything the interceptor's reaction to one is made of: what the session ends up
   * as, what the admin is told, and where they end up.
   *
   * Asserted together on purpose, because each half alone is satisfied by a version of the bug.
   * "isLoggedIn() is false" passes when nothing was cleared and the branch never ran, since an
   * expired session already reports that. "a toast fired" passes when the toast is the generic
   * "Request failed (401)." dead end #108 is about. And a redirect with no returnUrl sends the
   * admin back to /admin having lost the page they were on.
   */
  async function fail401(
    url: string,
    options: { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Promise<{ toasts: string[]; url: string; returnUrl: string | undefined }> {
    const body = options.body ?? { type: 'about:blank', title: 'Unauthorized', status: 401 };
    const promise = firstValueFrom(
      httpClient.request(options.method ?? 'GET', url, { body: {}, headers: options.headers }),
    ).catch((problem: ApiProblem) => problem);

    httpMock.expectOne(url).flush(body, { status: 401, statusText: 'Unauthorized' });

    await promise;
    // The interceptor fires router.navigate() without awaiting it, so the rejection settles first.
    // Let the navigation it scheduled land before reading router.url, or every assertion below
    // about where the admin ended up reads the URL they started on and passes for the wrong reason.
    await TestBed.inject(ApplicationRef).whenStable();

    return {
      toasts: notifications.notifications().map((n) => n.message),
      url: router.url,
      // Read back through the serializer rather than string-matching router.url: `/` is legal
      // unescaped in a query value, so whether this round-trips as %2F is the serializer's business
      // and not something a test about returnUrl should be asserting.
      returnUrl: router.parseUrl(router.url).queryParams['returnUrl'] as string | undefined,
    };
  }

  it('logs the admin out and notifies when a 401 arrives while logged in', async () => {
    await router.navigateByUrl('/admin/projects');
    auth.setSession({ token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    const { toasts, url, returnUrl } = await fail401('/api/v1/contact-messages');

    expect(toasts).toEqual(['Your admin session has expired. Please log in again.']);
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.hasToken()).toBe(false);
    expect(url.startsWith('/admin/login')).toBe(true);
    expect(returnUrl).toBe('/admin/projects');
  });

  // #237. Two admin requests in flight when the server stops accepting the token: clock skew, a
  // rotated signing secret, revocation. The first 401 ends the session and says so. The second
  // then finds no token, and used to add "The server did not accept this request (error 401)."
  // about the same event. This spec installs no authInterceptor, so the header it would have
  // attached is set by hand.
  it('says the session ended once when two requests carrying the token both come back 401', async () => {
    await router.navigateByUrl('/admin/projects');
    auth.setSession({ token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const headers = { Authorization: 'Bearer t' };
    const unauthorized = { status: 401, statusText: 'Unauthorized' };
    const body = { type: 'about:blank', title: 'Unauthorized', status: 401 };

    const first = firstValueFrom(httpClient.get('/api/v1/contact-messages', { headers })).catch(
      (problem: ApiProblem) => problem,
    );
    const second = firstValueFrom(httpClient.get('/api/v1/admin/projects', { headers })).catch(
      (problem: ApiProblem) => problem,
    );
    httpMock.expectOne('/api/v1/contact-messages').flush(body, unauthorized);
    httpMock.expectOne('/api/v1/admin/projects').flush(body, unauthorized);
    const [, secondProblem] = await Promise.all([first, second]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(notifications.notifications().map((n) => n.message)).toEqual([
      'Your admin session has expired. Please log in again.',
    ]);
    expect((secondProblem as ApiProblem).status).toBe(401);
    expect(router.url.startsWith('/admin/login')).toBe(true);
  });

  it('logs the admin out on a 401 for a token that has already expired by wall clock', async () => {
    await router.navigateByUrl('/admin/projects');
    // The state issue #108 is about. expiresAt passed while the tab sat idle, so isLoggedIn() is
    // already false and nothing has cleared the token -- which is why gating the branch on
    // isLoggedIn() skipped it, and skipped it for the most common way a session ends. The admin
    // saved a project, got "Request failed (401).", and was left on the page with no way forward.
    auth.setSession({ token: 't', expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.hasToken()).toBe(true);

    const { toasts, url, returnUrl } = await fail401('/api/v1/admin/projects');

    expect(toasts).toEqual(['Your admin session has expired. Please log in again.']);
    expect(auth.hasToken()).toBe(false);
    expect(url.startsWith('/admin/login')).toBe(true);
    expect(returnUrl).toBe('/admin/projects');
  });

  it('leaves a visitor who holds no token where they are on a 401', async () => {
    await router.navigateByUrl('/contact');
    const before = router.url;
    expect(auth.hasToken()).toBe(false);

    const { toasts, url } = await fail401('/api/v1/contact', {
      method: 'POST',
      body: { type: 'about:blank', title: 'Unauthorized', detail: 'Not authenticated', status: 401 },
    });

    // The contact form is public, so a 401 here is the server's problem and not a statement about
    // anyone's session. Say so and stay put -- do not bounce someone to a login page they never
    // asked for, and do not clear a session they never had.
    expect(toasts).toEqual(['Not authenticated']);
    expect(url).toBe(before);
  });

  // The login page has no guard, so an admin can reach it still holding a token: an expired one
  // through the header's Admin link, which shows once isLoggedIn() goes false, or a live one by URL.
  // docs/openapi.yaml documents /auth/login's 401 as "Invalid credentials", so without the login
  // exclusion one mistyped password would be reported as an expired session and rewrite returnUrl
  // to the login page itself -- stranding the admin there after a successful retry.
  it.each([
    ['an expired', -60_000],
    ['a live', 60_000],
  ])('does not treat a rejected login as an expired session when holding %s token', async (_, offset) => {
    await router.navigate(['/admin/login'], { queryParams: { returnUrl: '/admin/projects' } });
    const before = router.url;
    auth.setSession({ token: 'held', expiresAt: new Date(Date.now() + offset).toISOString() });

    const { toasts, url, returnUrl } = await fail401(LOGIN_URL, {
      method: 'POST',
      body: { type: 'about:blank', title: 'Unauthorized', detail: 'Invalid credentials', status: 401 },
    });

    expect(toasts).toEqual(['Invalid credentials']);
    expect(auth.hasToken()).toBe(true);
    expect(url).toBe(before);
    expect(returnUrl).toBe('/admin/projects');
  });

  // The other side of #237's branch. authInterceptor attaches a live token to every API request,
  // the login request included, so "it carried a token" alone would also silence a mistyped
  // password from an admin who opened the login page while still signed in.
  it('still reports a wrong password when the login request carried a live token', async () => {
    await router.navigateByUrl('/admin/login');
    auth.setSession({ token: 'held', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    const { toasts } = await fail401(LOGIN_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer held' },
      body: { type: 'about:blank', title: 'Unauthorized', detail: 'Invalid credentials', status: 401 },
    });

    expect(toasts).toEqual(['Invalid credentials']);
    expect(auth.hasToken()).toBe(true);
  });

  /**
   * A rejected 400, and both destinations it can reach: the toast this interceptor fires, and the
   * fieldErrors every form renders inline. Tests here assert on both together on purpose. Either
   * one alone is satisfied by the bug -- "fieldErrors is []" passes just as happily when the
   * rejection then goes nowhere, which is the failure this validation exists to prevent. The toast
   * is asserted first for the same reason: it is the half that fails invisibly, so a regression
   * should report itself on the line that says what the user was told.
   */
  async function reject(
    body: Record<string, unknown>,
  ): Promise<{ problem: ApiProblem; toasts: string[] }> {
    const promise = firstValueFrom(httpClient.post('/api/v1/contact', {})).catch(
      (problem: ApiProblem) => problem,
    );

    httpMock.expectOne('/api/v1/contact').flush(body, { status: 400, statusText: 'Bad Request' });

    const problem = (await promise) as ApiProblem;
    return { problem, toasts: notifications.notifications().map((n) => n.message) };
  }

  describe('a problem body whose errors is not what the contract promises', () => {
    it('toasts a 400 whose errors is an object rather than an array', async () => {
      // The shape that motivated all of this. Untouched, fieldErrors is that object, its .length is
      // undefined, and `undefined === 0` is false -- so no toast here and no inline message in any
      // form. A rejected save that says nothing at all.
      const { problem, toasts } = await reject({
        title: 'Bad Request',
        detail: 'Request failed validation',
        errors: { email: 'must not be blank' },
      });

      expect(toasts).toEqual(['Request failed validation']);
      expect(problem.fieldErrors).toEqual([]);
    });

    it('toasts a 400 whose errors is a string rather than an array', async () => {
      // Silence by the other route: a string's .length is truthy, so untouched this stays quiet
      // here and the form reaches .map(), which throws inside the subscriber where RxJS reports it
      // out of band -- green test run, blank form, dead Save button.
      const { problem, toasts } = await reject({
        title: 'Bad Request',
        detail: 'Request failed validation',
        errors: 'must not be blank',
      });

      expect(toasts).toEqual(['Request failed validation']);
      expect(problem.fieldErrors).toEqual([]);
    });

    it('drops entries that are not field errors and toasts because it dropped them', async () => {
      // The case the length check cannot cover by itself: one usable violation survives, so
      // fieldErrors is non-empty and the fail-safe branch is false. Without the toast the form
      // would show "url is not a valid URL", the admin would fix that, resubmit, and be rejected
      // again for the three violations no part of the UI ever named.
      const { problem, toasts } = await reject({
        title: 'Bad Request',
        detail: 'Request failed validation',
        errors: [
          { field: 'links[0].url', message: 'url is not a valid URL' },
          null,
          'title must not be blank',
          { field: 'title' },
          { field: 42, message: 'must be positive' },
        ],
      });

      expect(toasts).toEqual(['Request failed validation']);
      expect(problem.fieldErrors).toEqual([
        { field: 'links[0].url', message: 'url is not a valid URL' },
      ]);
    });

    it('toasts a 400 whose errors array holds nothing usable at all', async () => {
      const { problem, toasts } = await reject({
        title: 'Bad Request',
        detail: 'Request failed validation',
        errors: [null, 'title must not be blank', { message: 'no field named' }],
      });

      expect(toasts).toEqual(['Request failed validation']);
      expect(problem.fieldErrors).toEqual([]);
    });

    it('still toasts a 400 that carries no errors field at all', async () => {
      // The pre-existing fail-safe, kept honest while the branch above it grew a second clause: a
      // 400 with nothing to say per field must still reach the toast, not be treated as "nothing
      // was discarded, so nothing to report".
      const { problem, toasts } = await reject({ title: 'Bad Request', detail: 'Malformed JSON' });

      expect(toasts).toEqual(['Malformed JSON']);
      expect(problem.fieldErrors).toEqual([]);
    });

    it('falls back to a default title when the body types title as something other than a string', async () => {
      // Rendered straight into the toast, so a non-string is "[object Object]" on screen.
      const { problem, toasts } = await reject({ title: { code: 400 }, detail: 42 });

      expect(problem.title).toBe('The server did not accept this request (error 400).');
      expect(problem.detail).toBeUndefined();
      expect(toasts).toEqual(['The server did not accept this request (error 400).']);
    });
  });

  /**
   * A GET to `url` that fails the way `fail` says, with or without SKIP_ERROR_TOAST. Returns what
   * the caller received and what the visitor was told.
   */
  async function failWith(
    url: string,
    fail: (request: ReturnType<HttpTestingController['expectOne']>) => void,
    skipToast: boolean,
  ): Promise<{ problem: ApiProblem; toasts: string[] }> {
    const context = skipToast ? new HttpContext().set(SKIP_ERROR_TOAST, true) : undefined;
    const promise = firstValueFrom(httpClient.get(url, { context })).catch(
      (problem: ApiProblem) => problem,
    );
    fail(httpMock.expectOne(url));
    const problem = (await promise) as ApiProblem;
    await TestBed.inject(ApplicationRef).whenStable();
    return { problem, toasts: notifications.notifications().map((n) => n.message) };
  }

  const bareStatus = (status: number) => (request: ReturnType<HttpTestingController['expectOne']>) =>
    request.flush(null, { status, statusText: 'Error' });

  // #191. The reset page explains a failed token check itself; the toast arrived beside that
  // explanation in red and said the opposite.
  describe('SKIP_ERROR_TOAST', () => {
    it('toasts a failure by default', async () => {
      const { toasts } = await failWith('/api/v1/auth/password-reset/validate', bareStatus(503), false);

      expect(toasts).toHaveLength(1);
    });

    it('suppresses the toast for a request that sets it, and still hands the caller the problem', async () => {
      const { problem, toasts } = await failWith(
        '/api/v1/auth/password-reset/validate',
        bareStatus(503),
        true,
      );

      expect(toasts).toEqual([]);
      expect(problem.status).toBe(503);
      expect(problem.rateLimited).toBe(false);
    });

    it('suppresses the rate-limit toast too, since the caller renders that state as well', async () => {
      const { problem, toasts } = await failWith(
        '/api/v1/auth/password-reset/validate',
        (request) =>
          request.flush({ title: 'Too Many Requests', status: 429 }, { status: 429, statusText: 'Too Many Requests' }),
        true,
      );

      expect(toasts).toEqual([]);
      expect(problem.rateLimited).toBe(true);
    });

    it('does not stop a 401 from ending a session that was held -- that news is not the caller to give', async () => {
      await router.navigateByUrl('/admin/projects');
      auth.setSession({ token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() });

      const { toasts } = await failWith('/api/v1/contact-messages', bareStatus(401), true);

      expect(toasts).toEqual(['Your admin session has expired. Please log in again.']);
      expect(auth.hasToken()).toBe(false);
      expect(router.url.startsWith('/admin/login')).toBe(true);
    });
  });

  // #191's second half. These titles are used when the response body names nothing itself -- a
  // proxy error page, a gateway timeout -- and the toast they land in is mounted in the root
  // layout, so visitors read them. "Request failed (404)." was a developer's message.
  describe('the title a failure gets when its body names none', () => {
    it.each([
      [502, 'The server could not complete this just now. Please try again in a moment (error 502).'],
      [500, 'The server could not complete this just now. Please try again in a moment (error 500).'],
      [404, 'That could not be found on the server (error 404).'],
      [403, 'The server did not accept this request (error 403).'],
    ])('a bare %i reads as a sentence and keeps its status', async (status, expected) => {
      const { problem, toasts } = await failWith('/api/v1/projects', bareStatus(status), false);

      expect(problem.title).toBe(expected);
      expect(toasts).toEqual([expected]);
    });

    it('a request that never reached the server says so', async () => {
      const { problem, toasts } = await failWith(
        '/api/v1/projects',
        (request) => request.error(new ProgressEvent('error')),
        false,
      );

      expect(problem.status).toBe(0);
      expect(toasts).toEqual(['Could not reach the server. Check your connection and try again.']);
    });
  });

  // #236, as a visitor met it: /projects asks for the list and the tag filter at once, and with
  // the backend down both fail the same way. One sentence, said once.
  it('toasts once when two requests fail with the same message', async () => {
    const list = firstValueFrom(httpClient.get('/api/v1/projects')).catch(() => undefined);
    const tags = firstValueFrom(httpClient.get('/api/v1/tags')).catch(() => undefined);

    httpMock.expectOne('/api/v1/projects').flush(null, { status: 502, statusText: 'Bad Gateway' });
    httpMock.expectOne('/api/v1/tags').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await Promise.all([list, tags]);

    expect(notifications.notifications().map((n) => n.message)).toEqual([
      'The server could not complete this just now. Please try again in a moment (error 502).',
    ]);
  });
});
