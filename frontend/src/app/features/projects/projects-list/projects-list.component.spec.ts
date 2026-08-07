import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { trackImageAttributeOrder } from '../../../../testing/image-attribute-order';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { TagsService } from '../../../core/api/api/tags.service';
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

function pageOf(content: unknown[]) {
  return of({ content, page: 0, size: 12, totalElements: content.length, totalPages: 1 });
}

describe('ProjectsListComponent', () => {
  let listProjects: ReturnType<typeof vi.fn>;
  let listTags: ReturnType<typeof vi.fn>;
  let tracker: ReturnType<typeof trackImageAttributeOrder>;

  afterEach(() => tracker?.restore());

  beforeEach(async () => {
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

  it('re-fetches with the tag filter when a tag is toggled', () => {
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    fixture.componentInstance['toggleTag']('dsp');

    expect(listProjects).toHaveBeenLastCalledWith({ page: 0, size: 12, tag: ['dsp'] });
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

  it('does not navigate past the last page', () => {
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    fixture.componentInstance['goToPage'](5);

    expect(fixture.componentInstance['page']()).toBe(0);
  });
});
