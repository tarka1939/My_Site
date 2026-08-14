import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ParamMap,
  TitleStrategy,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { trackImageAttributeOrder } from '../../../../testing/image-attribute-order';
import {
  clearSeoTags,
  seoContent,
  seoTagCount,
  seoTags,
} from '../../../../testing/seo-tags';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { TagsService } from '../../../core/api/api/tags.service';
import { Project } from '../../../core/api/model/project';
import { SeoTitleStrategy } from '../../../core/seo/seo-title.strategy';
import { META_DESCRIPTION_MAX_CHARS, NOINDEX, SITE_DESCRIPTION } from '../../../core/seo/site-meta';
import { PROJECTS_ROUTES } from '../projects.routes';
import { ProjectDetailComponent } from './project-detail.component';

const PROJECT = {
  id: 'p1',
  title: 'Equalizer',
  description: 'A DSP project',
  links: [],
  images: ['https://images.example.com/one.png', 'https://images.example.com/two.png'],
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** Same shape as the drafted content: a stand-alone opening paragraph, then several more. */
const LONG_DESCRIPTION = [
  'A cross-platform, system-level audio equalizer built around a shared C++17 DSP core, with ' +
    'three cooperating modules: a real-time audio daemon and a Windows Audio Processing Object ' +
    'in C++, a 10-band visualiser and settings GUI in C#/Avalonia, and a Python curve generator.',
  `The DSP core is platform-agnostic. ${'Filler prose. '.repeat(30)}`,
  `CurveGen takes a WAV measurement. ${'Further filler prose. '.repeat(30)}`,
].join('\n\n');

describe('ProjectDetailComponent', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let tracker: ReturnType<typeof trackImageAttributeOrder>;
  /** Route params, as a subject so a test can drive a second navigation to another project. */
  let paramMap: BehaviorSubject<ParamMap>;
  const originalTitle = document.title;

  afterEach(() => {
    tracker?.restore();
    clearSeoTags();
    document.title = originalTitle;
  });

  beforeEach(async () => {
    clearSeoTags();
    getProject = vi.fn().mockReturnValue(of(PROJECT));
    paramMap = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'p1' }));

    await TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectsService, useValue: { getProject } },
        { provide: ActivatedRoute, useValue: { paramMap } },
      ],
    }).compileComponents();
  });

  it('renders a completed period as a month/year range', () => {
    getProject.mockReturnValue(
      of({ ...PROJECT, startedOn: '2024-03-01', completedOn: '2025-06-01' }),
    );

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const period = (fixture.nativeElement as HTMLElement).querySelector('.project-period');
    expect(period?.textContent).toContain('March 2024');
    expect(period?.textContent).toContain('June 2025');
    expect([...period!.querySelectorAll('time')].map((t) => t.getAttribute('datetime'))).toEqual([
      '2024-03',
      '2025-06',
    ]);
  });

  it('renders an ongoing project as ongoing', () => {
    getProject.mockReturnValue(of({ ...PROJECT, startedOn: '2026-02-01', completedOn: null }));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const period = (fixture.nativeElement as HTMLElement).querySelector('.project-period');
    expect(period?.textContent).toContain('February 2026');
    expect(period?.textContent).toContain('ongoing');
  });

  it('renders no period at all for a project with neither date', () => {
    // PROJECT carries no startedOn/completedOn -- the page must not show an empty label or a dash.
    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.project-period')).toBeNull();
  });

  it('renders the whole description, including everything the list card clamps away', () => {
    // The counterpart to the list card's summary (#86): clamping the card is only acceptable
    // because the full text is reachable here. Paragraph breaks survive as well -- the description
    // is plain text with `white-space: pre-wrap`, not Markdown.
    getProject.mockReturnValue(of({ ...PROJECT, description: LONG_DESCRIPTION }));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const description = (fixture.nativeElement as HTMLElement).querySelector('.description')!;
    expect(description.textContent).toBe(LONG_DESCRIPTION);
    expect(description.textContent!.split('\n\n')).toHaveLength(3);
  });

  it('does not describe gallery images as screenshots', () => {
    // Issue #87: alt text was `"<title> screenshot <n>"`, which is a false claim for any image
    // that is not a screenshot -- the drafted System Equalizer entry's two images are architecture
    // diagrams. Nothing reachable from the frontend knows an image's type, so the alt text names
    // only the project and the position, and asserts nothing about content.
    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const alts = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.image-gallery img')]
      .map((img) => img.getAttribute('alt'));

    expect(alts).toEqual(['Equalizer, image 1 of 2', 'Equalizer, image 2 of 2']);
    for (const alt of alts) {
      expect(alt).not.toMatch(/screenshot|diagram|photo/i);
    }
  });

  it('keeps gallery images in the accessibility tree rather than marking them decorative', () => {
    // The other half of #87: an empty alt would remove the images entirely, so a screen-reader
    // user would not learn the project has any. They are not redundant with adjacent text -- the
    // description never describes them -- so `alt=""` would be the wrong marking here, unlike on
    // the list card's thumbnail, which sits inside a link already labelled with the title.
    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const images = (fixture.nativeElement as HTMLElement).querySelectorAll('.image-gallery img');
    expect(images.length).toBe(2);
    for (const image of images) {
      expect(image.getAttribute('alt')).not.toBe('');
      expect(image.getAttribute('alt')).toContain('Equalizer');
    }
  });

  it('names a single image with the title alone, with no position and no role word', () => {
    // One image has no position to report, and "image" on its own would be the "image of" prefix
    // WAI's alt decision tree rules out -- assistive tech announces the role itself, so it would
    // read as "Equalizer, image, graphic". The alt stays non-empty, so the image is still in the
    // accessibility tree; it just claims nothing beyond which project it belongs to.
    getProject.mockReturnValue(of({ ...PROJECT, images: ['https://images.example.com/one.png'] }));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const image = (fixture.nativeElement as HTMLElement).querySelector('.image-gallery img')!;
    expect(image.getAttribute('alt')).toBe('Equalizer');
  });

  it('loads the first gallery image eagerly and the rest lazily', () => {
    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    expect(getProject).toHaveBeenCalledWith({ id: 'p1' });

    const images = (fixture.nativeElement as HTMLElement).querySelectorAll('.image-gallery img');
    expect(images.length).toBe(2);
    // The first gallery image is the likely LCP element -- lazy-loading it would delay LCP.
    expect(images[0].getAttribute('loading')).toBe('eager');
    expect(images[0].getAttribute('fetchpriority')).toBe('high');
    expect(images[1].getAttribute('loading')).toBe('lazy');
    expect(images[1].getAttribute('fetchpriority')).toBeNull();
  });

  it('describes the loaded project in the title and meta tags', () => {
    // The route only carries a placeholder ("A project from the portfolio..."), because the project
    // is unknown until this request answers. If this stops running, every project page advertises
    // the same title and description -- which is the duplicate-content case SEO basics exist to fix.
    getProject.mockReturnValue(of({ ...PROJECT, description: LONG_DESCRIPTION }));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    expect(document.title).toBe('My Site - Equalizer');
    expect(seoContent('meta[property="og:title"]')).toBe('My Site - Equalizer');
    expect(seoContent('meta[name="description"]')).toContain('A cross-platform, system-level audio');
    expect(seoContent('meta[property="og:description"]')).toBe(
      seoContent('meta[name="description"]'),
    );
  });

  it('truncates a long description to the meta budget rather than emitting all of it', () => {
    getProject.mockReturnValue(of({ ...PROJECT, description: LONG_DESCRIPTION }));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const description = seoContent('meta[name="description"]')!;
    // +1 for the appended ellipsis, which sits outside the character budget by design.
    expect(description.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX_CHARS + 1);
    expect(description.endsWith('…')).toBe(true);
    // Only the opening paragraph, never the filler prose from the ones after it.
    expect(description).not.toContain('Filler prose');
  });

  it('replaces the tags when moving to another project instead of adding a second set', () => {
    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();
    expect(seoContent('meta[name="description"]')).toBe('A DSP project');

    getProject.mockReturnValue(
      of({ ...PROJECT, id: 'p2', title: 'CurveGen', description: 'A curve generator' }),
    );
    paramMap.next(convertToParamMap({ id: 'p2' }));
    fixture.detectChanges();

    expect(seoTagCount('meta[name="description"]')).toBe(1);
    expect(seoTagCount('meta[property="og:description"]')).toBe(1);
    expect(seoTagCount('meta[property="og:title"]')).toBe(1);
    expect(seoContent('meta[name="description"]')).toBe('A curve generator');
    expect(document.title).toBe('My Site - CurveGen');
  });

  it('falls back to the site description for a project with no description', () => {
    // The contract requires minLength 1, so this should be unreachable -- but an empty tag is a
    // worse answer than the site-level sentence, and "should be unreachable" is not "is".
    getProject.mockReturnValue(of({ ...PROJECT, description: '   ' }));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    expect(seoContent('meta[name="description"]')).toBe(SITE_DESCRIPTION);
    expect(document.title).toBe('My Site - Equalizer');
  });

  it('does not produce broken markup for a description full of quotes and angle brackets', () => {
    // Descriptions are admin-authored free text, so they can contain exactly the characters that
    // terminate an HTML attribute. The tag is written with setAttribute, so the value round-trips
    // and the browser escapes it on serialisation; nothing is injected into the document.
    const nasty = 'Reads "config.xml" & <b>renders</b> it — a <script>alert(1)</script> test';
    getProject.mockReturnValue(of({ ...PROJECT, title: 'A "quoted" & <angled> title', description: nasty }));
    const scriptsBefore = document.querySelectorAll('script').length;

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    expect(seoContent('meta[name="description"]')).toBe(nasty);
    expect(document.title).toBe('My Site - A "quoted" & <angled> title');
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);

    const markup = seoTags('meta[name="description"]')[0].outerHTML;
    expect(markup).toContain('&quot;');
    expect(markup).toContain('&amp;');
    expect(markup).not.toContain('content="Reads "config.xml"');
  });

  it('marks a project that could not be loaded noindex', () => {
    // Netlify serves an unknown /projects/<id> as 200 with the app shell, so a deleted project's
    // URL would otherwise stay indexable under the route's generic placeholder description.
    getProject.mockReturnValue(throwError(() => new Error('404')));

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    expect(seoContent('meta[name="robots"]')).toBe(NOINDEX);
  });

  // ('leaves a successfully loaded project indexable' used to sit here, asserting that no robots
  // tag existed after a load that never writes one -- it passed with the whole success path
  // deleted. The transition it was reaching for needs the real router, so it now lives in the
  // block below as 'clears the noindex ... when the next project loads'.)

  it('sets loading on gallery images before src, not after it', () => {
    // Asserting the final attribute values is not enough: `[attr.loading]="..."` placed after
    // `[src]` produces exactly the same DOM in jsdom, and is the documented way to defeat lazy
    // loading in a real browser, because the binding lands in the update pass after src is set.
    // Static attributes on two elements are written during the creation pass instead, and that is
    // what this asserts -- so collapsing the two branches into one bound element fails here.
    tracker = trackImageAttributeOrder();

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();

    const images = (fixture.nativeElement as HTMLElement).querySelectorAll('.image-gallery img');
    expect(images.length).toBe(2);
    for (const image of images) {
      const order = tracker.writesFor(image).filter((name) => name === 'loading' || name === 'src');
      expect(order).toEqual(['loading', 'src']);
    }
  });
});

/**
 * The tags this component writes land in `document.head`, which outlives it, so the interesting
 * cases are the ones where a response arrives after the page has moved on. Those need the real
 * router (a stub `ActivatedRoute` never destroys anything and never runs the title strategy), so
 * this block wires the real route table, the real `SeoTitleStrategy` and the real component
 * together, and controls response timing with one `Subject` per request.
 */
describe('ProjectDetailComponent, when the page moves on before a response lands', () => {
  /** One controllable response per requested id -- a test decides when, and whether, it resolves. */
  let requests: Map<string, Subject<Project>>;
  const originalTitle = document.title;

  /** Read off the real route table rather than copied, so editing the prose cannot break this. */
  const LANDING_DESCRIPTION = PROJECTS_ROUTES.find((route) => route.path === '')?.data?.[
    'description'
  ] as string;

  const EMPTY_PAGE = { content: [], page: 0, size: 12, totalElements: 0, totalPages: 0 };

  beforeEach(() => {
    clearSeoTags();
    requests = new Map();
    const getProject = vi.fn(({ id }: { id: string }) => {
      const response = new Subject<Project>();
      requests.set(id, response);
      return response.asObservable();
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter(PROJECTS_ROUTES),
        { provide: TitleStrategy, useClass: SeoTitleStrategy },
        { provide: ProjectsService, useValue: { getProject, listProjects: () => of(EMPTY_PAGE) } },
        // The landing route renders the real list component, which asks for the tag filter.
        { provide: TagsService, useValue: { listTags: () => of([]) } },
      ],
    });
  });

  afterEach(() => {
    clearSeoTags();
    document.title = originalTitle;
  });

  function requestFor(id: string): Subject<Project> {
    const response = requests.get(id);
    expect(response, `no request was made for '${id}'`).toBeDefined();
    return response!;
  }

  function resolve(id: string, project: Partial<Project>): void {
    const response = requestFor(id);
    response.next({ ...PROJECT, ...project });
    response.complete();
  }

  it('leaves no noindex behind on the landing page when the abandoned request then fails', async () => {
    // The de-indexing case, end to end: /projects/<gone> is still in flight when the visitor goes
    // back to the site root, and only then 404s. Before switchMap/takeUntilDestroyed the destroyed
    // component still received that error and ran setRobots(NOINDEX), stamping "noindex, nofollow"
    // onto the public landing page -- invisible in the UI, and nothing else ever removes it,
    // because the tag is only cleared by a *later* navigation.
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/projects/gone');
    expect(requestFor('gone').observed).toBe(true);

    await harness.navigateByUrl('/');
    // The subscription is gone with the component, so the error below cannot be delivered.
    expect(requestFor('gone').observed).toBe(false);

    requestFor('gone').error(new Error('404'));

    expect(seoContent('meta[name="robots"]')).toBeNull();
    expect(seoTagCount('meta[name="robots"]')).toBe(0);
    // Still unambiguously the landing page, not a half-updated one.
    expect(document.title).toBe('My Site - Projects');
    expect(seoContent('meta[name="description"]')).toBe(LANDING_DESCRIPTION);
  });

  it('leaves the landing page’s own title and description alone when a late request succeeds', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects/p1');
    await harness.navigateByUrl('/');

    resolve('p1', { title: 'Equalizer', description: 'A DSP project' });

    expect(document.title).toBe('My Site - Projects');
    expect(seoContent('meta[property="og:title"]')).toBe('My Site - Projects');
    expect(seoContent('meta[name="description"]')).toBe(LANDING_DESCRIPTION);
    expect(seoContent('meta[property="og:description"]')).toBe(LANDING_DESCRIPTION);
  });

  it('describes the project being viewed when an earlier one answers out of order', async () => {
    // Same component instance across the two ids, so the escape here is switchMap rather than
    // destruction: B is requested second and answers first, then A answers. Without cancellation
    // A wins by arriving last and /projects/b advertises project A.
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects/a');
    await harness.navigateByUrl('/projects/b');
    expect(requestFor('a').observed).toBe(false);

    resolve('b', { id: 'b', title: 'Bee', description: 'B description.' });
    resolve('a', { id: 'a', title: 'Ay', description: 'A description.' });

    expect(document.title).toBe('My Site - Bee');
    expect(seoContent('meta[name="description"]')).toBe('B description.');
    expect(seoTagCount('meta[name="description"]')).toBe(1);
  });

  it('clears the noindex from a project that failed to load when the next project loads', async () => {
    // Replaces a test that asserted a robots tag was absent on a path that never set one, so it
    // passed with the success path deleted. This drives the transition the component's own comment
    // relies on: the failed load marks the page noindex, and the next navigation must undo it --
    // and the project that does load must actually describe itself, or the first two assertions
    // would pass on a component that did nothing at all.
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/projects/gone');
    requestFor('gone').error(new Error('404'));
    expect(seoContent('meta[name="robots"]')).toBe(NOINDEX);

    await harness.navigateByUrl('/projects/p1');
    resolve('p1', { title: 'Equalizer', description: 'A DSP project' });

    expect(seoTagCount('meta[name="robots"]')).toBe(0);
    expect(document.title).toBe('My Site - Equalizer');
    expect(seoContent('meta[name="description"]')).toBe('A DSP project');
  });
});
