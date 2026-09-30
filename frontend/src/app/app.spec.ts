import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

@Component({ template: '' })
class StubComponent {}

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

// #225. routerLinkActive only draws the underline; a screen reader learns the current page from
// aria-current, and nothing else on About says "About" -- its heading is the owner's name. The
// routes here mirror app.routes.ts's shapes (About exact at '', Projects a prefix that also covers
// a detail page) with stub components, because the matching is what is under test, not the pages.
describe('App primary nav: the current page', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: '', pathMatch: 'full', component: StubComponent },
          { path: 'projects', component: StubComponent },
          { path: 'projects/:id', component: StubComponent },
          { path: 'contact', component: StubComponent },
        ]),
      ],
    }).compileComponents();
  });

  /** Every nav link carrying aria-current, as "text=value", after navigating to `url`. */
  async function currentLinksAt(url: string): Promise<string[]> {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav[aria-label="Primary"]');
    return Array.from(nav?.querySelectorAll('[aria-current]') ?? []).map(
      (link) => `${link.textContent?.trim()}=${link.getAttribute('aria-current')}`,
    );
  }

  // Exactly one link each time. The '/' case is the one a prefix match would get wrong: every URL
  // starts with '/', so without `exact` About would also claim to be current on every other page,
  // and the '/projects' rows would come back with two entries rather than one.
  it.each([
    ['/', ['About=page']],
    ['/projects', ['Projects=page']],
    ['/projects/3f1c', ['Projects=page']],
    ['/contact', ['Contact=page']],
  ])('at %s, marks only %j', async (url, expected) => {
    expect(await currentLinksAt(url)).toEqual(expected);
  });
});
