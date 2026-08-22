import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { Project } from '../../../core/api/model/project';
import { ProjectWriteRequest } from '../../../core/api/model/projectWriteRequest';
import { ApiProblem } from '../../../core/http/api-problem';
import { renderComponent } from '../../../../testing/zoneless';
import { AdminProjectsListComponent } from './admin-projects-list.component';

/**
 * An auto-created draft: invisible on the public site, linked to a repository, and carrying the
 * webhook's placeholder prose. Typed as Project rather than left loose, so the fixture has to keep
 * up with docs/openapi.yaml's schema instead of quietly describing a shape the API cannot send.
 */
const DRAFT: Project = {
  id: 'p-draft',
  title: 'Equalizer',
  description: 'Created automatically from a push. Write this up before publishing.',
  links: [{ label: 'GitHub', url: 'https://github.com/tarka1939/Equalizer' }],
  images: ['https://images.example.com/equalizer.png'],
  tags: [{ id: 't1', name: 'dsp' }],
  startedOn: '2024-03-01',
  completedOn: null,
  published: false,
  repoFullName: 'tarka1939/Equalizer',
  lastPushedAt: '2026-08-20T09:00:00Z',
  defaultBranch: 'main',
  archived: false,
  createdAt: '2026-08-20T09:00:00Z',
  updatedAt: '2026-08-20T09:00:00Z',
};

/** A live, hand-written project: no repository, both dates set, on the public site. */
const LIVE: Project = {
  id: 'p-live',
  title: 'Reverb',
  description: 'A room simulator',
  links: [],
  images: [],
  tags: [{ id: 't2', name: 'audio' }],
  startedOn: '2025-01-01',
  completedOn: '2025-06-01',
  published: true,
  repoFullName: null,
  lastPushedAt: null,
  defaultBranch: null,
  archived: false,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

function pageOf(content: Project[]) {
  return of({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 });
}

function validationProblem(field: string, message: string): ApiProblem {
  return {
    status: 400,
    title: 'Bad Request',
    fieldErrors: [{ field, message }],
    rateLimited: false,
  };
}

/** The row for `title`, found the way a reader finds it -- by the title in its first cell. */
function rowFor(fixture: ComponentFixture<AdminProjectsListComponent>, title: string): HTMLElement {
  const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLTableRowElement>('tbody tr')];
  const row = rows.find((candidate) => candidate.cells[0].textContent?.includes(title));
  if (!row) {
    throw new Error(`no row for "${title}" among ${rows.length}`);
  }
  return row;
}

/** What the Status column says about a row, as a reader sees it. */
function statusOf(fixture: ComponentFixture<AdminProjectsListComponent>, title: string): string {
  return ((rowFor(fixture, title) as HTMLTableRowElement).cells[1].textContent ?? '').trim();
}

function publishButton(
  fixture: ComponentFixture<AdminProjectsListComponent>,
  title: string,
): HTMLButtonElement {
  const button = rowFor(fixture, title).querySelector<HTMLButtonElement>('.publish-toggle');
  if (!button) {
    throw new Error(`no publish control in the row for "${title}"`);
  }
  return button;
}

/** Click a row's publish control the way the admin does, then let the reaction settle. */
async function clickPublish(
  fixture: ComponentFixture<AdminProjectsListComponent>,
  title: string,
): Promise<void> {
  publishButton(fixture, title).click();
  await fixture.whenStable();
}

describe('AdminProjectsListComponent', () => {
  let listAllProjects: ReturnType<typeof vi.fn>;
  let listProjects: ReturnType<typeof vi.fn>;
  let updateProject: ReturnType<typeof vi.fn>;
  let deleteProject: ReturnType<typeof vi.fn>;

  /** The body of the only PUT this page has sent. */
  function sentBody(): ProjectWriteRequest {
    expect(updateProject).toHaveBeenCalledTimes(1);
    return updateProject.mock.calls[0][0].projectWriteRequest as ProjectWriteRequest;
  }

  beforeEach(async () => {
    listAllProjects = vi.fn().mockReturnValue(pageOf([DRAFT, LIVE]));
    listProjects = vi.fn().mockReturnValue(pageOf([LIVE]));
    updateProject = vi.fn().mockReturnValue(of({ ...DRAFT, published: true }));
    deleteProject = vi.fn().mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [AdminProjectsListComponent],
      providers: [
        provideRouter([]),
        {
          provide: ProjectsService,
          useValue: { listAllProjects, listProjects, updateProject, deleteProject },
        },
      ],
    }).compileComponents();
  });

  it('lists through the admin operation, the only one that returns drafts', async () => {
    await renderComponent(AdminProjectsListComponent);

    expect(listAllProjects).toHaveBeenCalledWith({ page: 0, size: 20 });
    // GET /projects filters to published unconditionally -- no parameter, header or credential
    // widens it -- so a page built on it cannot show the drafts this one exists to manage.
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('says in words which rows the public cannot see', async () => {
    const fixture = await renderComponent(AdminProjectsListComponent);

    // Asserted on the text in the cell, not on a class name: a class is a claim about styling that
    // a reader never sees, and the defect being guarded against is precisely two rows that render
    // the same to a person. Both states carry a word, so a status that failed to render would show
    // as neither rather than as "live".
    expect(statusOf(fixture, 'Equalizer')).toBe('Draft');
    expect(statusOf(fixture, 'Reverb')).toBe('Live');
    expect(statusOf(fixture, 'Equalizer')).not.toBe(statusOf(fixture, 'Reverb'));
  });

  it('shows which repository a project tracks, so an auto-created draft is telling', async () => {
    const fixture = await renderComponent(AdminProjectsListComponent);

    expect(rowFor(fixture, 'Equalizer').querySelector('.repo')?.textContent).toContain(
      'tarka1939/Equalizer',
    );
    expect(rowFor(fixture, 'Reverb').querySelector('.repo')).toBeNull();
  });

  it('publishes a draft by sending every curated field back, not just the flag', async () => {
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    expect(updateProject).toHaveBeenCalledWith({
      id: 'p-draft',
      projectWriteRequest: expect.anything(),
    });
    // PUT is a full replacement: a body carrying only `published` would clear the title,
    // description, tags, links, images and dates. That is issue #92's blank-form PUT reached
    // through a different button, so the assertion is on the whole body rather than on the flag.
    expect(sentBody()).toEqual({
      title: DRAFT.title,
      description: DRAFT.description,
      tags: ['dsp'],
      links: DRAFT.links,
      images: DRAFT.images,
      startedOn: '2024-03-01',
      completedOn: null,
      published: true,
    });
  });

  it('leaves repoFullName out of the body, because omitted is what preserves it', async () => {
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    // Absence asserted on the keys rather than by toEqual, which treats an explicit `undefined` and
    // a missing key alike -- and `repoFullName: undefined` serializes to nothing at all, which is
    // only accidentally the same thing as meaning it.
    expect(Object.keys(sentBody())).not.toContain('repoFullName');
    // The GitHub-authoritative fields are not on the write request at all; naming them here is what
    // would fail if a later edit started copying the whole Project into the body.
    expect(Object.keys(sentBody())).not.toContain('lastPushedAt');
    expect(Object.keys(sentBody())).not.toContain('archived');
  });

  it('takes a live project down without deleting it', async () => {
    updateProject.mockReturnValue(of({ ...LIVE, published: false }));
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Reverb');

    expect(sentBody().published).toBe(false);
    expect(deleteProject).not.toHaveBeenCalled();
    expect(statusOf(fixture, 'Reverb')).toBe('Draft');
  });

  it('repaints the row from what the server stored, not from what was asked for', async () => {
    const fixture = await renderComponent(AdminProjectsListComponent);
    expect(statusOf(fixture, 'Equalizer')).toBe('Draft');

    await clickPublish(fixture, 'Equalizer');

    // Clicked and awaited rather than forced: the status changing is the only confirmation the
    // admin gets that the publish took, and it repaints only if the click marked the view dirty.
    expect(statusOf(fixture, 'Equalizer')).toBe('Live');
    expect(publishButton(fixture, 'Equalizer').textContent?.trim()).toBe('Unpublish');
    // The other row is untouched -- one PUT, one row.
    expect(statusOf(fixture, 'Reverb')).toBe('Live');
  });

  it('names the project each control acts on, and keeps the label inside that name', async () => {
    const fixture = await renderComponent(AdminProjectsListComponent);

    const draftButton = publishButton(fixture, 'Equalizer');
    const liveButton = publishButton(fixture, 'Reverb');

    expect(draftButton.getAttribute('aria-label')).toBe('Publish Equalizer');
    expect(liveButton.getAttribute('aria-label')).toBe('Unpublish Reverb');
    // WCAG 2.5.3: the accessible name has to contain the visible label, or speech control cannot
    // act on what the button says. Checked rather than assumed, because the two are built
    // separately in the template.
    for (const button of [draftButton, liveButton]) {
      expect(button.getAttribute('aria-label')).toContain(button.textContent!.trim());
    }
  });

  it('disables the control it is acting on while its request is in flight', async () => {
    const pending = new Subject<Project>();
    updateProject.mockReturnValue(pending);
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    expect(publishButton(fixture, 'Equalizer').disabled).toBe(true);
    expect(publishButton(fixture, 'Equalizer').textContent?.trim()).toBe('Publishing…');
    // Still the row's own request: the other row stays usable.
    expect(publishButton(fixture, 'Reverb').disabled).toBe(false);

    // A second click cannot start a second PUT for the same project.
    await clickPublish(fixture, 'Equalizer');
    expect(updateProject).toHaveBeenCalledTimes(1);

    pending.next({ ...DRAFT, published: true });
    pending.complete();
    await fixture.whenStable();
    expect(publishButton(fixture, 'Equalizer').disabled).toBe(false);
  });

  it('refuses a second publish for the same project while one is in flight', async () => {
    // Called on the component rather than clicked, deliberately: the button is disabled while its
    // request runs, so no click can reach this and a DOM-only test proves the attribute rather than
    // the guard. The attribute is the UX; the refusal in the handler is what makes a double PUT
    // unreachable, and it is only a guarantee if it holds when the attribute does not. Same
    // reasoning as the project form's row handlers, and tested the same way retryLoad() is.
    updateProject.mockReturnValue(new Subject<Project>());
    const fixture = await renderComponent(AdminProjectsListComponent);

    fixture.componentInstance['setPublished'](DRAFT, true);
    fixture.componentInstance['setPublished'](DRAFT, true);
    await fixture.whenStable();

    expect(updateProject).toHaveBeenCalledTimes(1);
  });

  it('says so when the server rejects a publish, instead of silently reverting', async () => {
    // errorInterceptor stays quiet for a 400 that carries field errors, on the assumption that a
    // form renders them inline. This page has no form, so without a destination here the button
    // would go back to saying "Publish" and nothing anywhere would say why.
    updateProject.mockReturnValue(
      throwError(() => validationProblem('tags', 'At least one tag is required')),
    );
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    const message = alert?.textContent ?? '';
    expect(message).toContain('Equalizer');
    expect(message).toContain('tags');
    expect(message).toContain('At least one tag is required');
    // And the row still reports the truth: the publish did not happen.
    expect(statusOf(fixture, 'Equalizer')).toBe('Draft');
  });
});
