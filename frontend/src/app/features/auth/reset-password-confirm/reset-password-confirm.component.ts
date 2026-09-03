import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService as AuthApiService } from '../../../core/api/api/auth.service';
import { ApiProblem } from '../../../core/http/api-problem';
import {
  clientErrorSignal,
  groupFieldErrors,
  joinMessages,
} from '../../../shared/form-errors/form-errors';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const newPassword = control.get('newPassword')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return newPassword === confirmPassword ? null : { passwordMismatch: true };
}

/**
 * The key both password-reset endpoints use to reject the token itself. `POST
 * /auth/password-reset/validate` and `POST /auth/password-reset` are documented in
 * docs/openapi.yaml as carrying the identical rejection shape, so one constant covers both.
 */
const TOKEN_FIELD = 'token';

const NEW_PASSWORD_MESSAGES: Record<string, string> = {
  required: 'Enter a new password',
  minlength: 'Password must be at least 8 characters',
};

/** What the newPassword slot says when the server rejected it and sent no reason with it. */
const UNEXPLAINED_FIELD_REJECTION =
  'This was not accepted, but the site did not say why — try a different password.';

/**
 * What the page is able to offer, which is not the same question as what the form contains. Each
 * value is reached from exactly one place, so the template switches on this instead of assembling
 * the state out of booleans that can contradict each other:
 *
 *   checking     -- the load-time validate call is in flight. Deliberately the initial value: a
 *                   flash of the form followed by a dead-link message is barely better than the
 *                   bug being fixed here (#187), so the form is never the first thing on screen.
 *   usable       -- validate answered 204. The form is shown.
 *   dead         -- validate answered 400. Used, expired, never-issued and malformed are
 *                   deliberately indistinguishable on the wire, so this is all the page can say.
 *   rejected     -- the *submit* was refused with a `token` field error. Distinct from `dead`
 *                   because the reader has just typed a password and needs telling it was not
 *                   changed. A token can expire between load and submit, which is why #185 still
 *                   matters after #187.
 *   rateLimited  -- validate answered 429. Not a dead link. Shows the form.
 *   unavailable  -- validate failed some other way (5xx, network). Also not a dead link. Shows
 *                   the form.
 *
 * The last two fail *open* on purpose. The validate limit is per requester IP and says nothing
 * about this token, so hiding the form there would strand someone holding a perfectly good link
 * behind a shared NAT with no way to reset their password at all. The submit path is
 * authoritative and now renders its own rejection, so proceeding costs a wasted form fill in the
 * worst case -- weighed against a total denial the other way round.
 */
type LinkState = 'checking' | 'usable' | 'dead' | 'rejected' | 'rateLimited' | 'unavailable';

@Component({
  selector: 'app-reset-password-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password-confirm.component.html',
  styleUrl: './reset-password-confirm.component.scss',
})
export class ResetPasswordConfirmComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  /**
   * Trimmed to nothing counts as absent. A whitespace-only `?token=` would otherwise be sent to
   * validate, come back 400 keyed `token` ("must not be blank"), and render as "this link is
   * dead" -- true enough, but the more precise message is the one that tells someone their mail
   * client mangled the URL rather than that their link expired.
   */
  protected readonly token = this.route.snapshot.queryParamMap.get('token')?.trim() || null;

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly linkState = signal<LinkState>('checking');

  /** Every message the server sent about the submit, keyed by field -- see groupFieldErrors(). */
  private readonly fieldErrors = signal<Record<string, string[]>>({});

  protected readonly form = this.formBuilder.nonNullable.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  /**
   * The fields with a message slot of their own on this page, declared once and used twice: the
   * template renders them, and hasUnclaimedRejection() subtracts exactly these keys.
   *
   * `newPassword` has a slot beside its input. `token` has the whole dead-link panel, which is a
   * destination in the sense that matters -- the rejection is rendered where the reader will see
   * it, in words they can act on.
   *
   * `confirmPassword` is deliberately absent. It exists only on the client
   * (PasswordResetConfirmBody in docs/openapi.yaml carries `token` and `newPassword`), so the
   * server naming it would mean the contract had moved underneath this form -- which is exactly
   * the case the catch-all is for.
   */
  private readonly serverSlots: Record<string, true> = {
    [TOKEN_FIELD]: true,
    newPassword: true,
  };

  protected readonly newPasswordError: Signal<string | null>;

  /**
   * Whether the server rejected the reset over something no slot above claims.
   *
   * This is #185 one level up from the specific bug. errorInterceptor stays silent for any 400
   * carrying field errors, on the assumption that a field error renders inline -- so an unslotted
   * key is a rejection that reaches nothing at all. `token` was that case in production: no
   * `token` input exists, because the token comes from the query string, so pressing the button
   * appeared to do nothing whatever. The panel above claims `token` now; this claims whatever the
   * backend renames or adds next.
   *
   * Object.keys().includes() rather than `key in this.serverSlots`, for the reason contact-form
   * records: the key comes off the wire, and `'toString' in serverSlots` is true. That would
   * treat a rejection as claimed by a slot that will never render it -- the silent drop again, by
   * way of the prototype chain.
   */
  protected readonly hasUnclaimedRejection = computed(() => {
    const slotted = Object.keys(this.serverSlots);
    return Object.keys(this.fieldErrors()).some((key) => !slotted.includes(key));
  });

  /** The states that still have something worth filling in. */
  protected readonly showsForm = computed(() => {
    const state = this.linkState();
    return state === 'usable' || state === 'rateLimited' || state === 'unavailable';
  });

  constructor() {
    // clientErrorSignal needs an injection context (it calls toSignal). Paired with serverError()
    // here rather than in a field initializer only because it reads a field declared above it.
    const clientMessage = clientErrorSignal(this.form.controls.newPassword, NEW_PASSWORD_MESSAGES);
    this.newPasswordError = computed(() => clientMessage() ?? this.serverError('newPassword'));

    this.validateToken();
  }

  /**
   * Ask the backend whether this link is still usable before offering a form for it (#187).
   *
   * A read, never a consume -- the endpoint is documented as leaving `used_at` untouched, which is
   * what makes it safe to call on every page load. Any 400 means dead: used, expired,
   * never-issued and blank are the same response by design, so there is nothing finer to branch
   * on, and inventing a distinction the wire does not carry would be guessing at the reader.
   */
  private validateToken(): void {
    const token = this.token;
    if (!token) {
      return;
    }

    this.authApi
      .validatePasswordResetToken({ passwordResetValidateBody: { token } })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: () => this.linkState.set('usable'),
        error: (problem: ApiProblem) => this.linkState.set(stateForValidateFailure(problem)),
      });
  }

  protected submit(): void {
    // Cleared before the guard below rather than after it, as on the contact form: pressing the
    // button says the previous verdict is about a submission that is over, so a client-blocked
    // resend must not leave the old server message on screen beside the new client one.
    this.fieldErrors.set({});

    const token = this.token;
    if (!token || this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);

    this.authApi
      .confirmPasswordReset({
        passwordResetConfirmBody: { token, newPassword: this.form.getRawValue().newPassword },
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.submitted.set(true);
        },
        // The comment that used to sit here read "Surfaced globally by errorInterceptor
        // (invalid/expired token -> 400, no field errors)". Both halves were wrong: the response
        // *does* carry field errors, and it is precisely because it does that the interceptor
        // stays quiet. That comment was the whole of bug #185.
        error: (problem: ApiProblem) => {
          this.submitting.set(false);

          // `?? []` for the reason contact-form's handler records: errorInterceptor normalizes
          // every HttpErrorResponse into an ApiProblem but rethrows anything else unchanged, so
          // .fieldErrors is only almost guaranteed. Reading .length off undefined throws from
          // inside the subscriber, where RxJS reports it out of band -- silence, again.
          const fieldErrors = problem?.fieldErrors ?? [];
          if (fieldErrors.length === 0) {
            // Nothing keyed at all, so errorInterceptor has already toasted it.
            return;
          }

          const grouped = groupFieldErrors(fieldErrors);
          this.fieldErrors.set(grouped);

          // A token rejection outranks everything else in the same response: whatever the password
          // was, it was not changed, and the reader needs a new link rather than a better password.
          if (Object.hasOwn(grouped, TOKEN_FIELD)) {
            this.linkState.set('rejected');
          }
        },
      });
  }

  /**
   * Everything the server said about `field`. Routed through joinMessages() so a key arriving with
   * a blank message still renders something: it has already been subtracted from
   * hasUnclaimedRejection() as claimed, so rendering nothing would drop it into the nowhere the
   * catch-all exists to prevent. A key can also carry more than one message -- the API reports one
   * entry per violation without deduping.
   */
  private serverError(field: string): string | null {
    const errors = this.fieldErrors();
    return Object.hasOwn(errors, field)
      ? joinMessages(errors[field], UNEXPLAINED_FIELD_REJECTION)
      : null;
  }
}

/**
 * `problem?.` rather than `problem.`: the value here is whatever errorInterceptor rethrew, and it
 * only promises to be an ApiProblem for an HttpErrorResponse. A throw from inside the subscriber
 * would leave the page stuck on "Checking…" forever with nothing on screen to say why -- the worst
 * of the available failures, since it is indistinguishable from a slow network.
 */
function stateForValidateFailure(problem: ApiProblem): LinkState {
  if (problem?.rateLimited) {
    return 'rateLimited';
  }
  return problem?.status === 400 ? 'dead' : 'unavailable';
}
