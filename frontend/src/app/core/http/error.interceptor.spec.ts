import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notification.service';
import { ApiProblem } from './api-problem';
import { errorInterceptor } from './error.interceptor';

@Component({ template: '' })
class StubLoginComponent {}

describe('errorInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let notifications: NotificationService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'admin/login', component: StubLoginComponent }]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    notifications = TestBed.inject(NotificationService);
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

  it('logs the admin out and notifies when a 401 arrives while logged in', async () => {
    auth.setSession({ token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    const promise = firstValueFrom(httpClient.get('/api/v1/contact-messages')).catch((problem: ApiProblem) => problem);

    httpMock
      .expectOne('/api/v1/contact-messages')
      .flush({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401, statusText: 'Unauthorized' });

    await promise;
    expect(auth.isLoggedIn()).toBe(false);
    expect(notifications.notifications()).toHaveLength(1);
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

      expect(problem.title).toBe('Request failed (400).');
      expect(problem.detail).toBeUndefined();
      expect(toasts).toEqual(['Request failed (400).']);
    });
  });
});
