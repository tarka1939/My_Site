import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { MockInstance } from 'vitest';
import { environment } from '../../../../environments/environment';
import { httpInterceptors } from '../../../app.config';
import { AuthService as AuthApiService } from '../../../core/api/api/auth.service';
import { provideApi } from '../../../core/api/provide-api';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AdminLoginComponent } from './admin-login.component';

function activatedRouteWithReturnUrl(returnUrl: string | null) {
  return {
    snapshot: { queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}) },
  };
}

describe('AdminLoginComponent', () => {
  let login: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sessionStorage.clear();
    login = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminLoginComponent],
      providers: [provideRouter([]), { provide: AuthApiService, useValue: { login } }],
    }).compileComponents();
  });

  it('does not submit an incomplete form', () => {
    const fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.componentInstance['submit']();

    expect(login).not.toHaveBeenCalled();
  });

  it('stores the session and navigates to /admin on successful login', async () => {
    login.mockReturnValue(of({ token: 'jwt', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.componentInstance['form'].setValue({ username: 'admin', password: 'password123' });
    fixture.componentInstance['submit']();

    const auth = TestBed.inject(AuthService);
    expect(auth.isLoggedIn()).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith('/admin');
  });

  it('stops submitting (without throwing) on invalid credentials', () => {
    login.mockReturnValue(throwError(() => ({ status: 401, title: 'Unauthorized', fieldErrors: [], rateLimited: false })));

    const fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.componentInstance['form'].setValue({ username: 'admin', password: 'wrong' });
    fixture.componentInstance['submit']();

    expect(fixture.componentInstance['submitting']()).toBe(false);
  });

  it('navigates to a same-app returnUrl after login', async () => {
    login.mockReturnValue(of({ token: 'jwt', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    TestBed.overrideProvider(ActivatedRoute, { useValue: activatedRouteWithReturnUrl('/admin/messages') });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.componentInstance['form'].setValue({ username: 'admin', password: 'password123' });
    fixture.componentInstance['submit']();

    expect(navigateSpy).toHaveBeenCalledWith('/admin/messages');
  });

  it('falls back to /admin for a protocol-relative returnUrl instead of trusting it', async () => {
    login.mockReturnValue(of({ token: 'jwt', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    TestBed.overrideProvider(ActivatedRoute, { useValue: activatedRouteWithReturnUrl('//evil.example.com') });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.componentInstance['form'].setValue({ username: 'admin', password: 'password123' });
    fixture.componentInstance['submit']();

    expect(navigateSpy).toHaveBeenCalledWith('/admin');
  });
});

/**
 * #313. A wrong password, then the right one, opened the admin pages under the first attempt's red
 * toast. Run through the generated client and the interceptors the app registers, so each toast
 * here is the one errorInterceptor really raises for that failure rather than a stub's.
 */
describe('AdminLoginComponent, and the toasts on screen when a login succeeds', () => {
  const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
  const WRONG_PASSWORD = 'Invalid username or password';
  const SESSION_EXPIRED = 'Your admin session has expired. Please log in again.';

  let httpMock: HttpTestingController;
  let notifications: NotificationService;
  let navigateByUrl: MockInstance<Router['navigateByUrl']>;
  /** The error toasts on screen at each call to navigateByUrl, which is what pins the order. */
  let errorsAtNavigation: string[][];
  let fixture: ComponentFixture<AdminLoginComponent>;

  const errorsShown = () =>
    notifications
      .notifications()
      .filter((n) => n.level === 'error')
      .map((n) => n.message);
  const shown = () => notifications.notifications().map((n) => `${n.level}: ${n.message}`);

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AdminLoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors(httpInterceptors)),
        provideHttpClientTesting(),
        provideApi(environment.apiBaseUrl),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    notifications = TestBed.inject(NotificationService);
    errorsAtNavigation = [];
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(() => {
      errorsAtNavigation.push(errorsShown());
      return Promise.resolve(true);
    });
    fixture = TestBed.createComponent(AdminLoginComponent);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  /** Submits the form and answers the one login request it sends the way `answer` says. */
  function attempt(password: string, answer: (request: TestRequest) => void): void {
    fixture.componentInstance['form'].setValue({ username: 'admin', password });
    fixture.componentInstance['submit']();
    answer(httpMock.expectOne(LOGIN_URL));
  }

  const rejected = (request: TestRequest) =>
    request.flush(
      { type: 'about:blank', title: 'Unauthorized', status: 401, detail: WRONG_PASSWORD },
      { status: 401, statusText: 'Unauthorized' },
    );
  const accepted = (request: TestRequest) =>
    request.flush({ token: 'jwt', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });

  // One case per way errorInterceptor words a login failure. Each is stale once a later attempt
  // succeeds, so the fix takes down errors by level rather than the 401's sentence alone.
  it.each<[string, (request: TestRequest) => void]>([
    ['a wrong password', rejected],
    [
      'the rate limit',
      (request) =>
        request.flush(
          { title: 'Too Many Requests', status: 429 },
          { status: 429, statusText: 'Too Many Requests' },
        ),
    ],
    ['a server error', (request) => request.flush(null, { status: 503, statusText: 'Error' })],
    ['a network failure', (request) => request.error(new ProgressEvent('error'))],
  ])('takes down the toast %s left once a later attempt succeeds, before navigating', (_, fail) => {
    attempt('wrong', fail);
    expect(errorsShown()).toHaveLength(1);

    attempt('password123', accepted);

    expect(errorsShown()).toEqual([]);
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith('/admin');
    expect(errorsAtNavigation).toEqual([[]]);
  });

  it('keeps an info toast that was on screen when the login succeeded', () => {
    notifications.info('About page saved.');
    attempt('wrong', rejected);

    attempt('password123', accepted);

    expect(shown()).toEqual(['info: About page saved.']);
  });

  // errorInterceptor raises this and then redirects here, so it is on screen before the first
  // attempt. Raised by hand: the redirect is that interceptor's spec's business, not this one's.
  it('takes down the session-expiry notice that sent the admin here, before navigating', () => {
    notifications.error(SESSION_EXPIRED);

    attempt('password123', accepted);

    expect(errorsShown()).toEqual([]);
    expect(errorsAtNavigation).toEqual([[]]);
  });

  // The other half of #313: the notice must still be there when the page it sent the admin to
  // opens, or the redirect arrives with no reason given. So only a success may take it down, and
  // a dismissal when the page is created or first rendered fails here. Raised before this test's
  // own page is created, as the interceptor raises it before redirecting.
  it('keeps the session-expiry notice while the login page opens', async () => {
    fixture.destroy();
    notifications.error(SESSION_EXPIRED);

    fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(errorsShown()).toEqual([SESSION_EXPIRED]);
  });

  it('leaves every toast in place when an attempt fails, and stays on the page', () => {
    notifications.error(SESSION_EXPIRED);

    attempt('wrong', rejected);

    expect(errorsShown()).toEqual([SESSION_EXPIRED, WRONG_PASSWORD]);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
