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

/**
 * What a GitHub push actually creates (#148): a draft with no tags at all. The API refuses to
 * publish it until it has one.
 */
const TAGLESS_DRAFT: Project = {
  ...DRAFT,
  id: 'p-tagless',
  title: 'Compressor',
  tags: [],
  repoFullName: 'tarka1939/Compressor',
};

/**
 * A live project with no tags. The rule is checked on write, not applied to existing rows, so one
 * published from this list before #148 can still be live without a tag.
 */
const LIVE_TAGLESS: Project = { ...LIVE, id: 'p-live-tagless', title: 'Delay', tags: [] };

function pageOf(content: Project[]) {
  return of({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 });
}

function validationProblem(field: string, message: string): ApiProblem {
  return problemWith([{ field, message }]);
}

/** A 400 carrying several violations at once, which is what the API sends -- it does not dedup. */
function problemWith(fieldErrors: { field: string; message: string }[]): ApiProblem {
  return {
    status: 400,
    title: 'Bad Request',
    fieldErrors,
    rateLimited: false,
  };
}

/** The publish banner's text, as the admin reads it -- link text included. */
function bannerText(fixture: ComponentFixture<AdminProjectsListComponent>): string {
  const banner = (fixture.nativeElement as HTMLElement).querySelector('.publish-error');
  if (!banner) {
    throw new Error('no publish error banner is rendered');
  }
  return banner.textContent ?? '';
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

  it('links to the other admin pages, the analytics dashboard included', async () => {
    // The admin area has no navigation of its own, so this row is the only way to these pages.
    const fixture = await renderComponent(AdminProjectsListComponent);

    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.admin-actions a')];
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['+ New project', '/admin/projects/new'],
      ['Edit the About page', '/admin/about'],
      ['View analytics', '/admin/analytics'],
    ]);
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
    //
    // Equalizer has a tag on this page, so the list offers Publish -- and the server refuses it all
    // the same, which is what a row gone stale looks like: the tag removed in another tab since
    // this list loaded. The row is not the authority on the rule; the server is.
    updateProject.mockReturnValue(
      throwError(() => validationProblem('tags', 'At least one tag is required to publish')),
    );
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    const message = alert?.textContent ?? '';
    expect(message).toContain('Equalizer');
    expect(message).toContain('Tags: At least one tag is required to publish');
    // And the row still reports the truth: the publish did not happen.
    expect(statusOf(fixture, 'Equalizer')).toBe('Draft');
  });

  it('names each field the way the form labels it, never by the API key (#308)', async () => {
    // The banner links to the form, so its word for a field is the one the admin will find there.
    // It used to print the key: "tags: At least one tag is required to publish". The exact sentence
    // is asserted, so the wording around the reasons is pinned along with how each is named.
    updateProject.mockReturnValue(
      throwError(() =>
        problemWith([
          { field: 'tags', message: 'At least one tag is required to publish' },
          { field: 'links[0].url', message: 'must not be blank' },
          { field: 'images[0]', message: 'size must be between 0 and 500' },
          // A key with no label on the form: the message goes out alone rather than with the key.
          { field: 'repoFullName', message: 'size must be between 0 and 255' },
        ]),
      ),
    );
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    const text = bannerText(fixture);
    expect(text).toContain(
      'Could not publish "Equalizer". The server rejected it -- ' +
        'Tags: At least one tag is required to publish; ' +
        "Link 1's URL: must not be blank; " +
        "Image 1's URL: size must be between 0 and 500; " +
        'size must be between 0 and 255.',
    );
    // The sentence above has no key in it; this covers the rest of the banner, the link included.
    for (const key of ['tags:', 'links[0]', 'images[0]', 'repoFullName']) {
      expect(text).not.toContain(key);
    }
  });

  it('links a rejected publish to the form where it can be fixed', async () => {
    // The message sits above the table, which can be a page of rows away from this project's own
    // Edit link. A tag can only be added in the form, so the message goes there.
    updateProject.mockReturnValue(
      throwError(() => validationProblem('tags', 'At least one tag is required to publish')),
    );
    const fixture = await renderComponent(AdminProjectsListComponent);

    await clickPublish(fixture, 'Equalizer');

    const link = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"] a');
    expect(link?.getAttribute('href')).toBe('/admin/projects/p-draft/edit');
    expect(link?.textContent).toContain('Equalizer');
  });

  describe('a draft with no tags (#148)', () => {
    beforeEach(() => {
      listAllProjects.mockReturnValue(pageOf([TAGLESS_DRAFT, DRAFT, LIVE_TAGLESS]));
    });

    /** The control standing where Publish would, on a row that cannot be published as it is. */
    function addTagLink(
      fixture: ComponentFixture<AdminProjectsListComponent>,
      title: string,
    ): HTMLAnchorElement | null {
      return rowFor(fixture, title).querySelector<HTMLAnchorElement>('.publish-blocked');
    }

    it('offers the way to a tag in place of a Publish the server would refuse', async () => {
      const fixture = await renderComponent(AdminProjectsListComponent);

      // The positive half first: the link is there, says the reason in visible text, and goes to
      // the one place a tag can be added. Without it, the absent button below would pass against a
      // row that rendered no actions at all.
      const link = addTagLink(fixture, 'Compressor');
      expect(link?.textContent?.trim()).toBe('Add a tag to publish');
      expect(link?.getAttribute('href')).toBe('/admin/projects/p-tagless/edit');

      // No Publish control in that row -- a button, disabled or not, that is known to fail.
      expect(rowFor(fixture, 'Compressor').querySelector('.publish-toggle')).toBeNull();

      // A draft with a tag is untouched by any of this.
      expect(publishButton(fixture, 'Equalizer').textContent?.trim()).toBe('Publish');
      expect(addTagLink(fixture, 'Equalizer')).toBeNull();
    });

    it('gives the reason to a screen reader as a focusable control, named for its row', async () => {
      // The failure a disabled button plus a tooltip would have: unfocusable, so tabbing never
      // reaches it, and a reason that only a hovering mouse can see. A link with an href is in the
      // tab order, and its name carries the reason itself.
      const fixture = await renderComponent(AdminProjectsListComponent);
      const link = addTagLink(fixture, 'Compressor')!;

      expect(link.hasAttribute('href')).toBe(true);
      expect(link.getAttribute('aria-label')).toBe('Add a tag to publish Compressor');
      // WCAG 2.5.3: the name has to contain the visible label, or speech control cannot act on it.
      expect(link.getAttribute('aria-label')).toContain(link.textContent!.trim());
    });

    it('says "No tags" rather than leaving the cell blank', async () => {
      const fixture = await renderComponent(AdminProjectsListComponent);

      const tagsOf = (title: string) =>
        ((rowFor(fixture, title) as HTMLTableRowElement).cells[2].textContent ?? '').trim();
      expect(tagsOf('Compressor')).toBe('No tags');
      expect(tagsOf('Equalizer')).toBe('dsp');
    });

    it('still lets a live project with no tags be taken down, and then shows why it cannot go back up', async () => {
      // A draft may be tagless, so unpublishing one is allowed. The server's answer then makes it a
      // tagless draft, and the row follows what the server stored rather than what was asked.
      updateProject.mockReturnValue(of({ ...LIVE_TAGLESS, published: false }));
      const fixture = await renderComponent(AdminProjectsListComponent);

      expect(publishButton(fixture, 'Delay').textContent?.trim()).toBe('Unpublish');

      await clickPublish(fixture, 'Delay');

      expect(sentBody().tags).toEqual([]);
      expect(sentBody().published).toBe(false);
      expect(statusOf(fixture, 'Delay')).toBe('Draft');
      expect(rowFor(fixture, 'Delay').querySelector('.publish-toggle')).toBeNull();
      expect(addTagLink(fixture, 'Delay')?.textContent?.trim()).toBe('Add a tag to publish');
    });

    describe('focus, when Unpublish turns into the way to a tag', () => {
      // The pressed button is destroyed by the answer, because that row no longer offers Publish.
      // A control that disappears while focused leaves focus on the page, so where a keyboard
      // user's next Tab goes is up to the browser and a screen reader has nothing to say. The link
      // standing where the button was is where they should be.

      it('moves a keyboard user to the link that replaced the button', async () => {
        updateProject.mockReturnValue(of({ ...LIVE_TAGLESS, published: false }));
        const fixture = await renderComponent(AdminProjectsListComponent);
        const toggle = publishButton(fixture, 'Delay');

        toggle.focus();
        expect(document.activeElement).toBe(toggle);
        // Enter or Space on a focused button arrives as a click.
        toggle.click();
        await fixture.whenStable();

        const link = addTagLink(fixture, 'Delay');
        expect(link).not.toBeNull();
        expect(document.activeElement).toBe(link);
      });

      it('moves nobody who was not on the button when it was pressed', async () => {
        // A mouse click that does not focus the button, as in Safari. Focus was never in this row,
        // so there is no place in it to keep.
        updateProject.mockReturnValue(of({ ...LIVE_TAGLESS, published: false }));
        const fixture = await renderComponent(AdminProjectsListComponent);

        publishButton(fixture, 'Delay').click();
        await fixture.whenStable();

        // The link is there, so focus being elsewhere is a decision, not a missing link.
        expect(addTagLink(fixture, 'Delay')).not.toBeNull();
        expect(document.activeElement).not.toBe(addTagLink(fixture, 'Delay'));
      });

      it('does not pull back an admin who moved to another control while it ran', async () => {
        const pending = new Subject<Project>();
        updateProject.mockReturnValue(pending);
        const fixture = await renderComponent(AdminProjectsListComponent);
        const toggle = publishButton(fixture, 'Delay');

        toggle.focus();
        toggle.click();
        await fixture.whenStable();
        // On to the next row while Delay's request is still out.
        const elsewhere = publishButton(fixture, 'Equalizer');
        elsewhere.focus();

        pending.next({ ...LIVE_TAGLESS, published: false });
        pending.complete();
        await fixture.whenStable();

        expect(addTagLink(fixture, 'Delay')).not.toBeNull();
        expect(document.activeElement).toBe(elsewhere);
      });
    });
  });

  describe('column names, in the table and in the stacked phone layout (#312)', () => {
    // Below 40rem the SCSS sets `display` on the table's elements to stack each project into a
    // block, and some browsers then drop a table's semantics, taking every value's column name with
    // them. No test here can see that layout or hear a screen reader. What the DOM can show is that
    // the semantics are stated in the markup, where a stylesheet cannot remove them, and that the
    // labels the stacked layout draws say what the headers say.

    beforeEach(() => {
      // Every branch a cell has: live and draft, tags and none, Publish and the way to a tag.
      listAllProjects.mockReturnValue(pageOf([DRAFT, LIVE, TAGLESS_DRAFT]));
    });

    type Fixture = ComponentFixture<AdminProjectsListComponent>;

    function tableOf(fixture: Fixture): HTMLTableElement {
      const table = (fixture.nativeElement as HTMLElement).querySelector('table');
      if (!table) {
        throw new Error('no table is rendered');
      }
      return table;
    }

    /** The column headers' words, in column order. */
    function headerNames(fixture: Fixture): string[] {
      const headers = [...tableOf(fixture).querySelectorAll('th')];
      return headers.map((th) => (th.textContent ?? '').trim());
    }

    function bodyRows(fixture: Fixture): HTMLTableRowElement[] {
      return [...tableOf(fixture).querySelectorAll<HTMLTableRowElement>('tbody tr')];
    }

    it('states every table role in the markup, where a change of display cannot', async () => {
      const fixture = await renderComponent(AdminProjectsListComponent);
      const table = tableOf(fixture);
      const rolesOf = (selector: string) =>
        [...table.querySelectorAll(selector)].map((element) => element.getAttribute('role'));

      expect(table.getAttribute('role')).toBe('table');
      expect(rolesOf('thead, tbody')).toEqual(['rowgroup', 'rowgroup']);
      // The header row, then one per project.
      expect(rolesOf('tr')).toEqual(['row', 'row', 'row', 'row']);
      expect(rolesOf('th')).toEqual(Array(4).fill('columnheader'));
      expect(rolesOf('td')).toEqual(Array(12).fill('cell'));
    });

    it('gives every value a column header, and never hides the header row', async () => {
      // With the roles explicit, a cell's column header is the header at its position in the row,
      // so each row needs exactly one cell per header. The stacked layout takes the header row off
      // screen with CSS only; an aria-hidden or a `hidden` here would take it out of the
      // accessibility tree in both layouts, and every value's column name with it.
      const fixture = await renderComponent(AdminProjectsListComponent);

      expect(headerNames(fixture)).toEqual(['Title', 'Status', 'Tags', 'Actions']);
      for (const row of bodyRows(fixture)) {
        expect(row.cells).toHaveLength(headerNames(fixture).length);
      }

      const thead = tableOf(fixture).querySelector('thead')!;
      for (const element of [thead, ...thead.querySelectorAll('*')]) {
        expect(element.hasAttribute('aria-hidden')).toBe(false);
        expect(element.hasAttribute('hidden')).toBe(false);
      }
    });

    it("labels a stacked value with its header's word, hidden from a screen reader", async () => {
      const fixture = await renderComponent(AdminProjectsListComponent);
      const names = headerNames(fixture);

      for (const row of bodyRows(fixture)) {
        const labels = [...row.cells].flatMap((cell, column) => {
          const label = cell.querySelector('.cell-label');
          return label ? [{ column, label }] : [];
        });

        // Status and Tags, in their own columns: the title opens its block, and each action
        // names itself.
        expect(labels.map(({ column }) => names[column])).toEqual(['Status', 'Tags']);
        for (const { column, label } of labels) {
          // The word the stacked layout draws, which comes from the header's own constant.
          expect(label.getAttribute('data-label')).toBe(names[column]);
          // The screen reader already hears the header for this cell; a visible copy it could
          // also reach would be read on top of it.
          expect(label.getAttribute('aria-hidden')).toBe('true');
          // Drawn by CSS, so the cell's text stays its value alone, as in the table.
          expect(label.textContent).toBe('');
        }
      }
    });
  });
});
