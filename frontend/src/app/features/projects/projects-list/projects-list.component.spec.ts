import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CanvasRecording, recordCanvas } from '../../../../testing/canvas';
import { trackImageAttributeOrder } from '../../../../testing/image-attribute-order';
import { clickOn, renderComponent } from '../../../../testing/zoneless';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { TagsService } from '../../../core/api/api/tags.service';
import { CARD_EXCERPT_MAX_CHARS } from '../../../shared/description-excerpt/description-excerpt';
import { ProjectsListComponent } from './projects-list.component';

const PROJECT = {
  id: 'p1',
  title: 'Equalizer',
  description: 'A DSP project',
  links: [],
  images: [],
  tags: [{ id: 't1', name: 'dsp' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const PROJECT_WITH_IMAGE = {
  ...PROJECT,
  id: 'p2',
  title: 'Reverb',
  images: ['https://images.example.com/reverb.png'],
};

const OTHER_PROJECT_WITH_IMAGE = {
  ...PROJECT,
  id: 'p3',
  title: 'Delay',
  images: ['https://images.example.com/delay.png'],
};

/** A second imageless project, so one grid holds two cards that must not draw the same thing. */
const ARTWORK_NEIGHBOUR = { ...PROJECT, id: 'p7', title: 'Colour Pipeline' };

const COMPLETED_PROJECT = {
  ...PROJECT,
  id: 'p4',
  title: 'Compressor',
  startedOn: '2024-03-01',
  completedOn: '2025-06-01',
};

const ONGOING_PROJECT = {
  ...PROJECT,
  id: 'p5',
  title: 'Synth',
  startedOn: '2026-02-01',
  completedOn: null,
};

/** Shaped like the real drafted content: a stand-alone opening paragraph, then several more. */
const FIRST_PARAGRAPH =
  'A cross-platform, system-level audio equalizer built around a shared C++17 DSP core, with ' +
  'three cooperating modules: a real-time audio daemon and a Windows Audio Processing Object in ' +
  'C++, a 10-band visualiser and settings GUI in C#/Avalonia, and a Python curve generator.';

/** Appears only after the first paragraph, so it is a marker for "the clamp let too much through". */
const LATER_PARAGRAPH_MARKER = 'OVERFLOWING-TAIL-CONTENT';

const LONG_DESCRIPTION = [
  FIRST_PARAGRAPH,
  `${LATER_PARAGRAPH_MARKER} the DSP core is platform-agnostic. ${'Filler prose. '.repeat(30)}`,
  `More ${LATER_PARAGRAPH_MARKER}. ${'Further filler prose. '.repeat(30)}`,
].join('\n\n');

const LONG_DESCRIPTION_PROJECT = { ...PROJECT, id: 'p6', description: LONG_DESCRIPTION };

function pageOf(content: unknown[]) {
  return of({ content, page: 0, size: 12, totalElements: content.length, totalPages: 1 });
}

describe('ProjectsListComponent', () => {
  let listProjects: ReturnType<typeof vi.fn>;
  let listTags: ReturnType<typeof vi.fn>;
  let tracker: ReturnType<typeof trackImageAttributeOrder>;
  let canvas: CanvasRecording;

  afterEach(() => {
    tracker?.restore();
    canvas.restore();
  });

  /** The draw calls made by the artwork on the card at `index`, in order. */
  function artworkOps(
    fixture: ComponentFixture<ProjectsListComponent>,
    index: number,
  ): readonly string[] {
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.project-card app-project-artwork canvas',
    );
    return canvas.opsFor(cards[index] as HTMLCanvasElement);
  }

  beforeEach(async () => {
    // Stubbed for the whole file rather than only the artwork tests: most fixtures here have
    // no images, so most of these tests now render a card that draws its own artwork, and
    // jsdom implements no 2D context -- letting the real call through would print a "not
    // implemented" error under every one of them.
    canvas = recordCanvas();
    listProjects = vi.fn().mockReturnValue(
      of({ content: [PROJECT], page: 0, size: 12, totalElements: 1, totalPages: 1 }),
    );
    listTags = vi.fn().mockReturnValue(of([{ id: 't1', name: 'dsp' }]));

    await TestBed.configureTestingModule({
      imports: [ProjectsListComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectsService, useValue: { listProjects } },
        { provide: TagsService, useValue: { listTags } },
      ],
    }).compileComponents();
  });

  it('loads and renders projects on init', () => {
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    expect(listProjects).toHaveBeenCalledWith({ page: 0, size: 12, tag: undefined });
    expect(fixture.componentInstance['projects']()).toEqual([PROJECT]);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Equalizer');
  });

  it('re-fetches with the tag filter when a tag is toggled, and marks it pressed', async () => {
    // Clicked rather than toggleTag()'d, and awaited rather than detectChanges()'d: the pressed
    // state is the only feedback the visitor gets that the filter took, and it repaints only if
    // the click marked the view dirty. Asserting the re-fetch alone reads as coverage of a filter
    // that could look untouched the whole time -- the request is invisible, the button is not.
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('.tag-filter button')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');

    await clickOn(fixture, '.tag-filter button');

    expect(listProjects).toHaveBeenLastCalledWith({ page: 0, size: 12, tag: ['dsp'] });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList.contains('is-selected')).toBe(true);
  });

  it('loads the first card image eagerly and the rest lazily', () => {
    listProjects.mockReturnValue(pageOf([PROJECT_WITH_IMAGE, OTHER_PROJECT_WITH_IMAGE]));

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const images = (fixture.nativeElement as HTMLElement).querySelectorAll('.project-card img');
    expect(images.length).toBe(2);
    // The first card is the above-the-fold LCP candidate -- lazy-loading it would delay LCP.
    expect(images[0].getAttribute('loading')).toBe('eager');
    expect(images[0].getAttribute('fetchpriority')).toBe('high');
    expect(images[1].getAttribute('loading')).toBe('lazy');
    expect(images[1].getAttribute('fetchpriority')).toBeNull();
  });

  it('keeps the eager treatment on the first rendered image when earlier projects have none', () => {
    // The regression this guards: `$first` indexes over projects, not over rendered images, so
    // keying off it means one imageless project at the top of a createdAt-DESC list silently
    // demotes every image on the page to loading="lazy" with no fetchpriority.
    listProjects.mockReturnValue(
      pageOf([PROJECT, PROJECT_WITH_IMAGE, OTHER_PROJECT_WITH_IMAGE]),
    );

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.project-card');
    expect(cards.length).toBe(3);
    expect(cards[0].querySelector('img')).toBeNull();

    const images = (fixture.nativeElement as HTMLElement).querySelectorAll('.project-card img');
    expect(images.length).toBe(2);
    expect(images[0].getAttribute('loading')).toBe('eager');
    expect(images[0].getAttribute('fetchpriority')).toBe('high');
    expect(images[1].getAttribute('loading')).toBe('lazy');
    expect(images[1].getAttribute('fetchpriority')).toBeNull();
  });

  it('sets loading on card images before src, not after it', () => {
    // Asserting the final attribute values is not enough: `[attr.loading]="..."` placed after
    // `[src]` produces exactly the same DOM in jsdom, and is the documented way to defeat lazy
    // loading in a real browser, because the binding lands in the update pass after src is set.
    // Static attributes on two elements are written during the creation pass instead, and that is
    // what this asserts -- so collapsing the two branches into one bound element fails here.
    tracker = trackImageAttributeOrder();
    listProjects.mockReturnValue(pageOf([PROJECT_WITH_IMAGE, OTHER_PROJECT_WITH_IMAGE]));

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const images = (fixture.nativeElement as HTMLElement).querySelectorAll('.project-card img');
    expect(images.length).toBe(2);
    for (const image of images) {
      const order = tracker.writesFor(image).filter((name) => name === 'loading' || name === 'src');
      expect(order).toEqual(['loading', 'src']);
    }
  });

  it('summarises a long description on the card instead of rendering all of it', () => {
    // Issue #86: the card interpolated `project.description` whole. Real entries run 1000-2400
    // characters (the contract allows 5000), which turns every card into a wall of text and makes
    // the grid meaningless. Asserting on the *text in the DOM* rather than on the stylesheet is
    // what makes this fail if the summary is removed -- a CSS-only clamp would still leave the
    // whole description in the accessibility tree and in the markup.
    expect(LONG_DESCRIPTION.length).toBeGreaterThan(1000);
    listProjects.mockReturnValue(pageOf([LONG_DESCRIPTION_PROJECT]));

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const card = (fixture.nativeElement as HTMLElement).querySelector('.project-card')!;
    const summary = card.querySelector('.card-description')!.textContent!;

    expect(summary.length).toBeLessThanOrEqual(CARD_EXCERPT_MAX_CHARS + 1);
    expect(summary.startsWith('A cross-platform, system-level audio equalizer')).toBe(true);
    expect(summary.endsWith('…')).toBe(true);
    // Nothing past the first paragraph reaches the card at all -- not hidden elsewhere in it either.
    expect(card.textContent).not.toContain(LATER_PARAGRAPH_MARKER);
    expect(card.textContent!.length).toBeLessThan(LONG_DESCRIPTION.length);
  });

  it('renders a short description in full, with no ellipsis', () => {
    // The clamp must not mark text as truncated when it is not: PROJECT's description is one line.
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const summary = (fixture.nativeElement as HTMLElement).querySelector('.card-description')!;
    expect(summary.textContent).toBe(PROJECT.description);
  });

  it('clamps the summary by lines, not by a fixed height', () => {
    // The character cap above bounds the payload; this bounds what is on screen. They are separate
    // failures: a 200-character excerpt is two lines on a wide card and five on a phone, so without
    // a line clamp the grid still has ragged cards. jsdom does no layout, so this asserts the
    // declarations that actually cascade onto the element -- i.e. that the rule exists, matches
    // this element, and survives Angular's style encapsulation -- not the rendered line count.
    listProjects.mockReturnValue(pageOf([LONG_DESCRIPTION_PROJECT]));

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const summary = (fixture.nativeElement as HTMLElement).querySelector('.card-description')!;
    const style = getComputedStyle(summary);

    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('3');
    expect(style.display).toBe('-webkit-box');
    // The one declaration whose removal is both silent and total: `-webkit-box` without an
    // explicit `vertical` orientation lays the text out in a single horizontal box, so the clamp
    // becomes completely inert in a real browser while every other assertion here still passes.
    // It is also the declaration most at risk from a minifier, since it is the only one of the
    // four with no unprefixed equivalent to fall back to.
    expect(style.getPropertyValue('-webkit-box-orient')).toBe('vertical');
    expect(style.overflow).toBe('hidden');
    // No pixel height anywhere in the clamp: one would cut mid-line as soon as the user zooms.
    expect(style.height).not.toMatch(/px/);
    expect(style.maxHeight).not.toMatch(/px/);
  });

  it('marks the card thumbnail decorative rather than repeating the project title', () => {
    // The thumbnail sits inside a link whose visible text is the title, so alt text here is
    // redundant with adjacent text and makes the link announce "Reverb Reverb". Empty alt is
    // W3C/WAI's marking for that case. The detail gallery is a different case -- see #87 and
    // shared/project-image-alt/project-image-alt.ts.
    listProjects.mockReturnValue(pageOf([PROJECT_WITH_IMAGE]));

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('.project-card a')!;
    expect(link.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(link.textContent).toContain('Reverb');
  });

  // --- Generated card artwork (docs/DECISIONS.md, 2026-08-22) -----------------------------------
  //
  // Rendered through renderComponent/whenStable rather than detectChanges(): the paint is a
  // *reaction* to the view existing, so awaiting it asserts the same sequence a browser runs
  // rather than one forced by the test. See testing/zoneless.ts.

  it('draws a project its own artwork when it has no image', async () => {
    const fixture = await renderComponent(ProjectsListComponent);

    const slot = (fixture.nativeElement as HTMLElement).querySelector('.project-card .card-media')!;
    expect(slot.querySelector('img')).toBeNull();
    const artwork = slot.querySelector('app-project-artwork')!;
    expect(artwork).not.toBeNull();
    expect(canvas.requests.length).toBe(1);
    expect(canvas.opsFor(artwork.querySelector('canvas')!).length).toBeGreaterThan(0);
  });

  it('renders the image and no generated artwork when a project has one', async () => {
    listProjects.mockReturnValue(pageOf([PROJECT_WITH_IMAGE]));

    const fixture = await renderComponent(ProjectsListComponent);

    const slot = (fixture.nativeElement as HTMLElement).querySelector('.card-media')!;
    expect(slot.querySelector('img')!.getAttribute('src')).toBe(PROJECT_WITH_IMAGE.images[0]);
    expect(slot.querySelector('app-project-artwork')).toBeNull();
    // Not merely hidden: the generator must not *run* for a card that has an image, which is why
    // it sits in the @else branch rather than behind a flag. Nothing asked for a context at all.
    expect(canvas.requests).toEqual([]);
  });

  it('draws the same artwork for a project every time it is rendered', async () => {
    // Two independent renders. "Stable across reloads" is a claim about repeated construction,
    // and a seed memoised inside one component instance satisfies a weaker version of it.
    const first = await renderComponent(ProjectsListComponent);
    const second = await renderComponent(ProjectsListComponent);

    expect(artworkOps(first, 0).length).toBeGreaterThan(0);
    expect(artworkOps(second, 0)).toEqual(artworkOps(first, 0));
  });

  it('draws different artwork for two projects in the same grid', async () => {
    listProjects.mockReturnValue(pageOf([PROJECT, ARTWORK_NEIGHBOUR]));

    const fixture = await renderComponent(ProjectsListComponent);

    expect(artworkOps(fixture, 0).length).toBeGreaterThan(0);
    expect(artworkOps(fixture, 1)).not.toEqual(artworkOps(fixture, 0));
  });

  it('keeps the generated artwork out of the accessibility tree', async () => {
    const fixture = await renderComponent(ProjectsListComponent);

    const link = (fixture.nativeElement as HTMLElement).querySelector('.project-card a')!;
    expect(link.querySelector('app-project-artwork')!.getAttribute('aria-hidden')).toBe('true');
    // The link's accessible name stays the title alone. textContent concatenates aria-hidden and
    // visually-hidden siblings, so artwork contributing any text would surface right here.
    expect(link.textContent!.trim()).toBe(PROJECT.title);
  });

  it('gives every card one media slot of a fixed height, whatever the slot holds', async () => {
    // The uniform-row assertion available without layout: jsdom measures nothing, so what can be
    // checked is that the slot is on every card, holds exactly one thing, and takes its height
    // from the stylesheet rather than from its content. The rendered heights themselves need a
    // browser -- see CLAUDE.md, "A test cannot see appearance".
    listProjects.mockReturnValue(pageOf([PROJECT, PROJECT_WITH_IMAGE, OTHER_PROJECT_WITH_IMAGE]));

    const fixture = await renderComponent(ProjectsListComponent);

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.project-card');
    expect(cards.length).toBe(3);
    for (const card of cards) {
      const slots = card.querySelectorAll('.card-media');
      expect(slots.length).toBe(1);
      expect(slots[0].children.length).toBe(1);
      const style = getComputedStyle(slots[0]);
      expect(style.height).toBe('10rem');
      expect(style.overflow).toBe('hidden');
    }
  });

  it('contains a card image rather than scaling it up to fill the slot', async () => {
    // The regression this pins: `object-fit: cover` on a fixed-height slot enlarges anything
    // smaller than the box. One of the two real images is a 187x150 SVG diagram in a 160px slot,
    // and it was being blown up past its natural size. scale-down never enlarges.
    listProjects.mockReturnValue(pageOf([PROJECT_WITH_IMAGE]));

    const fixture = await renderComponent(ProjectsListComponent);

    const style = getComputedStyle((fixture.nativeElement as HTMLElement).querySelector('img')!);
    expect(style.objectFit).toBe('scale-down');
  });

  it('shows each card period as month/year, ongoing where there is no end date', () => {
    // PROJECT has neither date -- its card must show no period element at all, rather than an
    // empty label or a dangling dash.
    listProjects.mockReturnValue(pageOf([COMPLETED_PROJECT, ONGOING_PROJECT, PROJECT]));

    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.project-card');
    expect(cards.length).toBe(3);

    const completed = cards[0].querySelector('.project-period');
    expect(completed?.textContent).toContain('March 2024');
    expect(completed?.textContent).toContain('June 2025');
    // Month precision in the machine-readable value too -- the stored day never surfaces.
    expect([...cards[0].querySelectorAll('time')].map((t) => t.getAttribute('datetime'))).toEqual([
      '2024-03',
      '2025-06',
    ]);

    expect(cards[1].querySelector('.project-period')?.textContent).toContain('ongoing');

    expect(cards[2].querySelector('.project-period')).toBeNull();
  });

  it('does not navigate past the last page', () => {
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    fixture.componentInstance['goToPage'](5);

    expect(fixture.componentInstance['page']()).toBe(0);
  });
});
