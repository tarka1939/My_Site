import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function runGuard(url: string) {
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('allows navigation when logged in, and leaves the session where it is', () => {
    const auth = TestBed.inject(AuthService);
    auth.setSession({ token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(runGuard('/admin/projects')).toBe(true);
    expect(auth.token()).toBe('t');
    expect(sessionStorage.getItem('mysite.admin.session')).not.toBeNull();
  });

  // #151. The redirect used to leave the dead token in the signal and in storage, where
  // authInterceptor went on attaching it to every request for the life of the tab.
  it('clears an expired session on its way to the login page', () => {
    const auth = TestBed.inject(AuthService);
    auth.setSession({ token: 'dead', expiresAt: new Date(Date.now() - 1_000).toISOString() });
    expect(auth.hasToken()).toBe(true); // the state the guard used to leave behind

    const result = runGuard('/admin/projects');

    expect(result instanceof UrlTree).toBe(true);
    expect(auth.hasToken()).toBe(false);
    expect(sessionStorage.getItem('mysite.admin.session')).toBeNull();
  });

  it('redirects to /admin/login with a returnUrl when logged out', () => {
    const result = runGuard('/admin/projects') as UrlTree;
    const router = TestBed.inject(Router);

    expect(result instanceof UrlTree).toBe(true);
    const serialized = router.serializeUrl(result);
    expect(serialized).toContain('/admin/login');
    expect(serialized).toContain('returnUrl=%2Fadmin%2Fprojects');
  });
});
