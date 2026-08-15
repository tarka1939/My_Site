import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { ApiProblem } from '../../../core/http/api-problem';
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
 * The component reads the route id once, at construction. A mutable stub lets a test switch to
 * edit mode before createComponent -- TestBed.overrideProvider cannot, because injecting Router in
 * beforeEach has already instantiated the module by then.
 */
interface RouteStub {
  snapshot: { paramMap: ParamMap };
}

function validationProblem(field: string, message: string): ApiProblem {
  return {
    status: 400,
    title: 'Bad Request',
    detail: 'Request failed validation',
    fieldErrors: [{ field, message }],
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

function errorTextFor(host: HTMLElement, inputId: string): string | null {
  const field = host.querySelector(`#${inputId}`)?.closest('.field');
  return field?.querySelector('.field-error')?.textContent?.trim() ?? null;
}

describe('AdminProjectFormComponent', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let createProject: ReturnType<typeof vi.fn>;
  let updateProject: ReturnType<typeof vi.fn>;
  let route: RouteStub;

  /** Switch the pending fixture from "new project" to "edit p1". Call before createComponent. */
  function editExistingProject(): void {
    route.snapshot.paramMap = convertToParamMap({ id: 'p1' });
  }

  beforeEach(async () => {
    getProject = vi.fn().mockReturnValue(of(EXISTING_PROJECT));
    createProject = vi.fn().mockReturnValue(of(EXISTING_PROJECT));
    updateProject = vi.fn().mockReturnValue(of(EXISTING_PROJECT));
    route = { snapshot: { paramMap: convertToParamMap({}) } };

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

  it('blocks a completion date that precedes the start date, and says why', () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    fixture.componentInstance['form'].patchValue({
      startedOn: '2025-06-01',
      completedOn: '2024-03-01',
    });
    fixture.detectChanges();

    fixture.componentInstance['submit']();

    expect(createProject).not.toHaveBeenCalled();
    const host = fixture.nativeElement as HTMLElement;
    expect(errorTextFor(host, 'project-completed-on')).toContain('cannot be earlier');
    expect(host.querySelector('#project-completed-on')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('points the completion input at its error message, not just at the hint', () => {
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

    fixture.componentInstance['form'].patchValue({
      startedOn: '2025-06-01',
      completedOn: '2024-03-01',
    });
    fixture.detectChanges();

    const describedBy = input?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    expect(describedBy).toContain('project-completed-on-error');
    expect(describedBy).toContain('project-completed-on-hint');
    // A dangling id reference is announced as nothing at all, so resolve each one.
    const described = describedBy.map((id) => host.querySelector(`#${id}`)?.textContent?.trim());
    expect(described.every((text) => !!text)).toBe(true);
    expect(described.join(' ')).toContain('cannot be earlier');
  });

  it('blocks a completion date supplied without a start date', () => {
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();
    fillRequiredFields(fixture);
    fixture.componentInstance['form'].patchValue({ completedOn: '2025-06-01' });
    fixture.detectChanges();

    fixture.componentInstance['submit']();

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
      expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBeTruthy();
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

    it('loads the project on retry, populating links and images exactly once', () => {
      failFirstLoad();

      const fixture = TestBed.createComponent(AdminProjectFormComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      host.querySelector<HTMLButtonElement>('.load-error button')?.click();
      fixture.detectChanges();

      expect(getProject).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.load-error')).toBeNull();
      expect(host.querySelector<HTMLInputElement>('#project-title')?.value).toBe('Equalizer');
      // The duplicate-append guard: the first load's rows have to be cleared before the second
      // load pushes its own, or the retried project comes back with two of everything.
      const form = fixture.componentInstance['form'];
      expect(form.controls.links.length).toBe(1);
      expect(form.controls.images.length).toBe(1);
      expect(host.querySelectorAll('input[type="url"]').length).toBe(2);

      fixture.componentInstance['submit']();

      expect(updateProject).toHaveBeenCalledTimes(1);
      const body = updateProject.mock.calls[0][0].projectWriteRequest;
      expect(body.links).toHaveLength(1);
      expect(body.images).toHaveLength(1);
    });
  });

  it('does not duplicate links and images when the project is loaded twice', () => {
    // The duplicate-append guard, exercised where it actually bites. A retry after a failure finds
    // the FormArrays empty, so only a second *successful* load can double the rows -- without the
    // clear() in the load handler, this project comes back with two links and two images.
    editExistingProject();
    const fixture = TestBed.createComponent(AdminProjectFormComponent);
    fixture.detectChanges();

    fixture.componentInstance['retryLoad']();
    fixture.detectChanges();

    expect(getProject).toHaveBeenCalledTimes(2);
    const form = fixture.componentInstance['form'];
    expect(form.controls.links.length).toBe(1);
    expect(form.controls.images.length).toBe(1);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('input[type="url"]').length).toBe(2);
  });

  it('shows the server field error for completedOn when the client check passes', () => {
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

    fixture.componentInstance['submit']();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(errorTextFor(host, 'project-completed-on')).toBe(
      'completedOn must not precede startedOn',
    );
    expect(fixture.componentInstance['submitting']()).toBe(false);
  });
});
