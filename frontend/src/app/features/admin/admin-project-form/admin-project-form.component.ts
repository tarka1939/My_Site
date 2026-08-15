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

/**
 * Whether a server field key belongs to the slot for `field`. One rule, used twice: serverError()
 * finds a slot's message with it, and unclaimedErrors() subtracts with it -- so a key can never be
 * both rendered inline and repeated in the catch-all, and can never be claimed by a slot that does
 * not render it.
 *
 * `tags[2]` belongs to the tags slot, because this form edits tags as one comma-separated control
 * and that is the only place such a message can go. `links[0].label` does not belong to any scalar
 * slot -- it names an element's property, which the row renders itself -- and that is what the
 * trailing `]` check distinguishes.
 */
function claims(field: string, key: string): boolean {
  return key === field || (key.startsWith(`${field}[`) && key.endsWith(']'));
}

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
  /**
   * Every scalar field with a slot of its own, and the message that slot shows. Declared once and
   * used twice: the template renders these, and unclaimedErrors() subtracts exactly these keys. A
   * field therefore cannot be given a slot without also being taken out of the catch-all, which is
   * what keeps the catch-all honest as the form grows -- a hand-copied second list would not.
   */
  private readonly scalarSlots = {
    title: this.controlError(this.form.controls.title, 'title', TITLE_MESSAGES),
    description: this.controlError(
      this.form.controls.description,
      'description',
      DESCRIPTION_MESSAGES,
    ),
    tags: this.controlError(this.form.controls.tags, 'tags', TAGS_MESSAGES),
    // No client validators of its own -- this slot exists so a server 400 on startedOn has a home.
    startedOn: computed(() => this.serverError('startedOn')),
    completedOn: computed(() => this.periodError() ?? this.serverError('completedOn')),
  } satisfies Record<string, Signal<string | null>>;

  protected readonly titleError = this.scalarSlots.title;
  protected readonly descriptionError = this.scalarSlots.description;
  protected readonly tagsError = this.scalarSlots.tags;
  protected readonly startedOnError = this.scalarSlots.startedOn;
  protected readonly completedOnError = this.scalarSlots.completedOn;

  /**
   * Server field errors that no slot on this form claimed, shown together next to Save.
   *
   * Each round of this fix enumerated one more key and was caught out by the next: `links` and
   * `images` carry collection-level constraints (at most 10 and 20) whose violations are reported
   * under the bare name, and eleven clicks on "+ Add link" reaches that through the UI. Since
   * errorInterceptor deliberately stays quiet for any 400 that carries field errors, an unmatched
   * key means a save that was rejected and said nothing. This is the backstop that makes that
   * unreachable whatever the server decides to call a field.
   *
   * Claimed-ness comes from the same claims() rule the slots look up with and the same key builders
   * the rows render with, so this cannot drift out of step with what is on screen. The read of the
   * FormArrays is not reactive (their `controls` array is not a signal), which is sound only because
   * adding or removing a row also rewrites fieldErrors -- see forgetErrorsFor().
   */
  protected readonly unclaimedErrors = computed(() => {
    const rowKeys = new Set(this.rowFieldKeys());
    const scalarFields = Object.keys(this.scalarSlots);

    return Object.entries(this.fieldErrors())
      .filter(
        ([key]) => !rowKeys.has(key) && !scalarFields.some((field) => claims(field, key)),
      )
      .map(([field, message]) => ({ field, message }));
  });

  constructor() {
    this.loadProject();
  }

  /**
   * Re-runs the load after a failure, one at a time. Without the guard two quick clicks on "Try
   * again" leave two responses in flight whose order nothing controls, and the last one to land
   * writes its outcome over the other's -- a stale failure arriving after a success would put the
   * error state back over a form that has just been populated. Refusing the second start removes
   * the ordering question rather than trying to resolve it afterwards.
   *
   * The guard belongs here rather than in loadProject(), because loading() is already true when the
   * constructor calls that for the first time in edit mode.
   */
  protected retryLoad(): void {
    if (this.loading()) {
      return;
    }
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
      error: (problem: ApiProblem) => {
        // No notifications.error() here on purpose: errorInterceptor already toasts every non-field
        // error. It also logs out and redirects on a 401 -- but only while auth.isLoggedIn() is
        // still true, and that is a wall-clock check on the token's expiresAt. A token that simply
        // expired while this page sat open, one of the triggers this guard exists for, makes
        // isLoggedIn() false before the 401 ever arrives: nothing redirects, and every retry fails
        // identically. Say that instead of offering the admin the same dead end again. Leaving is
        // what recovers, because navigating re-runs authGuard. The interceptor's side of this is
        // issue #108, not this component's business.
        this.loadError.set(
          problem?.status === 401
            ? 'Your admin session has expired. Log in again to edit this project -- "Back to projects" above will take you there.'
            : 'Could not load this project. Nothing has been changed -- try again, or go back to the project list.',
        );
        this.loading.set(false);
      },
    });
  }

  protected addLink(): void {
    this.form.controls.links.push(this.buildLinkGroup());
    this.forgetErrorsFor('links');
  }

  protected removeLink(index: number): void {
    this.form.controls.links.removeAt(index);
    this.forgetErrorsFor('links');
  }

  protected addImage(): void {
    this.form.controls.images.push(this.buildImageControl());
    this.forgetErrorsFor('images');
  }

  protected removeImage(index: number): void {
    this.form.controls.images.removeAt(index);
    this.forgetErrorsFor('images');
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
        // Optional-chained like the load handler's status check: errorInterceptor normalizes every
        // HttpErrorResponse into an ApiProblem, but rethrows anything that is not one unchanged, so
        // the shape here is only almost guaranteed.
        const fieldErrors = problem?.fieldErrors ?? [];
        if (fieldErrors.length > 0) {
          this.fieldErrors.set(Object.fromEntries(fieldErrors.map((e) => [e.field, e.message])));
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
      return clientMessage ?? this.serverError(field);
    });
  }

  /**
   * The server's message for `field`, including the indexed key it uses for a violation inside a
   * collection: a tag name over the limit comes back as `tags[2]`, not `tags`. This form edits tags
   * as one comma-separated control, so there is no per-index slot to render that in -- without the
   * fallback the message matches nothing and is dropped on the floor, and errorInterceptor stays
   * quiet too (a 400 carrying fieldErrors takes none of its three branches). Silence on save is the
   * failure mode this whole component is being fixed for.
   *
   * The `]` check keeps this to leaf keys: `links[0].label` belongs to a row control, which looks
   * itself up by that exact key via rowError(), and must not be dragged onto another field.
   */
  private serverError(field: string): string | null {
    const errors = this.fieldErrors();
    if (errors[field]) {
      return errors[field];
    }
    const indexedKey = Object.keys(errors).find((key) => claims(field, key));
    return indexedKey ? errors[indexedKey] : null;
  }

  /** The key the API reports a link element's violation under. Built here, used by both callers. */
  protected linkFieldKey(index: number, part: 'label' | 'url'): string {
    return `links[${index}].${part}`;
  }

  /** Likewise for an image element, whose whole value is the constrained thing. */
  protected imageFieldKey(index: number): string {
    return `images[${index}]`;
  }

  /** Exactly the keys the rendered rows look themselves up by, from the same builders. */
  private rowFieldKeys(): string[] {
    return [
      ...this.form.controls.links.controls.flatMap((_, index) => [
        this.linkFieldKey(index, 'label'),
        this.linkFieldKey(index, 'url'),
      ]),
      ...this.form.controls.images.controls.map((_, index) => this.imageFieldKey(index)),
    ];
  }

  /**
   * Drop every server verdict about one collection, because the payload it judged no longer exists.
   * These keys are positional: remove link row 0 and the message the server sent about `links[1]`
   * now points at a different link, so it would either paint onto the wrong row or vanish along
   * with an index that no longer exists. A stale verdict is worse than no verdict -- the admin
   * cannot tell it apart from a fresh one -- and the next save produces a current set anyway.
   *
   * The bare collection key goes too: a size verdict about ten links is not about eleven.
   */
  private forgetErrorsFor(collection: 'links' | 'images'): void {
    const remaining = Object.entries(this.fieldErrors()).filter(
      ([key]) => key !== collection && !key.startsWith(`${collection}[`),
    );
    this.fieldErrors.set(Object.fromEntries(remaining));
  }

  /**
   * Same idea for a link or image row: this form's own message first, then the server's for the
   * same element. `field` is the indexed key the API reports collection violations under --
   * `links[0].label`, `links[0].url`, `images[0]` -- and it is not optional. The client side of a
   * row control only checks `required`, while the server also bounds lengths (a 51-character link
   * label, a 501-character URL), so without this lookup those rejections produce no inline message
   * and no toast, and Save silently does nothing.
   *
   * Rows are added and removed at runtime, so there is no stable computed to hang each one on; the
   * template calls this instead and it is re-evaluated on every check of the view. That is sound
   * for the reason a computed would not be: the checks are driven by the ng-touched/ng-invalid host
   * bindings Angular puts on every formControlName element, which read those same control signals.
   */
  protected rowError(control: AbstractControl, label: string, field: string): string | null {
    // The client message waits for the admin to reach the control -- a just-added row is empty by
    // definition and should not open pre-scolded. A server message has no such gate: it is about a
    // value that was actually submitted, whether or not this control was ever focused.
    const clientMessage =
      (control.touched || control.dirty) && control.hasError('required')
        ? `${label} is required`
        : null;
    return clientMessage ?? this.fieldErrors()[field] ?? null;
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
