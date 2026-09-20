import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { clearSeoTags, seoContent } from '../../../testing/seo-tags';
import { AboutService } from '../../core/api/api/about.service';
import { AboutPageComponent } from './about-page.component';

const WRITTEN = {
  body: '## Who I am\n\nI build **DSP** things and `numerical` tools.\n\n- one\n- two',
  updatedAt: '2026-09-20T10:00:00Z',
};

describe('AboutPageComponent', () => {
  let getAboutPage: ReturnType<typeof vi.fn>;

  afterEach(() => {
    clearSeoTags();
  });

  async function setUp(response = of(WRITTEN)) {
    clearSeoTags();
    getAboutPage = vi.fn().mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [provideRouter([]), { provide: AboutService, useValue: { getAboutPage } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AboutPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the body as Markdown through the shared renderer', async () => {
    const fixture = await setUp();

    const body = (fixture.nativeElement as HTMLElement).querySelector('.about-body')!;
    expect(body.classList.contains('markdown-body')).toBe(true);
    expect(body.querySelector('h2')?.textContent).toBe('Who I am');
    expect(body.querySelector('strong')?.textContent).toBe('DSP');
    expect(body.querySelector('code')?.textContent).toBe('numerical');
    expect(Array.from(body.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'one',
      'two',
    ]);
    expect(body.textContent).not.toContain('**');
  });

  it('shows a notice, not a blank, for the unwritten page', async () => {
    // The contract's "always exists" state: an empty body is a page with nothing on it yet, and
    // a visitor arriving from the nav should be told so rather than shown an empty column.
    const fixture = await setUp(of({ body: '   ', updatedAt: WRITTEN.updatedAt }));

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.about-empty')).not.toBeNull();
    expect(host.querySelector('.about-body')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('reports a failed load rather than pretending the page is empty', async () => {
    // Distinct from the empty state on purpose: "nothing here yet" and "could not fetch" mean
    // different things to a reader, and collapsing them would hide an outage as an unwritten page.
    const fixture = await setUp(throwError(() => new Error('network')));

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(host.querySelector('.about-empty')).toBeNull();
  });

  it('uses the first real paragraph as the meta description, skipping the heading', async () => {
    await setUp();

    // The summary flattener: a body opening with `## Who I am` must not make those three words
    // the whole tag -- the defect #206 hit on project pages.
    expect(seoContent('meta[name="description"]')).toBe(
      'I build DSP things and numerical tools.',
    );
  });

  it('leaves the meta description alone when the body is empty', async () => {
    await setUp(of({ body: '', updatedAt: WRITTEN.updatedAt }));

    // Nothing was seeded, so nothing should have been written: the route-level description
    // applied on navigation is what an empty page keeps.
    expect(seoContent('meta[name="description"]')).toBeNull();
  });

  it('does not let the body inject markup', async () => {
    const fixture = await setUp(
      of({ body: 'Before <script>window.pwnedAbout = true;</script> after.', updatedAt: WRITTEN.updatedAt }),
    );

    const body = (fixture.nativeElement as HTMLElement).querySelector('.about-body')!;
    // Which assertion is load-bearing: the text one. It is what pins `html: false` -- the DOM
    // check alone is satisfied by Angular's sanitizer, and the global check cannot fail under
    // jsdom, which never executes a script inserted through innerHTML.
    expect(body.querySelector('script')).toBeNull();
    expect((globalThis as Record<string, unknown>)['pwnedAbout']).toBeUndefined();
    expect(body.textContent).toContain('<script>');
  });
});
