import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { BehaviorSubject, config, of, Subject, throwError } from 'rxjs';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { clickOn, submitForm, typeInto } from '../../../../testing/zoneless';
import { AdminProjectFormComponent } from './admin-project-form.component';

const EXISTING_PROJECT = {
  id: 'p1',
  title: 'Equalizer',
  description: 'A DSP project',
  links: [{ label: 'GitHub', url: 'https://github.com/tarka1939/Equalizer' }],
  images: ['https://images.example.com/one.png'],
  tags: [{ id: 't1', name: 'dsp' }],
  startedOn: '2024-03-01',
  completedOn: '2025-06-01',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/**
 * A second project, deliberately unlike the first in every field a test can see: a different title,
 * description, tag, start date, an open-ended period, and -- the part that matters most -- two link
 * rows to the first project's one. "Shows B" and "shows A and B" are otherwise the same assertion.
 */
const OTHER_PROJECT = {
  id: 'p2',
  title: 'Reverb',
  description: 'A room simulator',
  links: [
    { label: 'Docs', url: 'https://docs.example/reverb' },
    { label: 'Demo', url: 'https://demo.example/reverb' },
  ],
  images: ['https://images.example.com/two.png'],
  tags: [{ id: 't2', name: 'audio' }],
  startedOn: '2025-01-01',
  completedOn: null,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

/**
 * The component takes its id from route.paramMap, so the stub is a subject a test can push to --
 * before createComponent to open in edit mode, and again afterwards to navigate from one edit URL
 * to another without unmounting anything, which is what the default RouteReuseStrategy does.
 *
 * `snapshot` is a getter over the same value rather than a fixed object, so it stays honest the way
 * the real ActivatedRoute's does. Nothing in the component reads it any more; RouterLink does.
 */
interface RouteStub {
  paramMap: BehaviorSubject<ParamMap>;
  readonly snapshot: { paramMap: ParamMap };
}

function validationProblem(field: string, message: string): ApiProblem {
  return problemWith([{ field, message }]);
}

/** A 400 carrying several violations at once, which is what the API sends -- it does not dedup. */
function problemWith(fieldErrors: { field: string; message: string }[]): ApiProblem {
  return {
    status: 400,
    title: 'Bad Request',
    detail: 'Request failed validation',
    fieldErrors,
    rateLimited: false,
  };
}

/**
 * What a failed getProject looks like to the component: errorInterceptor has already normalized the
 * response, toasted it and (on a 401) logged out, so all the component ever sees is this.
 */
const LOAD_FAILURE: ApiProblem = {
  status: 500,
  title: 'Request failed (500).',
  fieldErrors: [],
  rateLimited: false,
};

function fillRequiredFields(fixture: ComponentFixture<AdminProjectFormComponent>): void {
  fixture.componentInstance['form'].patchValue({
    title: 'Equalizer',
    description: 'A DSP project',
    tags: 'dsp',
  });
}

// Interactions go through a real DOM event and whenStable(), never detectChanges() -- see the
// convention in src/testing/zoneless.ts for what that catches, and for the two cases it
// deliberately does *not* claim to cover. These wrap the shared primitives with this form's
// selectors.

/** Click the "+ Add link" / "+ Add image" button, i.e. the fieldset's own direct-child button. */
function clickAddRow(
  fixture: ComponentFixture<AdminProjectFormComponent>,
  array: 'links' | 'images',
): Promise<void> {
  return clickOn(fixture, `fieldset[formarrayname="${array}"] > button`);
}

/** Click the Remove button of row `index` in the links or images fieldset. */
function clickRemoveRow(
  fixture: ComponentFixture<AdminProjectFormComponent>,
  array: 'links' | 'images',
  index: number,
): Promise<void> {
  return clickOn(fixture, `fieldset[formarrayname="${array}"] .repeatable-row button`, index);
}

/** Type into a rendered input the way a user does, so the control and the view both see it. */
function type(
  fixture: ComponentFixture<AdminProjectFormComponent>,
  selector: string,
  value: string,
): Promise<void> {
  return typeInto(fixture, selector, value);
}

/** Save the way the admin does -- submit the form, rather than calling submit() directly. */
function save(fixture: ComponentFixture<AdminProjectFormComponent>): Promise<void> {
  return submitForm(fixture);
}

function errorTextFor(host: HTMLElement, inputId: string): string | null {
  const field = host.querySelector(`#${inputId}`)?.closest('.field');
  return field?.querySelector('.field-error')?.textContent?.trim() ?? null;
}

/**
 * The component's UNEXPLAINED_REJECTION, written out rather than imported, and that is the whole
 * point: importing it would make the assertion agree with whatever the constant says, so swapping
 * in the contact form's visitor-facing wording would still pass -- which is exactly the mutation
 * this is here to catch. Two forms, two audiences, and this is the copy for the one whose reader
 * knows what `links[0].label` means. If this assertion fails, decide which audience you meant.
 */
const ADMIN_FALLBACK_COPY = 'Rejected by the server, which gave no reason.';

describe('AdminProjectFormComponent', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let createProject: ReturnType<typeof vi.fn>;
  let updateProject: ReturnType<typeof vi.fn>;
  let route: RouteStub;

  /** Switch the pending fixture from "new project" to "edit p1". Call before createComponent. */
  function editExistingProject(): void {
    route.paramMap.next(convertToParamMap({ id: 'p1' }));
  }

  /**
   * Navigate an already-created fixture from one edit URL to another. No new component: a
   * params-only navigation reuses the instance, which is the whole point of the tests that call it.
   */
  async function navigateToProject(
    fixture: ComponentFixture<AdminProjectFormComponent>,
    id: string,
  ): Promise<void> {
    route.paramMap.next(convertToParamMap({ id }));
    // whenStable(), not detectChanges(): the rebuilt rows come off form.controls.links.controls,
    // a plain array and not a signal, and they are rebuilt from a subscribe callback rather than
    // from a template listener. Forcing a refresh would render them however the view got marked.
    await fixture.whenStable();
  }

  /** Whatever is in the rendered inputs matching `selector`, in document order. */
  function inputValues(host: HTMLElement, selector: string): string[] {
    return [...host.querySelectorAll<HTMLInputElement>(selector)].map((input) => input.value);
  }

  beforeEach(async () => {
    getProject = vi.fn().mockReturnValue(of(EXISTING_PROJECT));
    createProject = vi.fn().mockReturnValue(of(EXISTING_PROJECT));
    updateProject = vi.fn().mockReturnValue(of(EXISTING_PROJECT));
    const paramMap = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    route = {
      paramMap,
      get snapshot() {
        return { paramMap: paramMap.value };
      },
    };

    await TestBed.configureTestingModule({
      imports: [AdminProjectFormComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectsService, useValue: { getProject, createProject, updateProject } },
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  it('labels both date inputs', () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    for (const id of ['project-started-on', 'project-completed-on']) {
      const input = host.querySelector<HTMLInputElement>(`#${id}`);
      expect(input?.type).toBe('date');
      expect(host.querySelector(`label[for="${id}"]`)?.textContent?.trim()).toBeTruthy();
    }
  });

  it('sends explicit nulls when no dates are entered', () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);

    fixture.componentInstance['submit']();

    expect(createProject).toHaveBeenCalledTimes(1);
    const body = createProject.mock.calls[0][0].projectWriteRequest;
    expect(body.startedOn).toBeNull();
    expect(body.completedOn).toBeNull();
  });

  it('sends the entered period on create', () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    fixture.componentInstance['form'].patchValue({
      startedOn: '2024-03-01',
      completedOn: '2025-06-01',
    });

    fixture.componentInstance['submit']();

    const body = createProject.mock.calls[0][0].projectWriteRequest;
    expect(body.startedOn).toBe('2024-03-01');
    expect(body.completedOn).toBe('2025-06-01');
  });

  it('sends a null completedOn for an ongoing project without clearing the start date', () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    fixture.componentInstance['form'].patchValue({ startedOn: '2024-03-01' });

    fixture.componentInstance['submit']();

    const body = createProject.mock.calls[0][0].projectWriteRequest;
    expect(body.startedOn).toBe('2024-03-01');
    expect(body.completedOn).toBeNull();
  });

  it('round-trips existing dates through an edit that does not touch them', () => {
    // PUT takes the same body as POST, so an omitted field clears the stored value. If the form
    // did not load these into the controls, editing the title would silently wipe the period.
    editExistingProject();

    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();

    expect(getProject).toHaveBeenCalledWith({ id: 'p1' });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector<HTMLInputElement>('#project-started-on')?.value).toBe('2024-03-01');
    expect(host.querySelector<HTMLInputElement>('#project-completed-on')?.value).toBe('2025-06-01');

    fixture.componentInstance['form'].patchValue({ title: 'Equalizer v2' });
    fixture.componentInstance['submit']();

    expect(updateProject).toHaveBeenCalledTimes(1);
    const { id, projectWriteRequest } = updateProject.mock.calls[0][0];
    expect(id).toBe('p1');
    expect(projectWriteRequest.title).toBe('Equalizer v2');
    expect(projectWriteRequest.startedOn).toBe('2024-03-01');
    expect(projectWriteRequest.completedOn).toBe('2025-06-01');
  });

  it('keeps an ongoing project ongoing through an edit', () => {
    getProject.mockReturnValue(of({ ...EXISTING_PROJECT, completedOn: null }));
    editExistingProject();

    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector<HTMLInputElement>('#project-completed-on')?.value).toBe('');

    fixture.componentInstance['submit']();

    const body = updateProject.mock.calls[0][0].projectWriteRequest;
    expect(body.startedOn).toBe('2024-03-01');
    expect(body.completedOn).toBeNull();
  });

  it('leaves a project with no dates dateless through an edit', () => {
    getProject.mockReturnValue(of({ ...EXISTING_PROJECT, startedOn: null, completedOn: null }));
    editExistingProject();

    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fixture.componentInstance['submit']();

    const body = updateProject.mock.calls[0][0].projectWriteRequest;
    expect(body.startedOn).toBeNull();
    expect(body.completedOn).toBeNull();
  });

  it('blocks a completion date that precedes the start date, and says why', async () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    await type(fixture, '#project-started-on', '2025-06-01');
    await type(fixture, '#project-completed-on', '2024-03-01');

    await save(fixture);

    expect(createProject).not.toHaveBeenCalled();
    const host = fixture.nativeElement as HTMLElement;
    expect(errorTextFor(host, 'project-completed-on')).toContain('cannot be earlier');
    expect(host.querySelector('#project-completed-on')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('points the completion input at its error message, not just at the hint', async () => {
    // aria-invalid alone tells a screen-reader user the field is wrong without saying why:
    // role="alert" fires once as the message appears, and nothing re-announces it when the user
    // tabs back. The description is what carries the reason on every later visit, so the ids
    // aria-describedby lists have to include the error element and still resolve to real nodes.
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector('#project-completed-on');

    expect(input?.getAttribute('aria-describedby')).toBe('project-completed-on-hint');

    await type(fixture, '#project-started-on', '2025-06-01');
    await type(fixture, '#project-completed-on', '2024-03-01');

    const describedBy = input?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    expect(describedBy).toContain('project-completed-on-error');
    expect(describedBy).toContain('project-completed-on-hint');
    // A dangling id reference is announced as nothing at all, so resolve each one.
    const described = describedBy.map((id) => host.querySelector(`#${id}`)?.textContent?.trim());
    expect(described.every((text) => !!text)).toBe(true);
    expect(described.join(' ')).toContain('cannot be earlier');
  });

  it('blocks a completion date supplied without a start date', async () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    await type(fixture, '#project-completed-on', '2025-06-01');

    await save(fixture);

    expect(createProject).not.toHaveBeenCalled();
    const host = fixture.nativeElement as HTMLElement;
    expect(errorTextFor(host, 'project-completed-on')).toContain(
      'cannot finish without having started',
    );
  });

  describe('when the project fails to load', () => {
    function failFirstLoad(): void {
      getProject.mockReturnValueOnce(throwError(() => LOAD_FAILURE));
      editExistingProject();
    }

    it('renders an error state instead of an editable form', () => {
      failFirstLoad();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      // Not "the fields are empty" -- there must be no fields. An edit form with none of the
      // project's data is a wipe waiting to be saved, so it is not offered at all.
      expect(host.querySelector('#project-title')).toBeNull();
      expect(host.querySelector('form')).toBeNull();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Could not load this project',
      );
      // The two ways out stay available: retry, and the back link that is always on the page.
      expect(host.querySelector('.load-error button')).not.toBeNull();
      expect(host.querySelector('a[href="/admin/projects"]')).not.toBeNull();
    });

    it('issues no request when submit() is called after a failed load', () => {
      // The data-loss regression. updateProject is a PUT, i.e. a full replacement, so a submit of
      // the blank form the old error handler left behind would overwrite every stored field.
      // The form is filled first on purpose: an empty form is blocked by its own validators, which
      // would let this pass even with the guard removed.
      failFirstLoad();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      fixture.componentInstance['submit']();

      expect(updateProject).not.toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
    });

    it('tells the admin to log in again when the load fails with a 401', () => {
      // errorInterceptor only logs out and redirects while auth.isLoggedIn() is still true, and
      // that is a wall-clock check on expiresAt. A token that expired while this page sat open --
      // one of the triggers issue #92 names -- fails that check before the 401 arrives, so nothing
      // redirects and "Try again" would fail identically for as long as the admin keeps pressing.
      getProject.mockReturnValueOnce(throwError(() => ({ ...LOAD_FAILURE, status: 401 })));
      editExistingProject();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const message = host.querySelector('.load-error [role="alert"]')?.textContent ?? '';
      expect(message).toContain('Log in again');
      expect(message).not.toContain('Could not load this project');
      // The escape route the message points at has to exist.
      expect(host.querySelector('a[href="/admin/projects"]')?.textContent).toContain(
        'Back to projects',
      );
    });

    it('ignores a second retry while the first is still in flight', () => {
      // Check-then-act. Two clicks on "Try again" otherwise leave two responses racing, and nothing
      // orders them -- see the ordering test below for what the loser does to the winner's state.
      const inFlight = new Subject<unknown>();
      getProject.mockReturnValueOnce(throwError(() => LOAD_FAILURE)).mockReturnValue(inFlight);
      editExistingProject();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      fixture.componentInstance['retryLoad']();
      fixture.componentInstance['retryLoad']();

      // The failed initial load plus exactly one retry -- not two, and not three subscriptions.
      expect(getProject).toHaveBeenCalledTimes(2);
    });

    it('does not leave a stale failure showing over a form that has since loaded', async () => {
      // The ordering the guard exists to prevent: retry A succeeds and populates the form, retry B
      // fails afterwards and paints the error state back over it. With one load at a time, B never
      // starts, so the admin ends up looking at the project rather than at an error about it.
      // Both retries are deferred Subjects so the test controls when each lands. throwError would
      // not do: it fires at subscribe time, which puts the failure *before* the success and tests
      // the opposite ordering to the one at issue.
      const firstRetry = new Subject<unknown>();
      const secondRetry = new Subject<unknown>();
      getProject
        .mockReturnValueOnce(throwError(() => LOAD_FAILURE))
        .mockReturnValueOnce(firstRetry)
        .mockReturnValue(secondRetry);
      editExistingProject();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      fixture.componentInstance['retryLoad']();
      fixture.componentInstance['retryLoad']();
      firstRetry.next(EXISTING_PROJECT);
      firstRetry.complete();
      // The straggler, landing after the form is already populated. If it was ever allowed to
      // start, its failure is what the admin ends up looking at.
      secondRetry.error(LOAD_FAILURE);
      await fixture.whenStable();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.load-error')).toBeNull();
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Equalizer');
    });

    it('loads the project on retry, populating links and images exactly once', async () => {
      failFirstLoad();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      await clickOn(fixture, '.load-error button');

      expect(getProject).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.load-error')).toBeNull();
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Equalizer');
      // The duplicate-append guard: the first load's rows have to be cleared before the second
      // load pushes its own, or the retried project comes back with two of everything.
      const form = fixture.componentInstance['form'];
      expect(form.controls.links.length).toBe(1);
      expect(form.controls.images.length).toBe(1);
      expect(host.querySelectorAll('input[type="url"]').length).toBe(2);

      await save(fixture);

      expect(updateProject).toHaveBeenCalledTimes(1);
      const body = updateProject.mock.calls[0][0].projectWriteRequest;
      expect(body.links).toHaveLength(1);
      expect(body.images).toHaveLength(1);
    });
  });

  describe('client-side validator messages', () => {
    it('says nothing about fields the admin has not reached yet', () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll('.field-error')).toHaveLength(0);
      expect(host.querySelector('#project-title')?.getAttribute('aria-invalid')).toBeNull();
    });

    it('names every empty required field when a blank form is submitted', async () => {
      // The old failure mode: markAllAsTouched() and a silent return, indistinguishable from the
      // Save button not working. fieldErrors() only ever holds server messages, and an invalid
      // form never reaches the server, so nothing was rendered at all.
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      await save(fixture);

      expect(createProject).not.toHaveBeenCalled();
      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('Title is required');
      expect(errorTextFor(host, 'project-description')).toBe('Description is required');
      expect(errorTextFor(host, 'project-tags')).toBe('At least one tag is required');
      for (const id of ['project-title-error', 'project-description-error', 'project-tags-error']) {
        const message = host.querySelector(`#${id}`);
        expect(message?.getAttribute('role')).toBe('alert');
        expect(message?.textContent?.trim()).toBeTruthy();
      }
    });

    it('points each invalid input at a message that resolves to real text', async () => {
      // Same reasoning as the completion-date case: aria-invalid says the field is wrong without
      // saying why, and a dangling aria-describedby id is announced as nothing at all.
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      for (const id of ['project-title', 'project-description', 'project-tags']) {
        const input = host.querySelector(`#${id}`);
        expect(input?.getAttribute('aria-invalid')).toBe('true');
        const describedBy = input?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
        expect(describedBy.length).toBeGreaterThan(0);
        const described = describedBy.map((ref) => host.querySelector(`#${ref}`)?.textContent?.trim());
        expect(described.every((text) => !!text)).toBe(true);
      }
    });

    it('reports a title over the contract limit', async () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      fixture.componentInstance['form'].patchValue({ title: 'x'.repeat(201) });

      await save(fixture);

      expect(createProject).not.toHaveBeenCalled();
      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('Title cannot exceed 200 characters');
    });

    it('names an empty link row and image row on submit', async () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'images');

      await save(fixture);

      expect(createProject).not.toHaveBeenCalled();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#link-label-0-error')?.textContent?.trim()).toBe(
        'Link label is required',
      );
      expect(host.querySelector('#link-url-0-error')?.textContent?.trim()).toBe(
        'Link URL is required',
      );
      expect(host.querySelector('#image-0-error')?.textContent?.trim()).toBe(
        'Image URL is required',
      );
      expect(host.querySelector('#link-label-0')?.getAttribute('aria-describedby')).toBe(
        'link-label-0-error',
      );
      expect(host.querySelector('#image-0')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('still shows a server field error for a field its own validators accept', async () => {
      // The two halves share one slot, so the client message must not crowd out the server's.
      createProject.mockReturnValue(
        throwError(() => validationProblem('title', 'A project with this title already exists')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('A project with this title already exists');
    });

    it('says nothing about a row the admin has only just added', async () => {
      // "+ Add link" creates a row that is empty by definition. Painting "Link label is required"
      // on it before anyone has typed scolds the admin for clicking the button. Added by clicking,
      // not by calling addLink(): a programmatic push does not re-render the row, so this would
      // otherwise assert "no message" against a DOM with no row in it.
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'images');

      const host = fixture.nativeElement as HTMLElement;
      // The positive half, and it has to come first: the rest of this test asserts an absence, and
      // an absence is indistinguishable from a row that never rendered at all.
      expect(host.querySelector('#link-label-0')).not.toBeNull();
      expect(host.querySelector('#image-0')).not.toBeNull();
      expect(host.querySelectorAll('.field-error')).toHaveLength(0);
      expect(host.querySelector('#link-label-0')?.getAttribute('aria-invalid')).toBeNull();
      expect(host.querySelector('#image-0')?.getAttribute('aria-invalid')).toBeNull();
    });
  });

  describe('server field errors on collection elements', () => {
    /** Fill the form with something the client validators accept, so the request reaches the API. */
    async function fillValidProjectWithRows(
      fixture: ComponentFixture<AdminProjectFormComponent>,
    ): Promise<void> {
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'images');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://github.example/x');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');
    }

    it('shows a links[i] violation on that row, not nowhere', async () => {
      // The client control only checks `required`; the API also bounds the length. A 51-character
      // label is therefore rejected by the server alone, and errorInterceptor stays silent for a
      // 400 carrying fieldErrors -- so if the indexed key matches no slot, Save does nothing and
      // says nothing.
      createProject.mockReturnValue(
        throwError(() =>
          validationProblem('links[0].label', 'label must be at most 50 characters'),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await fillValidProjectWithRows(fixture);

      await save(fixture);

      expect(createProject).toHaveBeenCalledTimes(1);
      const host = fixture.nativeElement as HTMLElement;
      const message = host.querySelector('#link-label-0-error');
      expect(message?.textContent?.trim()).toBe('label must be at most 50 characters');
      expect(message?.getAttribute('role')).toBe('alert');
      const input = host.querySelector('#link-label-0');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(input?.getAttribute('aria-describedby')).toBe('link-label-0-error');
    });

    it('shows an images[i] violation on that row', async () => {
      createProject.mockReturnValue(
        throwError(() => validationProblem('images[0]', 'must be at most 500 characters')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await fillValidProjectWithRows(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#image-0-error')?.textContent?.trim()).toBe(
        'must be at most 500 characters',
      );
      expect(host.querySelector('#image-0')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('shows a tags[i] violation in the tags field, which has no per-index slot', async () => {
      createProject.mockReturnValue(
        throwError(() => validationProblem('tags[0]', 'tag name must be at most 50 characters')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-tags')).toBe('tag name must be at most 50 characters');
      expect(host.querySelector('#project-tags')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('keeps an indexed key off every field but the one it names', async () => {
      // The fixture has to be a key that survives the leaf test, or the field-prefix half of the
      // rule is never reached: an earlier version of this test used links[0].label, which fails
      // endsWith(']') first, so deleting the prefix scoping altogether left it green. images[0]
      // ends in ']' exactly as tags[2] does, and without scoping it lands in tags, title,
      // description and both dates at once.
      createProject.mockReturnValue(
        throwError(() => validationProblem('images[0]', 'must be at most 500 characters')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'images');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#image-0-error')?.textContent?.trim()).toBe(
        'must be at most 500 characters',
      );
      for (const id of [
        'project-tags',
        'project-title',
        'project-description',
        'project-started-on',
        'project-completed-on',
      ]) {
        expect(errorTextFor(host, id)).toBeNull();
      }
    });

    it('maps each row to the index it renders at', async () => {
      // Every other row test uses a single row, where links[0] and "the row's key" are the same
      // string -- hardcoding both lookups to index 0 passed all of them.
      createProject.mockReturnValue(
        throwError(() => validationProblem('links[1].url', 'must be a valid URL')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await type(fixture, '#link-label-1', 'Docs');
      await type(fixture, '#link-url-1', 'https://b.example/two');

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#link-url-1-error')?.textContent?.trim()).toBe(
        'must be a valid URL',
      );
      expect(host.querySelector('#link-url-1')?.getAttribute('aria-invalid')).toBe('true');
      expect(host.querySelector('#link-url-0-error')).toBeNull();
      expect(host.querySelector('#link-url-0')?.getAttribute('aria-invalid')).toBeNull();
      // Row 1 claimed the key, so the catch-all must not say it a second time. The scalar half of
      // this is covered above; without the row half, every row message appears twice.
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it("prefers this form's own message over the server's for the same row control", async () => {
      // rowError documents client-first precedence, and nothing pinned it: no test had both
      // messages available on one control at once. Inverting the two passed everything.
      createProject.mockReturnValue(
        throwError(() => validationProblem('links[0].label', 'must be at most 50 characters')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#link-label-0-error')?.textContent?.trim()).toBe(
        'must be at most 50 characters',
      );

      // Now empty the label. The server's complaint about the old value is still in fieldErrors,
      // and the admin needs to be told the thing that is true *now*.
      await type(fixture, '#link-label-0', '');

      expect(host.querySelector('#link-label-0-error')?.textContent?.trim()).toBe(
        'Link label is required',
      );
    });

    it('gives startedOn the same message wiring as completedOn', async () => {
      createProject.mockReturnValue(
        throwError(() => validationProblem('startedOn', 'startedOn must not be in the future')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      fixture.componentInstance['form'].patchValue({ startedOn: '2999-01-01' });

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const input = host.querySelector('#project-started-on');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      const describedBy = input?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
      expect(describedBy).toContain('project-started-on-error');
      expect(describedBy).toContain('project-started-on-hint');
      const described = describedBy.map((ref) => host.querySelector(`#${ref}`)?.textContent?.trim());
      expect(described.every((text) => !!text)).toBe(true);
      expect(described.join(' ')).toContain('must not be in the future');
    });
  });

  describe('server errors that no field slot claims', () => {
    it('shows an unclaimed key next to Save rather than dropping it', async () => {
      // links and images carry collection-level limits (at most 10 and 20), reported under the bare
      // name rather than an indexed one -- eleven clicks on "+ Add link" reaches that from the UI.
      // No slot matches it, and errorInterceptor stays quiet for any 400 carrying field errors, so
      // before this the save was rejected and the form said nothing at all.
      createProject.mockReturnValue(
        throwError(() => validationProblem('links', 'size must be between 0 and 10')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const region = host.querySelector('.form-error[role="alert"]');
      expect(region?.textContent).toContain('size must be between 0 and 10');
      expect(region?.textContent).toContain('links');
      // role="alert" announces it once on insertion; the description is what carries the reason to
      // anyone who arrives at Save afterwards, which is the same wiring every field slot has.
      const describedBy = host
        .querySelector('button[type="submit"]')
        ?.getAttribute('aria-describedby');
      expect(describedBy).toBe('project-form-error');
      expect(host.querySelector(`#${describedBy}`)?.textContent?.trim()).toBeTruthy();
    });

    it('survives a rejection that is not an ApiProblem at all', () => {
      // errorInterceptor normalizes every HttpErrorResponse, but rethrows anything else unchanged,
      // so this handler cannot assume the shape. Reading .fieldErrors off a bare Error throws
      // *inside* the subscriber, which surfaces as an unhandled error rather than as a visibly
      // failed save -- the DOM looks identical either way, so asserting on the DOM here proves
      // nothing. Hence the flag below: the property under test is that nothing escapes.
      // RxJS swallows a throw from a subscriber callback and reports it out of band, where neither
      // the DOM nor an assertion can see it -- vitest counts it under "Errors", which leaves the
      // "Tests N passed" line green. This flag makes the throw propagate out of subscribe() instead,
      // which is the only way to assert on it. It is also why this one test calls submit() directly
      // rather than dispatching a submit event: jsdom would swallow the exception again.
      //
      // One assertion on purpose, matching the contact form's twin of this test. `submitting` is
      // false here whether or not the guard is present, because submitting.set(false) is the error
      // handler's first statement and the read that can throw comes after it -- asserting it read
      // as coverage while being unable to tell a working guard from a broken one. The flag being
      // cleared on a rejected save is pinned where it can actually fail: the completedOn test at
      // the end of this file, whose rejection is a real ApiProblem and so gets past that read.
      config.useDeprecatedSynchronousErrorHandling = true;

      try {
        createProject.mockReturnValue(throwError(() => new TypeError('boom')));

        const fixture = TestBed.createComponent(AdminProjectFormComponent);
        fixture.detectChanges();
        fillRequiredFields(fixture);

        expect(() => fixture.componentInstance['submit']()).not.toThrow();
      } finally {
        config.useDeprecatedSynchronousErrorHandling = false;
      }
    });

    it('shows every message a single slot claims, not just the first', async () => {
      // Two over-long tags arrive as tags[0] and tags[1] in one 400, since the API emits one entry
      // per violation. Both are claimed by the tags slot, so both are subtracted from the catch-all
      // -- rendering only the first left the second with nowhere at all to appear.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'tags[0]', message: 'first tag is too long' },
            { field: 'tags[1]', message: 'second tag is too long' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const message = errorTextFor(host, 'project-tags') ?? '';
      expect(message).toContain('first tag is too long');
      expect(message).toContain('second tag is too long');
      // Claimed by a slot means claimed for good: neither may reappear in the catch-all either.
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('leaves Save undescribed when there is no catch-all to point at', async () => {
      // A dangling aria-describedby is announced as nothing at all, so the id has to come and go
      // with the element. Hardcoding it passed the whole suite: the positive case was asserted and
      // the negative one never was. Checked on a clean form and on a rejection a row slot claims,
      // where the catch-all is legitimately absent.
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const saveButton = () => host.querySelector('button[type="submit"]');

      expect(saveButton()?.getAttribute('aria-describedby')).toBeNull();

      createProject.mockReturnValue(
        throwError(() => validationProblem('images[0]', 'must be at most 500 characters')),
      );
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'images');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');
      await save(fixture);

      expect(host.querySelector('#image-0-error')).not.toBeNull();
      expect(host.querySelector('.form-error')).toBeNull();
      expect(saveButton()?.getAttribute('aria-describedby')).toBeNull();
    });

    it('still says something when the server names a field but gives no message', async () => {
      // Not reachable from this backend today -- every field error comes from Bean Validation with
      // a message -- but this is the one path whose entire contract is that a rejection reaches a
      // destination. A null message stringifies to "" through the join, which is falsy, so the slot
      // rendered nothing while the catch-all had already counted the key as claimed and shown.
      createProject.mockReturnValue(
        throwError(() => problemWith([{ field: 'title', message: null as unknown as string }])),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      // Verbatim, not toBeTruthy(). This form's fallback is deliberately different from the contact
      // form's -- it names the server, for a reader who knows what `links[0].label` means -- and
      // that claim was unpinned on this side: swapping in the visitor-facing wording left the whole
      // suite green, which is the very substitution the shared fallback used to make silently.
      expect(errorTextFor(host, 'project-title')).toBe(ADMIN_FALLBACK_COPY);
      expect(host.querySelector('#project-title')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('does not leak a separator when a slot has one blank message and one real one', async () => {
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'title', message: null as unknown as string },
            { field: 'title[0]', message: 'the real complaint' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('the real complaint');
    });

    it('still flags a row whose server message is blank', async () => {
      createProject.mockReturnValue(
        throwError(() => problemWith([{ field: 'images[0]', message: '   ' }])),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'images');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#image-0-error')?.textContent?.trim()).toBeTruthy();
      expect(host.querySelector('#image-0')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('does not repeat a message that a field slot already shows inline', async () => {
      createProject.mockReturnValue(
        throwError(() => validationProblem('title', 'must not be blank')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('must not be blank');
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('sends an element sub-property to the catch-all, not to the collection slot', async () => {
      // tags[0] belongs to the tags slot, because the form edits tags as one comma-separated
      // control. A key naming a *property* of an element does not -- it would be rendered against a
      // control that is not the one at fault -- which is what the trailing ] in claims() decides.
      // It still has to surface, and the catch-all is what makes that true without a slot for it.
      createProject.mockReturnValue(
        throwError(() => validationProblem('tags[0].name', 'must not be blank')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-tags')).toBeNull();
      expect(host.querySelector('.form-error')?.textContent).toContain('must not be blank');
    });

    it('still says something when an unclaimed key arrives with no message', async () => {
      // The field slots have routed blank messages through joinMessages() from the start and the
      // catch-all did not, so an unclaimed key with an empty message rendered as a bare field name
      // and nothing else. Same contract, same fix: a rejection reaches a destination with content.
      createProject.mockReturnValue(
        throwError(() => problemWith([{ field: 'links', message: null as unknown as string }])),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const item = host.querySelector('.form-error li');
      expect(item?.textContent).toContain('links');
      // A field name on its own is not a reason. Something beyond it has to be on screen -- and
      // specifically this form's own wording, pinned for the same reason as the slot above.
      expect(item?.textContent).toContain(ADMIN_FALLBACK_COPY);
    });
  });

  describe('a save the client blocks', () => {
    it('takes down the previous rejection instead of showing it beside the new complaint', async () => {
      // submit() used to return on form.invalid *before* clearing fieldErrors, so the server's
      // verdict about a finished save stayed on screen next to the client message about a resubmit
      // that never left. Deliberately breaks a *different* field than the one the server named:
      // where they are the same control the client message takes the slot anyway, so that version
      // of this test would pass with the stale verdict still in the map.
      createProject.mockReturnValue(
        throwError(() => validationProblem('title', 'A project with this title already exists')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('A project with this title already exists');

      await type(fixture, '#project-description', '');
      await save(fixture);

      // Blocked: no second request, so nothing new can have been said about the title.
      expect(createProject).toHaveBeenCalledTimes(1);
      // The disappearance is the assertion. Checking only that the description now complains would
      // pass with the title's verdict still underneath it.
      expect(errorTextFor(host, 'project-title')).toBeNull();
      expect(host.querySelector('#project-title-error')).toBeNull();
      expect(host.querySelector('#project-title')?.getAttribute('aria-invalid')).toBeNull();
      expect(errorTextFor(host, 'project-description')).toBe('Description is required');
    });

    it('takes down an unclaimed rejection and a row verdict too', async () => {
      // The catch-all and the row slots read the same map, so they have to go with it -- an
      // unclaimed key next to a Save that is not saving is the same stale sentence one destination
      // over, and a row verdict is positional on top of that.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'links', message: 'size must be between 0 and 10' },
            { field: 'links[0].url', message: 'must be a valid URL' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://github.example/x');
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.form-error')?.textContent).toContain(
        'size must be between 0 and 10',
      );
      expect(host.querySelector('#link-url-0-error')?.textContent).toContain('must be a valid URL');

      await type(fixture, '#project-title', '');
      await save(fixture);

      expect(createProject).toHaveBeenCalledTimes(1);
      expect(host.querySelector('.form-error')).toBeNull();
      expect(host.querySelector('button[type="submit"]')?.getAttribute('aria-describedby')).toBeNull();
      expect(host.querySelector('#link-url-0-error')).toBeNull();
      expect(errorTextFor(host, 'project-title')).toBe('Title is required');
    });
  });

  describe('several violations on one field', () => {
    it('shows both messages a scalar slot was sent, joined and in the order they arrived', async () => {
      // The API emits one entry per violation and does not dedup, so one field can be named twice
      // in one response. Folding that into a message per key kept the last and dropped the first
      // before any slot ran -- upstream of every guard in this file. Asserted as one exact string
      // rather than two toContain()s: "both rendered" and "one rendered" are indistinguishable
      // through a presence check, which is what makes that assertion vacuous here.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'title', message: 'must not be blank' },
            { field: 'title', message: 'size must be between 0 and 200' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe(
        'must not be blank; size must be between 0 and 200',
      );
      // Claimed by a slot means claimed for good: neither copy may reappear in the catch-all.
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('shows both messages about one link row, which is the case reachable from the UI', async () => {
      // A label of 51 spaces is the whole defect in one value. Validators.required passes it --
      // isEmptyInputValue is true only for null or length 0 -- so the client sends it, and the
      // server answers with @NotBlank *and* @Size, both keyed links[0].label. One of the two used
      // to be discarded at the boundary, and the admin was told half of what was wrong.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'links[0].label', message: 'must not be blank' },
            { field: 'links[0].label', message: 'size must be between 0 and 50' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', ' '.repeat(51));
      await type(fixture, '#link-url-0', 'https://github.example/x');

      await save(fixture);

      // The client let it through, which is what makes the server's double violation reachable.
      expect(createProject).toHaveBeenCalledTimes(1);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#link-label-0-error')?.textContent?.trim()).toBe(
        'must not be blank; size must be between 0 and 50',
      );
      expect(host.querySelector('#link-label-0')?.getAttribute('aria-invalid')).toBe('true');
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('lists an unclaimed key once however many times the server named it', async () => {
      // The catch-all is keyed by field, not by violation: two complaints about `links` are one
      // entry whose text carries both, the way two complaints about tags are one message in the
      // tags slot. One <li> per violation would repeat the key and read as two separate problems --
      // and @for tracks error.field, which duplicates cannot survive.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'links', message: 'size must be between 0 and 10' },
            { field: 'links', message: 'must not contain duplicates' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const items = host.querySelectorAll('.form-error li');
      expect(items.length).toBe(1);
      expect(items[0]?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'links size must be between 0 and 10; must not contain duplicates',
      );
    });
  });

  describe('server errors once the rows move', () => {
    /** Two filled link rows and a rejection keyed at `field`. */
    async function twoRowsRejectedAt(
      fixture: ComponentFixture<AdminProjectFormComponent>,
      field: string,
    ): Promise<void> {
      createProject.mockReturnValue(
        throwError(() => validationProblem(field, 'must be a valid URL')),
      );
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await type(fixture, '#link-label-1', 'Docs');
      await type(fixture, '#link-url-1', 'https://b.example/two');
      await save(fixture);
    }

    it('does not migrate a row message onto the row that takes its place', async () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await twoRowsRejectedAt(fixture, 'links[0].url');

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#link-url-0-error')).not.toBeNull();

      await clickRemoveRow(fixture, 'links', 0);

      // Row B is now index 0. The verdict was about row A, which no longer exists, so row B must
      // not inherit it -- it would be flagged for a URL it never had.
      expect(host.querySelector<HTMLInputElement>('#link-url-0')?.value).toBe(
        'https://b.example/two',
      );
      expect(host.querySelector('#link-url-0-error')).toBeNull();
      expect(host.querySelector('#link-url-0')?.getAttribute('aria-invalid')).toBeNull();
    });

    it('does not keep a verdict about a row index that no longer exists', async () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await twoRowsRejectedAt(fixture, 'links[1].url');

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#link-url-1-error')).not.toBeNull();

      await clickRemoveRow(fixture, 'links', 0);

      // Asserted on the state, not only the DOM, and deliberately: a stale links[1].url left in
      // fieldErrors is *invisible* at this moment, because no row claims it and unclaimedErrors()
      // is a computed that a FormArray mutation does not invalidate. It becomes visible on the next
      // render that has an index 1 again. Absence from the DOM is therefore not evidence that the
      // verdict is gone -- this is.
      expect(fixture.componentInstance['fieldErrors']()).toEqual({});
      expect(host.querySelector('.form-error')).toBeNull();
      expect(host.querySelectorAll('.field-error')).toHaveLength(0);
    });

    it('freezes the rows while a save is in flight', async () => {
      // The window forgetErrorsFor() cannot cover: it purges when the rows change, but a 400's
      // indices are computed against the payload already sent and arrive afterwards. Remove row 0
      // mid-flight and links[0].url lands on the row that took its place.
      const pending = new Subject<unknown>();
      createProject.mockReturnValue(pending);

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await type(fixture, '#link-label-1', 'Docs');
      await type(fixture, '#link-url-1', 'https://b.example/two');

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const removeFirst = host.querySelector<HTMLButtonElement>(
        'fieldset[formarrayname="links"] .repeatable-row button',
      );
      expect(removeFirst?.disabled).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>('fieldset[formarrayname="links"] > button')?.disabled,
      ).toBe(true);

      await clickRemoveRow(fixture, 'links', 0);
      // A disabled button is UX, not a guarantee -- the handler has to refuse on its own too.
      fixture.componentInstance['removeLink'](0);
      fixture.componentInstance['addLink']();
      await fixture.whenStable();

      expect(fixture.componentInstance['form'].controls.links.length).toBe(2);

      pending.error(validationProblem('links[0].url', 'must be a valid URL'));
      await fixture.whenStable();

      // The verdict describes the payload that was sent, and the rows still match it.
      expect(host.querySelector<HTMLInputElement>('#link-url-0')?.value).toBe(
        'https://a.example/one',
      );
      expect(host.querySelector('#link-url-0-error')?.textContent?.trim()).toBe(
        'must be a valid URL',
      );
      expect(host.querySelector('#link-url-1-error')).toBeNull();
    });

    it('freezes the image rows while a save is in flight', async () => {
      // The links version of this exists directly above. Not duplicating it left four mutants
      // alive -- the guard in addImage, the guard in removeImage, and the disabled binding on each
      // of the two images buttons -- in the same round whose commit message claimed to be
      // mirroring the links-side guards onto images.
      const pending = new Subject<unknown>();
      createProject.mockReturnValue(pending);

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'images');
      await clickAddRow(fixture, 'images');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');
      await type(fixture, '#image-1', 'https://images.example.com/two.png');

      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelector<HTMLButtonElement>(
          'fieldset[formarrayname="images"] .repeatable-row button',
        )?.disabled,
      ).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>('fieldset[formarrayname="images"] > button')?.disabled,
      ).toBe(true);

      await clickRemoveRow(fixture, 'images', 0);
      // A disabled button is UX; each handler has to refuse on its own as well.
      fixture.componentInstance['removeImage'](0);
      fixture.componentInstance['addImage']();
      await fixture.whenStable();

      expect(fixture.componentInstance['form'].controls.images.length).toBe(2);

      pending.error(validationProblem('images[0]', 'must be at most 500 characters'));
      await fixture.whenStable();

      expect(host.querySelector<HTMLInputElement>('#image-0')?.value).toBe(
        'https://images.example.com/one.png',
      );
      expect(host.querySelector('#image-0-error')?.textContent?.trim()).toBe(
        'must be at most 500 characters',
      );
      expect(host.querySelector('#image-1-error')).toBeNull();
    });

    it('does not migrate an image message onto the row that takes its place', async () => {
      // The images mirror of the links case above. Three mutations survived on this side purely
      // because the links tests were never duplicated for it.
      createProject.mockReturnValue(
        throwError(() => validationProblem('images[0]', 'must be at most 500 characters')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'images');
      await clickAddRow(fixture, 'images');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');
      await type(fixture, '#image-1', 'https://images.example.com/two.png');
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#image-0-error')).not.toBeNull();
      // The image row claimed the key, so the catch-all must not repeat it -- the links half of
      // this is asserted above, and leaving it unasserted here let the images spread be deleted
      // from rowFieldKeys() with the suite still green.
      expect(host.querySelector('.form-error')).toBeNull();

      await clickRemoveRow(fixture, 'images', 0);

      expect(fixture.componentInstance['fieldErrors']()).toEqual({});
      expect(host.querySelector<HTMLInputElement>('#image-0')?.value).toBe(
        'https://images.example.com/two.png',
      );
      expect(host.querySelector('#image-0-error')).toBeNull();
      expect(host.querySelector('#image-0')?.getAttribute('aria-invalid')).toBeNull();
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('drops an images verdict when an image row is added', async () => {
      createProject.mockReturnValue(
        throwError(() => validationProblem('images', 'size must be between 0 and 20')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.form-error')).not.toBeNull();

      await clickAddRow(fixture, 'images');

      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('leaves verdicts about everything else alone when one collection changes', async () => {
      // The purge is scoped to the collection that moved. Widening it to drop everything passed the
      // whole suite, and would quietly clear a title rejection the admin has not addressed yet.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'title', message: 'must not be blank' },
            { field: 'images[0]', message: 'must be at most 500 characters' },
            { field: 'links[0].url', message: 'must be a valid URL' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'images');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('must not be blank');

      // Adding a link says nothing about the title or about the images.
      await clickAddRow(fixture, 'links');

      expect(errorTextFor(host, 'project-title')).toBe('must not be blank');
      expect(host.querySelector('#image-0-error')?.textContent?.trim()).toBe(
        'must be at most 500 characters',
      );
      expect(fixture.componentInstance['fieldErrors']()['links[0].url']).toBeUndefined();
    });

    it('clears the previous rejection when the next save fails without field errors', async () => {
      // A 500 or a 429 carries no field errors, so nothing overwrites the map. Without the reset in
      // submit() the first rejection's messages stay on screen, describing a save that is over.
      createProject.mockReturnValueOnce(
        throwError(() => validationProblem('title', 'must not be blank')),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('must not be blank');

      createProject.mockReturnValue(
        throwError(() => ({ ...LOAD_FAILURE, status: 500, fieldErrors: [] })),
      );
      await save(fixture);

      expect(errorTextFor(host, 'project-title')).toBeNull();
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('drops a collection-level verdict once the collection changes', async () => {
      createProject.mockReturnValue(
        throwError(() => validationProblem('links', 'size must be between 0 and 10')),
      );
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.form-error')).not.toBeNull();

      await clickAddRow(fixture, 'links');

      // A size verdict about the old list is not about the new one.
      expect(host.querySelector('.form-error')).toBeNull();
    });
  });

  describe('removing a row', () => {
    // Driven through real clicks and input events rather than addLink()/removeLink(). The rendered
    // rows come from form.controls.links.controls, a plain array and not a signal, so nothing marks
    // this OnPush view dirty when the array is mutated from outside a template listener -- in the
    // app the "+ Add link" click does that, and a programmatic call in a test does not.
    it('drops the removed link from the DOM rather than the last one', async () => {
      // formGroupName is positional, so tracking rows by $index leaves the surviving group bound to
      // the removed row's DOM: the admin sees the link they just deleted, deletes it again, and
      // loses the other one -- and whatever those inputs hold is what the next PUT sends.
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      await clickAddRow(fixture, 'links');
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await type(fixture, '#link-label-1', 'Docs');
      await type(fixture, '#link-url-1', 'https://b.example/two');

      await clickRemoveRow(fixture, 'links', 0);

      expect(host.querySelectorAll('[id^="link-label-"]')).toHaveLength(1);
      expect(host.querySelector<HTMLInputElement>('#link-label-0')?.value).toBe('Docs');
      expect(host.querySelector<HTMLInputElement>('#link-url-0')?.value).toBe(
        'https://b.example/two',
      );
      expect(fixture.componentInstance['form'].controls.links.at(0).getRawValue()).toEqual({
        label: 'Docs',
        url: 'https://b.example/two',
      });
    });

    it('drops the removed image from the DOM rather than the last one', async () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      await clickAddRow(fixture, 'images');
      await clickAddRow(fixture, 'images');
      await type(fixture, '#image-0', 'https://images.example.com/one.png');
      await type(fixture, '#image-1', 'https://images.example.com/two.png');

      await clickRemoveRow(fixture, 'images', 0);

      expect(host.querySelectorAll('[id^="image-"]')).toHaveLength(1);
      expect(host.querySelector<HTMLInputElement>('#image-0')?.value).toBe(
        'https://images.example.com/two.png',
      );
    });
  });

  it('does not duplicate links and images when the project is loaded twice', async () => {
    // The duplicate-append guard, exercised where it actually bites. A retry after a failure finds
    // the FormArrays empty, so only a second *successful* load can double the rows -- without the
    // clear() resetForm() does before each load, this project comes back with two of everything.
    editExistingProject();
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();

    // retryLoad() directly, not through the button: the first load succeeded, so there is no
    // error state and no button to click. Only the flush is converted -- the repaint that follows
    // is what the assertions below read.
    fixture.componentInstance['retryLoad']();
    await fixture.whenStable();

    expect(getProject).toHaveBeenCalledTimes(2);
    const form = fixture.componentInstance['form'];
    expect(form.controls.links.length).toBe(1);
    expect(form.controls.images.length).toBe(1);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('input[type="url"]').length).toBe(2);
  });

  it('shows the server field error for completedOn when the client check passes', async () => {
    // The client check is an early warning, not the authority -- e.g. a stale tab whose rules
    // predate a backend change still has to surface whatever the 400 says.
    createProject.mockReturnValue(
      throwError(() => validationProblem('completedOn', 'completedOn must not precede startedOn')),
    );

    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    fixture.componentInstance['form'].patchValue({
      startedOn: '2024-03-01',
      completedOn: '2025-06-01',
    });

    await save(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(errorTextFor(host, 'project-completed-on')).toBe(
      'completedOn must not precede startedOn',
    );
    expect(fixture.componentInstance['submitting']()).toBe(false);
  });
  describe('a verdict the form has moved on from', () => {
    /** Fill the form, have the next save rejected at `field`, and send it. */
    async function saveRejectedAt(
      fixture: ComponentFixture<AdminProjectFormComponent>,
      field: string,
      message: string,
    ): Promise<void> {
      createProject.mockReturnValue(throwError(() => validationProblem(field, message)));
      fillRequiredFields(fixture);
      await save(fixture);
    }

    it('drops a scalar verdict once its own control is edited', async () => {
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await saveRejectedAt(fixture, 'title', 'A project with this title already exists');

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('A project with this title already exists');

      // A different title, and one this form's own validators accept. The *absence* of the server's
      // sentence is the assertion: asserting that a client message appeared instead would pass with
      // the stale verdict still underneath it, and emptying the field would only hide it behind
      // "Title is required" -- from where it comes back the moment the field is refilled.
      await type(fixture, '#project-title', 'Equalizer v2');

      expect(host.textContent).not.toContain('A project with this title already exists');
      expect(errorTextFor(host, 'project-title')).toBeNull();
      expect(host.querySelector('#project-title-error')).toBeNull();
      expect(host.querySelector('#project-title')?.getAttribute('aria-invalid')).toBeNull();
      // Not merely hidden: gone from the map, so no later render can find it again.
      expect(fixture.componentInstance['fieldErrors']()).toEqual({});
      // And not moved into the catch-all either -- the key is dropped, not unclaimed.
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('leaves the verdicts about other fields alone when one control is edited', async () => {
      // The purge is scoped to the control that changed, the way forgetErrorsFor() is scoped to the
      // collection that moved. Widening it to "discard everything on any edit" passes every other
      // test in this file, and would clear a rejection the admin has not dealt with yet as a side
      // effect of them fixing a different field.
      createProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'title', message: 'A project with this title already exists' },
            { field: 'description', message: 'must be at most 5000 characters' },
            { field: 'images', message: 'size must be between 0 and 20' },
          ]),
        ),
      );

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-description')).toBe('must be at most 5000 characters');

      await type(fixture, '#project-title', 'Equalizer v2');

      expect(errorTextFor(host, 'project-title')).toBeNull();
      expect(errorTextFor(host, 'project-description')).toBe('must be at most 5000 characters');
      expect(host.querySelector('.form-error')?.textContent).toContain(
        'size must be between 0 and 20',
      );
    });

    it('drops an indexed tags verdict once the tags control is edited', async () => {
      // `tags[1]` names an element of the list this one control holds, so editing the control is
      // what makes it stale -- there is no second slot for it to stay accurate in.
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await type(fixture, '#project-tags', 'dsp, an-extremely-long-tag');
      await saveRejectedAt(fixture, 'tags[1]', 'must be at most 50 characters');

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-tags')).toBe('must be at most 50 characters');

      await type(fixture, '#project-tags', 'dsp');

      expect(host.textContent).not.toContain('must be at most 50 characters');
      expect(errorTextFor(host, 'project-tags')).toBeNull();
      expect(fixture.componentInstance['fieldErrors']()).toEqual({});
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('freezes the tags input while a save is in flight', async () => {
      // The window the purge cannot see: a `tags[1]` verdict is computed against the list that was
      // sent and arrives after any mid-flight edit, so it would render against a list that no
      // longer holds that tag. Frozen for the reason the link and image rows are frozen -- the key
      // is positional -- and readonly rather than disabled, which would grey the control out and
      // take the focus with it.
      const pending = new Subject<unknown>();
      createProject.mockReturnValue(pending);

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      await type(fixture, '#project-tags', 'dsp, audio');
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector<HTMLInputElement>('#project-tags')?.readOnly).toBe(true);

      pending.error(validationProblem('tags[1]', 'must be at most 50 characters'));
      await fixture.whenStable();

      // Released with the rest of the form, and the verdict describes the list still in the box.
      expect(host.querySelector<HTMLInputElement>('#project-tags')?.readOnly).toBe(false);
      expect(host.querySelector<HTMLInputElement>('#project-tags')?.value).toBe('dsp, audio');
      expect(errorTextFor(host, 'project-tags')).toBe('must be at most 50 characters');
    });

    it('releases the form when a save completes without emitting or failing', async () => {
      // HttpClient always emits or errors, so this is a shape rather than a reachable path. With
      // submitting() cleared only in the two handlers, a completion carrying neither leaves Save
      // disabled for good -- and, since the row structure was frozen to the same signal, every
      // "+ Add" and "Remove" button with it, saying nothing about why.
      const pending = new Subject<unknown>();
      createProject.mockReturnValue(pending);

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      fillRequiredFields(fixture);
      // Filled, not just added: an empty row is invalid, and the save would be blocked by this
      // form's own validators before it ever reached the state this test is about.
      await clickAddRow(fixture, 'links');
      await type(fixture, '#link-label-0', 'GitHub');
      await type(fixture, '#link-url-0', 'https://a.example/one');
      await save(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(createProject).toHaveBeenCalledTimes(1);
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

      pending.complete();
      await fixture.whenStable();

      expect(fixture.componentInstance['submitting']()).toBe(false);
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
      for (const array of ['links', 'images']) {
        expect(
          host.querySelector<HTMLButtonElement>(`fieldset[formarrayname="${array}"] > button`)
            ?.disabled,
        ).toBe(false);
      }
      expect(
        host.querySelector<HTMLButtonElement>(
          'fieldset[formarrayname="links"] .repeatable-row button',
        )?.disabled,
      ).toBe(false);
      expect(host.querySelector<HTMLInputElement>('#project-tags')?.readOnly).toBe(false);
    });

    it('shows the error state when a load completes without a project', async () => {
      // The load's half of the same shape, and the reason clearing loading() is not on its own the
      // safe end of it: loading false with nothing loaded and no error renders the form, empty --
      // and an empty edit form is one PUT away from blanking the record.
      const pending = new Subject<unknown>();
      getProject.mockReturnValue(pending);
      editExistingProject();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading');

      pending.complete();
      await fixture.whenStable();

      expect(fixture.componentInstance['loading']()).toBe(false);
      expect(host.querySelector('form')).toBeNull();
      expect(host.querySelector('#project-title')).toBeNull();
      expect(host.querySelector('.load-error [role="alert"]')?.textContent).toContain(
        'Could not load this project',
      );
    });
  });

  describe('when the route moves from one project to another', () => {
    // Angular's default RouteReuseStrategy reuses this component when a navigation changes only the
    // params, so nothing here unmounts. Reading the id once, in a field initialiser, therefore
    // leaves the form showing -- and saving -- the project the admin arrived on first.
    //
    // No UI path reaches this today: every link to an edit route is on the projects list, which
    // does unmount the form. These pin the behaviour for whoever adds prev/next links or an "edit
    // another" after saving, at which point it would be a silent write to the wrong record.
    beforeEach(() => {
      getProject.mockImplementation(({ id }: { id: string }) =>
        of(id === 'p2' ? OTHER_PROJECT : EXISTING_PROJECT),
      );
    });

    it('loads the project the route now names, and shows none of the previous one', async () => {
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Equalizer');

      await navigateToProject(fixture, 'p2');

      expect(getProject).toHaveBeenLastCalledWith({ id: 'p2' });
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Reverb');
      expect(host.querySelector<HTMLTextAreaElement>('#project-description')?.value).toBe(
        'A room simulator',
      );
      expect(host.querySelector<HTMLInputElement>('#project-tags')?.value).toBe('audio');
      expect(host.querySelector<HTMLInputElement>('#project-started-on')?.value).toBe('2025-01-01');
      // Reverb is ongoing. A field left holding Equalizer's completion date would be saved back.
      expect(host.querySelector<HTMLInputElement>('#project-completed-on')?.value).toBe('');
    });

    it('rebuilds the rows for the second project rather than appending them to the first', async () => {
      // form.reset() does not empty a FormArray, so without the clear the arrays hold both
      // projects' rows -- three links and two images -- and the next save PUTs all of them.
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      await navigateToProject(fixture, 'p2');

      const form = fixture.componentInstance['form'];
      expect(form.controls.links.getRawValue()).toEqual(OTHER_PROJECT.links);
      expect(form.controls.images.getRawValue()).toEqual(OTHER_PROJECT.images);

      const host = fixture.nativeElement as HTMLElement;
      expect(inputValues(host, 'input[id^="link-label-"]')).toEqual(['Docs', 'Demo']);
      expect(inputValues(host, 'input[id^="link-url-"]')).toEqual([
        'https://docs.example/reverb',
        'https://demo.example/reverb',
      ]);
      expect(inputValues(host, 'input[id^="image-"]')).toEqual([
        'https://images.example.com/two.png',
      ]);
    });

    it('saves to the id the route now names', async () => {
      // The data-loss half: with the id read once, this PUT goes to p1 while the address bar, the
      // heading and every field say p2 -- an edit of one project silently overwriting another.
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      await navigateToProject(fixture, 'p2');
      await save(fixture);

      expect(updateProject).toHaveBeenCalledTimes(1);
      const { id, projectWriteRequest } = updateProject.mock.calls[0][0];
      expect(id).toBe('p2');
      expect(projectWriteRequest.title).toBe('Reverb');
      expect(projectWriteRequest.links).toEqual(OTHER_PROJECT.links);
    });

    it('drops the previous project\'s server verdicts', async () => {
      // These describe a payload for a different record, and the row keys are positional on top of
      // that: `links[1].url` about Equalizer's links would land on one of Reverb's.
      updateProject.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'title', message: 'A project with this title already exists' },
            { field: 'links[0].url', message: 'must be a valid URL' },
            { field: 'images', message: 'size must be between 0 and 20' },
          ]),
        ),
      );
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      await save(fixture);

      // Asserted present before the navigation asserts them gone -- otherwise "no verdicts after"
      // would pass against a form that never rendered a verdict in the first place.
      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'project-title')).toBe('A project with this title already exists');
      expect(host.querySelector('#link-url-0-error')).not.toBeNull();
      expect(host.querySelector('.form-error')).not.toBeNull();

      await navigateToProject(fixture, 'p2');

      expect(fixture.componentInstance['fieldErrors']()).toEqual({});
      expect(host.textContent).not.toContain('A project with this title already exists');
      expect(host.querySelectorAll('.field-error')).toHaveLength(0);
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('does not leave the first project\'s failure over the second project\'s form', async () => {
      // The load for p1 fails and the admin navigates on. Without the reset the error state stays,
      // and "Try again" is the only thing on screen for a project that loaded perfectly well.
      getProject.mockReturnValueOnce(throwError(() => LOAD_FAILURE));
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.load-error')).not.toBeNull();

      await navigateToProject(fixture, 'p2');

      expect(host.querySelector('.load-error')).toBeNull();
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Reverb');
    });

    it('stays in its loading state while the second project is on its way', async () => {
      // Cancelling the first load runs its finalize(), which clears loading(). The second load has
      // to set it *after* that teardown, or the page leaves the loading state with nothing loaded
      // and no error -- which renders the form, empty, over a project that has not arrived yet, and
      // an empty edit form is one PUT away from blanking the record. That ordering is what the
      // defer() in startLoad() buys, and it is why the state is not set from a tap() before the
      // switchMap.
      const firstLoad = new Subject<unknown>();
      const secondLoad = new Subject<unknown>();
      getProject.mockReturnValueOnce(firstLoad).mockReturnValueOnce(secondLoad);
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      await navigateToProject(fixture, 'p2');

      expect(fixture.componentInstance['loading']()).toBe(true);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading');
      expect(host.querySelector('form')).toBeNull();

      secondLoad.next(OTHER_PROJECT);
      secondLoad.complete();
      await fixture.whenStable();

      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Reverb');
    });

    it('drops a request for the project the admin has navigated away from', async () => {
      // switchMap, not a second subscription: p1's response would otherwise land in a form that is
      // now showing p2 and overwrite every field with the wrong project's data.
      const slowFirstLoad = new Subject<unknown>();
      getProject.mockReturnValueOnce(slowFirstLoad);
      editExistingProject();
      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();

      await navigateToProject(fixture, 'p2');
      // p1 answering late, after the admin has moved on.
      slowFirstLoad.next(EXISTING_PROJECT);
      slowFirstLoad.complete();
      await fixture.whenStable();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Reverb');
      expect(fixture.componentInstance['form'].controls.links.getRawValue()).toEqual(
        OTHER_PROJECT.links,
      );
      expect(fixture.componentInstance['loading']()).toBe(false);
    });
  });

});
