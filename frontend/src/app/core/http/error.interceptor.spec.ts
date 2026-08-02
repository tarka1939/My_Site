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
});
