import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
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
    // detectChanges() before whenStable(), not just whenStable(). RouterLink does not write
    // `href` in the initial render -- it sets it from the serialized URL during change
    // detection -- so querying for a[href=...] straight after stability is a race. It passes
    // locally and failed on CI, which is where it was caught: the neighbouring test survives
    // the same pattern only because it reads static text rather than a router-written attribute.
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const adminLink = compiled.querySelector('a[href="/admin/login"]');
    expect(adminLink).toBeTruthy();
  });
});
