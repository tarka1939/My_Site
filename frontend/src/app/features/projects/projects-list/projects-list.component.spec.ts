import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
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

describe('ProjectsListComponent', () => {
  let listProjects: ReturnType<typeof vi.fn>;
  let listTags: ReturnType<typeof vi.fn>;

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

  it('does not navigate past the last page', () => {
    const fixture = TestBed.createComponent(ProjectsListComponent);
    fixture.detectChanges();

    fixture.componentInstance['goToPage'](5);

    expect(fixture.componentInstance['page']()).toBe(0);
  });
});
