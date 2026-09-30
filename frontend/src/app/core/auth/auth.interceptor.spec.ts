import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const API_URL = `${environment.apiBaseUrl}/projects`;

describe('authInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => httpMock.verify());

  /** The Authorization header the interceptor put on a GET to `url`, or null for none. */
  function authorizationSentTo(url: string): string | null {
    void firstValueFrom(httpClient.get(url));
    const request = httpMock.expectOne(url);
    request.flush({});
    return request.request.headers.get('Authorization');
  }

  it('attaches a live token to requests for our own API', () => {
    auth.setSession({ token: 'live', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(authorizationSentTo(API_URL)).toBe('Bearer live');
  });

  // #151. The backend answers an invalid bearer with 401 even on a public endpoint, so sending a
  // token the client already knows is dead turned an expired admin's visit to the public project
  // list into a forced logout. Sent anonymous, the same read succeeds.
  it('does not attach a token that has already expired by wall clock', () => {
    auth.setSession({ token: 'dead', expiresAt: new Date(Date.now() - 1_000).toISOString() });

    expect(authorizationSentTo(API_URL)).toBeNull();
  });

  // The other half of the same decision, and the reason the interceptor does not clear the session
  // itself: errorInterceptor tells "your session ended" from "you were never logged in" by
  // hasToken(), so an admin write that now goes out anonymous must still find the token held.
  it('leaves an expired session in place for errorInterceptor to report', () => {
    auth.setSession({ token: 'dead', expiresAt: new Date(Date.now() - 1_000).toISOString() });

    authorizationSentTo(API_URL);

    expect(auth.hasToken()).toBe(true);
  });

  it('sends nothing when no one is logged in', () => {
    expect(authorizationSentTo(API_URL)).toBeNull();
  });

  it('never sends the token anywhere but our own API', () => {
    auth.setSession({ token: 'live', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(authorizationSentTo('https://example.invalid/elsewhere')).toBeNull();
  });
});
