import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { trackImageAttributeOrder } from '../../../../testing/image-attribute-order';
import { ProjectsService } from '../../../core/api/api/projects.service';
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

  afterEach(() => tracker?.restore());

  beforeEach(async () => {
    getProject = vi.fn().mockReturnValue(of(PROJECT));

    await TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectsService, useValue: { getProject } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'p1' })) } },
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
