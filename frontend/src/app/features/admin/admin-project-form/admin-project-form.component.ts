import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defer,
  distinctUntilChanged,
  finalize,
  map,
  merge,
  switchMap,
  tap,
  throwIfEmpty,
} from 'rxjs';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { ProjectWriteRequest } from '../../../core/api/model/projectWriteRequest';
import { ApiProblem } from '../../../core/http/api-problem';
import {
  clientErrorSignal,
  groupFieldErrors,
  joinMessages,
} from '../../../shared/form-errors/form-errors';
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
 * What a destination says when the server named a field but gave nothing to say about it.
 *
 * Deliberately not shared with the contact form even though the mechanism around it is: this names
 * the server and assumes a reader who knows what `links[0].label` means. That is right here and
 * wrong on a public page -- and it was shared once, which is how it came to be shown to visitors.
 */
const UNEXPLAINED_REJECTION = 'Rejected by the server, which gave no reason.';

/**
 * Whether a server field key belongs to the slot for `field`. One rule, used twice: serverError()
 * collects a slot's messages with it, and unclaimedErrors() subtracts with it -- so a key can never
 * be both rendered inline and repeated in the catch-all, and never subtracted by a slot that does
 * not go on to render it.
 *
 * That second half holds only because serverError() renders *every* key it claims. Claiming all and
 * rendering the first is not a smaller version of the same thing: it is the silent drop again, one
 * level in.
 *
 * `tags[2]` belongs to the tags slot, because this form edits tags as one comma-separated control
 * and that is the only place such a message can go. `links[0].label` does not belong to any scalar
 * slot -- it names an element's property, which the row renders itself -- and that is what the
 * trailing `]` check distinguishes.
 */
function claims(field: string, key: string): boolean {
  return key === field || (key.startsWith(`${field}[`) && key.endsWith(']'));
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

  /**
   * Which project this form is editing, or null on the "new project" route -- from route.paramMap,
   * not route.snapshot.
   *
   * Angular's default RouteReuseStrategy reuses this component when a navigation changes only the
   * params, so a field initialiser reading the snapshot would keep the first id forever:
   * /admin/projects/A/edit -> /admin/projects/B/edit would leave A's data in the fields and PUT it
   * back to A's URL while the address bar said B. ProjectDetailComponent was fixed for the same
   * shape.
   *
   * Not reachable through the UI as it stands -- every link to an edit route comes from the
   * projects list, which unmounts this component on the way -- so this is a landmine being taken
   * out rather than a bug being fixed. It goes off the day someone adds a prev/next link, an "edit
   * another" after saving, or a jump-to-project search.
   */
  protected readonly projectId = signal<string | null>(null);
  protected readonly isEditMode = computed(() => this.projectId() !== null);
  /**
   * False rather than "true in edit mode": the constructor's subscription sets it, and paramMap
   * emits synchronously on subscribe (it is a BehaviorSubject behind a map), so it is already right
   * by the time this renders.
   */
  protected readonly loading = signal(false);
  protected readonly submitting = signal(false);
  /**
   * Every message the server sent, keyed by the field it named -- a list per key, because the API
   * reports one entry per violation and does not dedup. `links[0].label` can arrive twice at once
   * (@NotBlank and @Size, from a label of 51 spaces, which this form's `required` validator lets
   * through), and a map of one message per key would keep the last and drop the first before any
   * slot or catch-all ran. See groupFieldErrors(), which is what builds this.
   */
  protected readonly fieldErrors = signal<Record<string, string[]>>({});
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
    /**
     * Whether this project is on the public site.
     *
     * Default true, which is the create route's answer and matches what POST does with the field
     * omitted (see ProjectWriteRequest in docs/openapi.yaml) -- a project typed into the CMS by
     * hand is meant to be live. An edit overwrites it from the loaded project before the form is
     * ever shown, and form.reset() puts this default back between loads because the group is
     * nonNullable.
     */
    published: [true],
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
   * the rows render with, so this cannot drift out of step with what is on screen.
   *
   * The part worth knowing, since none of it is visible at the call site: rowFieldKeys() reads the
   * FormArrays, whose `controls` array is not a signal, so adding or removing a row invalidates
   * nothing here. What saves it is that both of those paths go through forgetErrorsFor(), whose
   * fieldErrors.set() notifies and makes this recompute against the row set that now exists.
   *
   * That is load-bearing when the purge removes keys. When it removes none, it is not: nothing
   * filtered means no key of that collection was present, and the only row keys whose membership
   * moved belong to that collection, so no key here can change its verdict and the cached answer is
   * already the right one. Scalar claims never depend on the rows at all. Skipping the set() in
   * that case, or giving fieldErrors an `equal:` option, is safe as this stands.
   *
   * The hazard to actually watch for is a new path that changes a row count without purging -- a
   * duplicate-row button, say. That would leave this describing a row set that is gone, and no
   * existing test would fail.
   *
   * Loading a project is the other FormArray mutation, and it is safe by construction rather than
   * by reachability: startLoad() calls resetForm() before every load, which empties both arrays and
   * sets fieldErrors, so the map and the rows move together through a fieldErrors.set() exactly as
   * they do here.
   */
  protected readonly unclaimedErrors = computed(() => {
    const rowKeys = new Set(this.rowFieldKeys());
    const scalarFields = Object.keys(this.scalarSlots);

    return Object.entries(this.fieldErrors())
      .filter(
        ([key]) => !rowKeys.has(key) && !scalarFields.some((field) => claims(field, key)),
      )
      // One entry per *key*, with that key's messages joined -- not one entry per violation. Two
      // complaints about `links` are one line in this list, the way two complaints about tags are
      // one message in the tags slot: the key is what the reader is being pointed at, and repeating
      // it would read as two separate problems.
      //
      // Through joinMessages() for the same reason the field slots are: a key that arrives with a
      // blank message would otherwise render as a bare field name and nothing else, which is the
      // rejection-with-no-content case landing in the one destination that was still missing it.
      .map(([field, messages]) => ({ field, message: joinMessages(messages, UNEXPLAINED_REJECTION) }));
  });

  /** Retry's way into the load pipeline below -- see retryLoad(). */
  private readonly reload$ = new Subject<string | null>();

  constructor() {
    // A server verdict describes the value that produced it, so it stops being about this form the
    // moment that value changes: type a different title and "A project with this title already
    // exists" is no longer a statement about anything on screen. Scalars had no way to say that --
    // forgetErrorsFor() only ran when a collection's rows moved -- so the stale sentence sat there
    // until the next Save. Worse than it looks, because the client message hides it while the
    // control is empty and hands it back the moment the field is refilled.
    //
    // This is that same rule, applied to the control that changed rather than to the collection
    // that moved, and it is the same method doing the purging. It covers the tags slot's indexed
    // keys as well: `tags[2]` names an element of the list this one control holds, so editing that
    // control is what makes it stale.
    //
    // Scoped to the field that changed rather than "discard everything on any edit". The wider rule
    // is easier to state, but it would drop a rejection about a field the admin has not dealt with
    // yet as a side effect of them fixing a different one -- and forgetErrorsFor() is already scoped
    // for exactly that reason. Pressing Save is what clears the lot (see submit()), because that is
    // the point at which the whole payload the verdicts were about is replaced.
    //
    // Driven off Object.keys(this.scalarSlots) rather than a second hand-written list of control
    // names, for the reason unclaimedErrors() subtracts from the same object: a slot added later
    // without a purge would be found by whoever hits the stale message, not by this file. The keys
    // are control names by construction, and a mismatch would silently leave one field unpurged, so
    // it fails loudly instead.
    for (const field of Object.keys(this.scalarSlots)) {
      const control = this.form.get(field);
      if (!control) {
        throw new Error(`admin project form: message slot "${field}" names no control`);
      }
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.forgetErrorsFor(field));
    }

    // One pipeline owns every load, whichever asked for it: the route saying which project this
    // is, and "Try again" asking for the same one over. switchMap is what makes an id change safe
    // -- it drops the request for the previous project, so its response can never land in the form
    // now showing a different one -- and takeUntilDestroyed covers navigating off the route
    // entirely. Same pair, for the same reasons, as ProjectDetailComponent.
    merge(
      // distinctUntilChanged, which the read-only detail page does not need: a reload here throws
      // away whatever the admin has typed, so an id re-emitted unchanged must not restart one. It
      // sits inside this branch rather than after the merge, so it cannot swallow a retry of the id
      // already loaded -- which is the whole point of the other branch.
      this.route.paramMap.pipe(
        map((params) => params.get('id')),
        distinctUntilChanged(),
      ),
      this.reload$,
    )
      .pipe(
        switchMap((id) => this.startLoad(id)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /**
   * Re-runs the load after a failure, one at a time. Two quick clicks on "Try again" otherwise
   * leave two responses in flight whose order nothing controls, and the last one to land writes its
   * outcome over the other's -- a stale failure arriving after a success would put the error state
   * back over a form that has just been populated.
   *
   * The pipeline's switchMap would now cancel the first load rather than race it, so this no longer
   * carries that on its own. What it still does is refuse to throw away a load that is already
   * running and start the identical one again, which is what the admin means by clicking twice.
   *
   * The guard belongs here rather than in startLoad(), which the constructor reaches with loading()
   * about to be set for the first time.
   */
  protected retryLoad(): void {
    if (this.loading()) {
      return;
    }
    this.reload$.next(this.projectId());
  }

  /**
   * Empties the form for whatever is about to go into it, and returns the request that fetches it
   * -- or EMPTY on the "new project" route, where there is nothing to fetch.
   *
   * Returned rather than subscribed to, so the constructor's switchMap and takeUntilDestroyed own
   * its lifetime. That is what stops project A's response arriving into project B's form.
   *
   * The defer() is load-bearing, not stylistic: switchMap tears the previous load down before it
   * subscribes to this one, and that teardown runs the finalize() below. Anything here that writes
   * loading() therefore has to run at *subscribe* time -- as plain statements in this method body,
   * or in a tap() ahead of switchMap, it is a coin toss on operator internals whether the new
   * load's loading() survives the old load's finalize.
   */
  private startLoad(id: string | null): Observable<unknown> {
    return defer(() => {
      this.projectId.set(id);
      this.resetForm();

      if (id === null) {
        // The "new project" route. A blank form is the finished state, not a loading one.
        this.loading.set(false);
        return EMPTY;
      }

      this.loading.set(true);

      // finalize(), not a loading.set(false) in each handler: a stream that completed without
      // emitting or erroring would leave the page stuck on "Loading..." with no way back.
      // HttpClient always does one or the other, so this closes a shape rather than a reachable
      // path -- the same one as submit()'s, where being stuck also disables every row button.
      //
      // throwIfEmpty() ahead of it, because clearing the flag is not on its own the safe end of
      // that path: loading false with no project loaded and no error renders the *form*, empty, and
      // an empty edit form is a PUT away from blanking the record -- which is the whole reason a
      // failed load has a state of its own. A completion that carried no project has not loaded the
      // project, so it goes the way a failure goes: into the catchError below, where reading
      // .status off an EmptyError gives undefined and produces the generic wording.
      // getAnyProject (GET /admin/projects/{id}), not getProject: the public read filters to
      // published and answers 404 for a draft, identically to an id that names nothing -- so on the
      // public operation this form could not open the very projects it exists to publish, and would
      // report them as missing. The admin read is the only one that returns a draft.
      return this.projectsApi.getAnyProject({ id }).pipe(
        throwIfEmpty(),
        tap((project) => {
          this.form.patchValue({
            title: project.title,
            description: project.description,
            tags: project.tags.map((t) => t.name).join(', '),
            // Round-tripping these matters more than it looks: PUT takes the same body as POST, so
            // a field left out of the payload clears the stored value rather than preserving it.
            startedOn: project.startedOn ?? '',
            completedOn: project.completedOn ?? '',
            // The round trip that matters most. `published` is required on every Project the API
            // returns, so this is the project's real state rather than a guess, and submit() sends
            // back whatever is in this box -- meaning an edit that never touches the checkbox saves
            // the project exactly as publication found it.
            published: project.published,
          });
          // The arrays are empty here because resetForm() ran above, for every load rather than
          // only for a second one -- push without a clear gives a successful reload two of every
          // row, and the id-change case has to lose the *previous project's* rows even when the
          // load that follows never succeeds.
          project.links.forEach((link) => this.form.controls.links.push(this.buildLinkGroup(link.label, link.url)));
          project.images.forEach((image) =>
            this.form.controls.images.push(this.buildImageControl(image)),
          );
        }),
        catchError((problem: ApiProblem) => {
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
          // EMPTY, not a rethrow: the failure is fully handled here, and letting it out would kill
          // the subscription in the constructor, so no later id or retry would ever load again.
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      );
    });
  }

  /**
   * Back to a blank form, for whatever is about to be loaded into it.
   *
   * Every line here is the id-change case: form.reset() does not touch the FormArrays, so the rows
   * are the previous project's links and images until they are cleared, and fieldErrors holds
   * verdicts about the previous project's payload -- positional row keys included. Leaving either
   * behind is the same stale-state defect forgetErrorsFor() exists to prevent, one project over.
   *
   * submitting() is deliberately not reset: it belongs to a request that is still running, and
   * clearing it here would let a second save start while the first is in flight.
   */
  private resetForm(): void {
    this.form.reset();
    this.form.controls.links.clear();
    this.form.controls.images.clear();
    this.fieldErrors.set({});
    this.loadError.set(null);
  }

  /**
   * Row structure is frozen while a save is in flight, and the buttons are disabled to match.
   *
   * forgetErrorsFor() drops stale verdicts at the moment the rows change, which cannot help against
   * a change made *during* a request: the 400's indices are computed against the payload already
   * sent, and they arrive after the purge has run, so they land unfiltered on a row set that has
   * moved underneath them. Removing row 0 mid-flight and then receiving `links[0].url` flags the
   * surviving row with the removed one's verdict -- the exact defect the purge exists to prevent,
   * through a window it cannot see.
   *
   * Gating rather than stamping each submit with a generation: the response is only meaningful
   * against the payload that produced it, and Save is already unavailable for the same reason.
   * A disabled button is UX, so each handler refuses as well -- the guard is the guarantee.
   */
  protected addLink(): void {
    if (this.submitting()) {
      return;
    }
    this.form.controls.links.push(this.buildLinkGroup());
    this.forgetErrorsFor('links');
  }

  protected removeLink(index: number): void {
    if (this.submitting()) {
      return;
    }
    this.form.controls.links.removeAt(index);
    this.forgetErrorsFor('links');
  }

  protected addImage(): void {
    if (this.submitting()) {
      return;
    }
    this.form.controls.images.push(this.buildImageControl());
    this.forgetErrorsFor('images');
  }

  protected removeImage(index: number): void {
    if (this.submitting()) {
      return;
    }
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

    // Before the guard below, not after it. A server verdict describes the payload that produced
    // it, and pressing Save says that payload is being replaced -- so from here on it is about a
    // send that is over, whether or not this attempt reaches the network. Left until after the
    // return, a client-blocked resubmit leaves the old rejection on screen beside the new client
    // message, and the two read as one response.
    //
    // It clears verdicts that are arguably still true: the form can be invalid for a *different*
    // field than the server complained about, and a title the admin has not touched since is still
    // whatever the server called it. Dropped anyway, on the same grounds forgetErrorsFor() drops
    // accurate-but-positional row verdicts -- a stale verdict cannot be told apart from a fresh
    // one, and the next save re-issues it against the payload that actually exists. Where the
    // invalid field *is* the one the server named, nothing visible is lost at all: the client
    // message already takes that slot.
    //
    // Safe against the row purge rather than in tension with it: this is strictly stronger (it
    // removes every key, indexed ones included) and it goes through the same fieldErrors.set(),
    // which is what notifies unclaimedErrors(). The in-flight case is a no-op -- fieldErrors is
    // emptied when a request starts and only the response handler refills it -- so a Save pressed
    // during a save still cannot disturb the request that is running.
    this.fieldErrors.set({});

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
      // Sent explicitly, on every save, rather than left out.
      //
      // The contract reads an omitted `published` as "leave it as it is" -- deliberately, so that a
      // client written before Phase 7a cannot unpublish a live project by saying nothing. That is a
      // safety net for clients with no opinion, and this form has one: the checkbox is on screen
      // showing the state that is about to be saved. Omitting it would make that checkbox a
      // decoration the admin could tick to no effect, which is a worse lie than the one the
      // exception is guarding against.
      //
      // The direction the exception exists to prevent is closed here by the control's default and
      // by where it gets its value: true on the create route, and the loaded project's own value on
      // the edit route, patched before the form is rendered. There is no path on which this sends
      // `false` because a checkbox happened to start out unticked -- which would be issue #92's
      // blank-form PUT wearing a different hat.
      //
      // `repoFullName` is the other omitted-means-unchanged field and is deliberately *not* sent:
      // this form does not edit it, and omitting it is what preserves an auto-created draft's link
      // to the repository that made it.
      published: raw.published,
    };

    this.submitting.set(true);

    const id = this.projectId();
    const request$ = id
      ? this.projectsApi.updateProject({ id, projectWriteRequest: writeRequest })
      : this.projectsApi.createProject({ projectWriteRequest: writeRequest });

    request$
      // finalize(), not a set() in each handler: a stream that completed without emitting or
      // erroring would leave submitting() stuck true, and since the row structure was frozen to it
      // that disables Save, every "+ Add" and every "Remove" for good, with nothing said about why.
      // HttpClient always emits or errors, so this closes a shape rather than a reachable path.
      //
      // It does move where the flag is released: finalize runs *after* whichever handler ended the
      // stream, so submitting() now stays true across the error handler's fieldErrors.set() instead
      // of being cleared just before it. Nothing reads it in between -- the guards that do
      // (submit(), and the four row handlers) run from user events, and holding the freeze until
      // the verdicts are on screen is the ordering those guards want anyway.
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.router.navigateByUrl('/admin/projects');
        },
        error: (problem: ApiProblem) => {
          // Optional-chained like the load handler's status check, and identical to the contact
          // form's line: errorInterceptor normalizes every HttpErrorResponse into an ApiProblem but
          // rethrows anything that is not one unchanged, so the shape here is only almost guaranteed.
          // `?? []` is the half that has a reachable case -- .fieldErrors off a bare Error is
          // undefined, and .length off that throws inside the subscriber, where RxJS reports it out
          // of band and the form fails in silence. The `?.` has no reachable case and is not pretending
          // to: it is the same defensive read at all three sites in both forms, which is worth more
          // than deleting one of them.
          const fieldErrors = problem?.fieldErrors ?? [];
          if (fieldErrors.length > 0) {
            this.fieldErrors.set(groupFieldErrors(fieldErrors));
          }
          // Non-field errors are surfaced globally by errorInterceptor.
        },
      });
  }

  /**
   * One message slot per field, on the completedOnError() model: this form's own validator message
   * while the control is in violation, otherwise whatever the server said about the same field.
   *
   * The client half -- including the touched/dirty gate and the events() subscription that keeps it
   * reactive at all -- lives in shared/form-errors, because the contact form needs exactly the same
   * thing and the reactivity requirement is invisible at the call site. The server half stays here:
   * serverError()'s claims() rule is this form's, and is paired with unclaimedErrors()' subtraction.
   */
  private controlError(
    control: AbstractControl,
    field: string,
    messages: Record<string, string>,
  ): Signal<string | null> {
    const clientMessage = clientErrorSignal(control, messages);
    return computed(() => clientMessage() ?? this.serverError(field));
  }

  /**
   * Everything the server said about `field`, including the indexed keys it uses for violations
   * inside a collection: a tag name over the limit comes back as `tags[2]`, not `tags`. This form
   * edits tags as one comma-separated control, so a per-element message has no other slot to go to.
   *
   * Every match, not the first, and every message under each match. The API reports one entry per
   * violation with no dedup, so two over-long tags arrive together as `tags[0]` and `tags[1]`, and
   * unclaimedErrors() subtracts both -- it shares claims() with this. One key can also carry more
   * than one message, which is why fieldErrors holds a list per key. Returning only the first of
   * either would leave the rest rendered nowhere at all, which is the same silent drop this
   * component keeps being fixed for, one level further in. Two complaints about tags also belong in
   * the tags slot together rather than split across two regions of the page.
   *
   * The `]` check inside claims() keeps this to leaf keys: `links[0].label` belongs to a row
   * control, which looks itself up by that exact key via rowError().
   */
  private serverError(field: string): string | null {
    const errors = this.fieldErrors();
    const claimedKeys = Object.keys(errors).filter((key) => claims(field, key));
    // Joined rather than deduped: two identical messages mean two violations, and this form has one
    // control for all of them, so the repetition is the only surviving trace of the count. Both
    // axes reach here -- several keys claimed by one slot (`tags[0]` and `tags[1]`), and several
    // messages under one key (a link label that is blank *and* too long).
    //
    // The presence check is on the claimed *keys*, which is the same thing unclaimedErrors()
    // subtracts by: whether this slot renders and whether the catch-all skips have to be one
    // decision, or a key is claimed by a slot that then shows nothing. Counting the flattened
    // messages instead would answer identically for every input groupFieldErrors() can produce (a
    // key it holds has at least one entry, blank or not), so this is the right question to ask
    // rather than a guard earning its keep -- and joinMessages() still answers what to show, not
    // whether to show anything.
    return claimedKeys.length > 0
      ? joinMessages(
          claimedKeys.flatMap((key) => errors[key]),
          UNEXPLAINED_REJECTION,
        )
      : null;
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
   * Drop every server verdict about one field, because the value it judged no longer exists.
   *
   * Two callers, one rule. A collection whose rows moved: these keys are positional, so remove link
   * row 0 and the message the server sent about `links[1]` now points at a different link -- it
   * would either paint onto the wrong row or vanish along with an index that no longer exists. And
   * a scalar control whose value the admin has edited: "A project with this title already exists"
   * describes a title that is no longer in the box. Either way a stale verdict is worse than no
   * verdict -- the admin cannot tell it apart from a fresh one -- and the next save produces a
   * current set anyway.
   *
   * The bare key goes with the indexed ones: a size verdict about ten links is not about eleven,
   * and `tags[2]` names an element of the list the tags control holds. Scoped to the field that
   * moved, though -- a title rejection the admin has not dealt with yet is still true while they
   * are fixing the links, and clearing it would hide work they still owe.
   *
   * The set() reaches beyond this method: it is what notifies unclaimedErrors(), which reads the
   * FormArrays without being reactive in them, so a purge that removes keys is also what tells the
   * catch-all the rows have moved. A purge that removes nothing has nothing to tell it -- see the
   * reasoning on unclaimedErrors() before assuming either half of that is free to change.
   */
  private forgetErrorsFor(field: string): void {
    const remaining = Object.entries(this.fieldErrors()).filter(
      ([key]) => key !== field && !key.startsWith(`${field}[`),
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
    // Same blank-message handling as the scalar slots: reading errors[field] straight out would let
    // a key that exists with an empty message render as nothing while unclaimedErrors() has already
    // counted it as shown. The whole list goes to the join, not its first element: this is the key
    // that actually arrives twice today, since a link label of 51 spaces violates @NotBlank and
    // @Size at once and both come back as `links[0].label`.
    //
    // Object.hasOwn, matching the contact form's serverError(): `field in errors` would also answer
    // true for a name that only exists on Object.prototype, reporting a rejection the server never
    // sent. Unreachable from here -- `field` is a row key this component builds -- but this is the
    // right primitive for "does this map hold this key", and the two forms had no reason to disagree
    // about which one they use.
    const errors = this.fieldErrors();
    const serverMessage = Object.hasOwn(errors, field)
      ? joinMessages(errors[field], UNEXPLAINED_REJECTION)
      : null;
    return clientMessage ?? serverMessage;
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
