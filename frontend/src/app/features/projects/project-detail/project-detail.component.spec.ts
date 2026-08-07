import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
});
