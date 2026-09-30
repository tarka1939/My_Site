import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('starts logged out with no stored session', () => {
    const service = TestBed.inject(AuthService);

    expect(service.isLoggedIn()).toBe(false);
    expect(service.token()).toBeNull();
  });

  it('becomes logged in after setSession with a future expiry', () => {
    const service = TestBed.inject(AuthService);
    service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(service.isLoggedIn()).toBe(true);
    expect(service.token()).toBe('abc123');
  });

  it('treats an already-expired session as logged out', () => {
    const service = TestBed.inject(AuthService);
    service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() - 60_000).toISOString() });

    expect(service.isLoggedIn()).toBe(false);
  });

  // #151, and found in the browser after every test in this file had passed. isLoggedIn was a
  // computed(), which memoizes: it re-runs only when a signal it read has changed, and the clock is
  // not a signal. Each test above sets a session that is expired already, so the first evaluation
  // came after the expiry and the cache never showed. In a real tab the header reads isLoggedIn()
  // straight after login, and from then on it answered true for as long as the tab lived.
  it('stops reporting logged in when the expiry passes, having said true before it did', () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const service = TestBed.inject(AuthService);
      service.setSession({ token: 'abc123', expiresAt: new Date(now + 60_000).toISOString() });
      expect(service.isLoggedIn()).toBe(true);

      clock.mockReturnValue(now + 61_000);

      expect(service.isLoggedIn()).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('still reports hasToken for a session that has expired by wall clock', () => {
    // The one window the two predicates are meant to disagree in, and the reason hasToken() exists:
    // "may this person use the admin area" is already no, while "did we hold a credential the
    // server could have just rejected" is still yes. errorInterceptor needs the second question --
    // asking the first gave it the wrong answer for ordinary expiry (issue #108).
    const service = TestBed.inject(AuthService);
    service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() - 60_000).toISOString() });

    expect(service.isLoggedIn()).toBe(false);
    expect(service.hasToken()).toBe(true);
  });

  it('reports no token before a session is set and after logout', () => {
    const service = TestBed.inject(AuthService);
    expect(service.hasToken()).toBe(false);

    service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(service.hasToken()).toBe(true);

    service.logout();
    expect(service.hasToken()).toBe(false);
  });

  it('clears the token and storage on logout', () => {
    const service = TestBed.inject(AuthService);
    service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    service.logout();

    expect(service.isLoggedIn()).toBe(false);
    expect(service.token()).toBeNull();
    expect(sessionStorage.getItem('mysite.admin.session')).toBeNull();
  });

  it('restores a valid session from sessionStorage on construction', () => {
    sessionStorage.setItem(
      'mysite.admin.session',
      JSON.stringify({ token: 'restored', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    );

    const service = TestBed.inject(AuthService);

    expect(service.isLoggedIn()).toBe(true);
    expect(service.token()).toBe('restored');
  });

  it('discards an expired stored session on construction', () => {
    sessionStorage.setItem(
      'mysite.admin.session',
      JSON.stringify({ token: 'stale', expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    );

    const service = TestBed.inject(AuthService);

    expect(service.isLoggedIn()).toBe(false);
    expect(sessionStorage.getItem('mysite.admin.session')).toBeNull();
  });

  // #151. authGuard calls this on every redirect to the login page, and a guard can run for a
  // navigation that is then cancelled. That is safe only because this never ends a live session --
  // which authGuard's own spec cannot show, since the guard only calls it once isLoggedIn() is
  // already false. So the promise is pinned here, where it is made.
  describe('clearExpiredSession', () => {
    it('clears a session that has expired, from the signals and from storage', () => {
      const service = TestBed.inject(AuthService);
      service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() - 60_000).toISOString() });

      service.clearExpiredSession();

      expect(service.hasToken()).toBe(false);
      expect(sessionStorage.getItem('mysite.admin.session')).toBeNull();
    });

    it('leaves a live session exactly as it was', () => {
      const service = TestBed.inject(AuthService);
      service.setSession({ token: 'abc123', expiresAt: new Date(Date.now() + 60_000).toISOString() });

      service.clearExpiredSession();

      expect(service.isLoggedIn()).toBe(true);
      expect(service.token()).toBe('abc123');
      expect(sessionStorage.getItem('mysite.admin.session')).not.toBeNull();
    });
  });
});
