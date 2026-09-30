import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AboutService } from '../../core/api/api/about.service';
import { ProjectsService } from '../../core/api/api/projects.service';
import { AuthService } from '../../core/auth/auth.service';
import { ADMIN_ROUTES } from './admin.routes';

/**
 * The guard's wiring on the real admin route table, which auth.guard.spec.ts cannot see: it calls
 * the guard directly, so it passes whether the table runs that guard on every admin navigation or
 * only on the first one. The table did the latter until #151's review -- canActivate on a
 * componentless parent that sibling navigation reuses -- and an expired admin could walk from
 * /admin/projects into the About editor, only meeting the login page when the save was refused.
 */

const EMPTY_PAGE = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

describe('admin routes', () => {
  const start = Date.now();
  let getAboutPage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // AuthService reads the stored session in its constructor.
    sessionStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(start);
    getAboutPage = vi.fn(() => of({ body: '', updatedAt: '2026-09-20T10:00:00Z' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'admin', children: ADMIN_ROUTES }]),
        { provide: AboutService, useValue: { getAboutPage } },
        { provide: ProjectsService, useValue: { listAllProjects: () => of(EMPTY_PAGE) } },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function logInFor(ms: number): AuthService {
    const auth = TestBed.inject(AuthService);
    auth.setSession({ token: 'abc123', expiresAt: new Date(start + ms).toISOString() });
    return auth;
  }

  function expireSession(): void {
    vi.mocked(Date.now).mockReturnValue(start + 61_000);
  }

  it('guards the first way into the admin area, as before', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/projects');

    expect(TestBed.inject(Router).url).toBe('/admin/login?returnUrl=%2Fadmin%2Fprojects');
  });

  it.each(['/admin/about', '/admin/projects/new'])(
    'sends an admin whose session expired on one admin page to the login page on the way to %s',
    async (next) => {
      const auth = logInFor(60_000);
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/admin/projects');
      // Not vacuous: the session was live, and the list is where the admin actually was.
      expect(TestBed.inject(Router).url).toBe('/admin/projects');

      expireSession();
      await harness.navigateByUrl(next);

      expect(TestBed.inject(Router).url).toBe(`/admin/login?returnUrl=${encodeURIComponent(next)}`);
      expect(auth.hasToken()).toBe(false);
      expect(getAboutPage).not.toHaveBeenCalled();
    },
  );

  it('lets a live session move between admin pages', async () => {
    logInFor(60_000);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/projects');
    await harness.navigateByUrl('/admin/about');

    expect(TestBed.inject(Router).url).toBe('/admin/about');
    expect(getAboutPage).toHaveBeenCalledTimes(1);
  });
});
