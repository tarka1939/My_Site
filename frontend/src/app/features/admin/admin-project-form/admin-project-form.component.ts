import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { ProjectWriteRequest } from '../../../core/api/model/projectWriteRequest';
import { ApiProblem } from '../../../core/http/api-problem';
import {
  PROJECT_PERIOD_MESSAGES,
  validateProjectPeriod,
} from '../../../shared/project-period/project-period';

type LinkGroup = FormGroup<{ label: FormControl<string>; url: FormControl<string> }>;

/**
 * Wording for this form's own validators, keyed by the error key Validators.* produces. The limits
 * repeat the ones on the controls below, which in turn come from ProjectWriteRequest in
 * docs/openapi.yaml -- change one and change all three.
 */
const TITLE_MESSAGES: Record<string, string> = {
  required: 'Title is required',
  maxlength: 'Title cannot exceed 200 characters',
};
const DESCRIPTION_MESSAGES: Record<string, string> = {
  required: 'Description is required',
  maxlength: 'Description cannot exceed 5000 characters',
};
const TAGS_MESSAGES: Record<string, string> = {
  required: 'At least one tag is required',
};

function messageFor(errors: ValidationErrors | null, messages: Record<string, string>): string | null {
  for (const key of Object.keys(errors ?? {})) {
    if (messages[key]) {
      return messages[key];
    }
  }
  return null;
}

@Component({
  selector: 'app-admin-project-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './admin-project-form.component.html',
  styleUrl: './admin-project-form.component.scss',
})
export class AdminProjectFormComponent {
  private readonly projectsApi = inject(ProjectsService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly projectId = this.route.snapshot.paramMap.get('id');
  protected readonly isEditMode = this.projectId !== null;
  protected readonly loading = signal(this.isEditMode);
  protected readonly submitting = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  /**
   * Set when the project this form is editing could not be fetched. It gates both the template
   * (error state instead of the form) and submit(), because an edit form with no loaded data is
   * not merely empty -- saving it PUTs, and PUT is a full replacement, so it would overwrite the
   * stored title, description, tags, links, images and dates with blanks.
   */
  protected readonly loadError = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.required, Validators.maxLength(5000)]],
    tags: ['', Validators.required],
    // Empty string is this form's "no date". It maps to an explicit null on the wire; see submit().
    startedOn: [''],
    completedOn: [''],
    links: new FormArray<LinkGroup>([]),
    images: new FormArray<FormControl<string>>([]),
  });

  /**
   * The period rules the API enforces (see ProjectWriteRequest in docs/openapi.yaml), checked here
   * so the admin sees them before a round trip. The server stays the authority -- its 400 comes
   * back keyed on `completedOn` and lands in the same slot, via completedOnError().
   */
  private readonly startedOnValue = toSignal(this.form.controls.startedOn.valueChanges, {
    initialValue: '',
  });
  private readonly completedOnValue = toSignal(this.form.controls.completedOn.valueChanges, {
    initialValue: '',
  });
  private readonly periodError = computed(() => {
    const violation = validateProjectPeriod(this.startedOnValue(), this.completedOnValue());
    return violation === null ? null : PROJECT_PERIOD_MESSAGES[violation];
  });
  protected readonly completedOnError = computed(
    () => this.periodError() ?? this.fieldErrors()['completedOn'] ?? null,
  );

  protected readonly titleError = this.controlError(this.form.controls.title, 'title', TITLE_MESSAGES);
  protected readonly descriptionError = this.controlError(
    this.form.controls.description,
    'description',
    DESCRIPTION_MESSAGES,
  );
  protected readonly tagsError = this.controlError(this.form.controls.tags, 'tags', TAGS_MESSAGES);

  constructor() {
    this.loadProject();
  }

  /** Re-runs the load after a failure. Clears the error state on the way in, via loadProject(). */
  protected retryLoad(): void {
    this.loadProject();
  }

  private loadProject(): void {
    const id = this.projectId;
    if (!id) {
      return;
    }

    this.loading.set(true);
    this.loadError.set(null);

    this.projectsApi.getProject({ id }).subscribe({
      next: (project) => {
        this.form.patchValue({
          title: project.title,
          description: project.description,
          tags: project.tags.map((t) => t.name).join(', '),
          // Round-tripping these matters more than it looks: PUT takes the same body as POST, so
          // a field left out of the payload clears the stored value rather than preserving it.
          startedOn: project.startedOn ?? '',
          completedOn: project.completedOn ?? '',
        });
        // Clear before repopulating. Retry makes this handler runnable more than once, and push
        // without clear gives a second successful load two of every row. (A retry that follows a
        // failure finds the arrays empty, so that is not the case that bites -- which is exactly
        // why the loader is made idempotent here rather than left to depend on how it got here.)
        this.form.controls.links.clear();
        this.form.controls.images.clear();
        project.links.forEach((link) => this.form.controls.links.push(this.buildLinkGroup(link.label, link.url)));
        project.images.forEach((image) =>
          this.form.controls.images.push(this.buildImageControl(image)),
        );
        this.loading.set(false);
      },
      error: () => {
        // No notifications.error() here on purpose: errorInterceptor already toasts every
        // non-field error, and on a 401 it also logs out and redirects to the login page. The
        // missing piece was never the banner -- it was that the form stayed rendered and saveable
        // over data it never loaded.
        this.loadError.set(
          'Could not load this project. Nothing has been changed -- try again, or go back to the project list.',
        );
        this.loading.set(false);
      },
    });
  }

  protected addLink(): void {
    this.form.controls.links.push(this.buildLinkGroup());
  }

  protected removeLink(index: number): void {
    this.form.controls.links.removeAt(index);
  }

  protected addImage(): void {
    this.form.controls.images.push(this.buildImageControl());
  }

  protected removeImage(index: number): void {
    this.form.controls.images.removeAt(index);
  }

  protected submit(): void {
    // Deliberately redundant with the template, which renders the error state instead of the form.
    // The template guard is the UX; this one is what makes the data-loss path unreachable, since a
    // PUT built from a form that never received its project would blank every field of the record.
    if (this.loadError()) {
      return;
    }

    const raw = this.form.getRawValue();

    if (this.form.invalid || validateProjectPeriod(raw.startedOn, raw.completedOn) || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const tags = raw.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const writeRequest: ProjectWriteRequest = {
      title: raw.title,
      description: raw.description,
      tags,
      links: raw.links,
      images: raw.images,
      // Explicit null rather than an omitted key. The contract treats them identically, but PUT is
      // a full replacement, so saying "clear this" out loud beats relying on an absent field.
      startedOn: raw.startedOn || null,
      completedOn: raw.completedOn || null,
    };

    this.submitting.set(true);
    this.fieldErrors.set({});

    const request$ = this.projectId
      ? this.projectsApi.updateProject({ id: this.projectId, projectWriteRequest: writeRequest })
      : this.projectsApi.createProject({ projectWriteRequest: writeRequest });

    request$.subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigateByUrl('/admin/projects');
      },
      error: (problem: ApiProblem) => {
        this.submitting.set(false);
        if (problem.fieldErrors.length > 0) {
          this.fieldErrors.set(Object.fromEntries(problem.fieldErrors.map((e) => [e.field, e.message])));
        }
        // Non-field errors are surfaced globally by errorInterceptor.
      },
    });
  }

  /**
   * One message slot per field, on the completedOnError() model: this form's own validator message
   * while the control is in violation, otherwise whatever the server said about the same field.
   * Held back until the control is touched or edited, so a blank new form does not open covered in
   * complaints -- submit() calls markAllAsTouched(), which is what makes them appear on a rejected
   * save instead of the old silent return.
   *
   * The events() read is what keeps this reactive, and is not optional: AbstractControl exposes
   * `touched`, `dirty` and `errors` through untracked() (Angular 21), so a computed reading only
   * those would cache its first answer and never update -- a failure state that renders as an idle
   * one, which is the same bug this component is being fixed for. `events` emits on every value,
   * status and touched change, so the computed is invalidated exactly when one of them moves.
   */
  private controlError(
    control: AbstractControl,
    field: string,
    messages: Record<string, string>,
  ): Signal<string | null> {
    const events = toSignal(control.events, { initialValue: null });

    return computed(() => {
      events();
      const clientMessage =
        control.touched || control.dirty ? messageFor(control.errors, messages) : null;
      return clientMessage ?? this.fieldErrors()[field] ?? null;
    });
  }

  /**
   * Same idea for a link or image row, which is required and nothing else. Rows are added and
   * removed at runtime, so there is no stable computed to hang each one on; the template calls
   * this instead and it is re-evaluated on every check of the view. That is sound for the reason a
   * computed would not be: the checks are driven by the ng-touched/ng-invalid host bindings Angular
   * puts on every formControlName element, which read those same control signals.
   */
  protected rowError(control: AbstractControl, label: string): string | null {
    if (!control.touched && !control.dirty) {
      return null;
    }
    return control.hasError('required') ? `${label} is required` : null;
  }

  private buildLinkGroup(label = '', url = ''): LinkGroup {
    return this.formBuilder.nonNullable.group({
      label: [label, Validators.required],
      url: [url, Validators.required],
    });
  }

  private buildImageControl(url = ''): FormControl<string> {
    return this.formBuilder.nonNullable.control(url, Validators.required);
  }
}
