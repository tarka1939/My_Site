import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    // AuthService reads the stored session in its *constructor*, so "logged out" is a precondition
    // this file has to establish rather than assume. Every other spec touching auth clears storage
    // in its own beforeEach (auth.service, auth.guard, error.interceptor, admin-login); this one
    // never did, and its logged-out assertion is the only one in the suite that has failed on CI
    // while passing locally. Whether that is the cause is not yet proven -- see the comment on the
    // assertion below -- but a test named "when logged out" that does not establish being logged
    // out is wrong regardless of which defect it is currently hiding.
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders primary navigation with a link to the projects page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav[aria-label="Primary"]')).toBeTruthy();
    expect(compiled.querySelector('.site-nav__brand')?.textContent).toContain('Krzysztof Tarka');
  });

  it('shows an "Admin" login link when logged out', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const nav = compiled.querySelector('nav[aria-label="Primary"]');

    // The message matters as much as the assertion. This failed twice on CI and never once locally,
    // and both times all it said was "expected null to be truthy" -- which cannot tell apart the two
    // ways it can fail. Either the anchor rendered and carries no href, or the @else branch never
    // rendered at all because isLoggedIn() was true. Those have opposite fixes, and guessing between
    // them is what produced PR #199's fix, which did not hold. Printing the nav means the next
    // failure names the cause instead of restarting the guesswork.
    expect(
      compiled.querySelector('a[href="/admin/login"]'),
      `no /admin/login anchor. Rendered nav was: ${nav?.outerHTML ?? '(no nav at all)'}`,
    ).toBeTruthy();
  });
});
