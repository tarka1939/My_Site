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

  it('allows navigation when logged in', () => {
    const auth = TestBed.inject(AuthService);
    auth.setSession({ token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    expect(runGuard('/admin/projects')).toBe(true);
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
