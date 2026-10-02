import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

  // #246. The browser can trust a token the server has stopped accepting, and the server refuses
  // a request carrying one before reading anything else -- on /auth/login, before the password.
  // None of these endpoints wants a token, so none is sent and a stale one cannot block them.
  it.each(['/auth/login', '/auth/password-reset-request', '/auth/password-reset', '/auth/password-reset/validate'])(
    'sends no token to %s, which takes none',
    (path) => {
      auth.setSession({ token: 'live', expiresAt: new Date(Date.now() + 60_000).toISOString() });

      expect(authorizationSentTo(`${environment.apiBaseUrl}${path}`)).toBeNull();
    },
  );
});

/** Walk up from cwd to the frontend root, as `api-origin-hints.spec.ts` does; throw, never guess. */
function projectRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, join(dir, 'frontend')]) {
      if (existsSync(join(candidate, 'angular.json')) && existsSync(join(candidate, GENERATED_SERVICES))) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate the frontend project root (angular.json + ' + GENERATED_SERVICES + ') from cwd ' + process.cwd());
    }
    dir = parent;
  }
}

const GENERATED_SERVICES = join('src', 'app', 'core', 'api', 'api');

/**
 * Every operation in the generated client, as its path and whether it sends the bearer token.
 *
 * Read from the generated source rather than from docs/openapi.yaml, because the frontend has no
 * YAML parser and the generator has already done the reading. Each operation sets its credential
 * header, if it has one, before it builds its path. So the text between one `let localVarPath =`
 * and the next holds exactly the next operation's credential line.
 */
function generatedOperations(): { path: string; sendsToken: boolean }[] {
  const dir = join(projectRoot(), GENERATED_SERVICES);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.service.ts'))
    .flatMap((file) => {
      const parts = readFileSync(join(dir, file), 'utf8').split('let localVarPath = `');
      return parts.slice(1).map((part, i) => ({
        path: part.slice(0, part.indexOf('`')),
        sendsToken: parts[i].includes("addCredentialToHeaders('bearerAuth'"),
      }));
    });
}

/**
 * The assumption authInterceptor's AUTH_PREFIX rests on: nothing under /auth/ takes a token. An
 * operation there that did would have its token withheld, get a 401 for it, and log the admin out
 * on every call. This turns that into a failing test at the moment the contract gains one.
 */
describe('the /auth/ operations authInterceptor sends no token to', () => {
  const operations = generatedOperations();

  // Both guard the reading above. Without them, a generator that stopped matching the pattern
  // would pass the real test on an empty list.
  it('finds the auth operations in the generated client', () => {
    expect(operations.map((op) => op.path)).toContain('/auth/login');
  });

  it('sees the token on the operations that do send it', () => {
    expect(operations.filter((op) => op.sendsToken).map((op) => op.path)).toContain('/admin/projects');
  });

  it('includes none that sends a token', () => {
    expect(operations.filter((op) => op.path.startsWith('/auth/') && op.sendsToken)).toEqual([]);
  });
});
