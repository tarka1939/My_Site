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
