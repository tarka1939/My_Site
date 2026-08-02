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
});
