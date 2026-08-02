import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService as AuthApiService } from '../../../core/api/api/auth.service';
import { AuthService } from '../../../core/auth/auth.service';
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
