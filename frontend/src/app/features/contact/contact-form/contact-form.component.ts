import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../../core/api/api/contact.service';
import { ApiProblem } from '../../../core/http/api-problem';
import {
  clientErrorSignal,
  groupFieldErrors,
  joinMessages,
} from '../../../shared/form-errors/form-errors';

/**
 * Wording for this form's own validators, keyed by the error key Validators.* produces. The limits
 * repeat the ones on the controls below, which in turn come from ContactMessageWriteRequest in
 * docs/openapi.yaml -- change one and change all three.
 *
 * Worded for a visitor rather than for the admin: nobody arriving here has been told what the
 * constraints are, and the email message names the shape it wants instead of just calling the
 * value wrong.
 */
const NAME_MESSAGES: Record<string, string> = {
  required: 'Name is required',
  maxlength: 'Name cannot exceed 200 characters',
};
const EMAIL_MESSAGES: Record<string, string> = {
  required: 'Email is required',
  email: 'Enter a valid email address, like name@example.com',
  maxlength: 'Email cannot exceed 320 characters',
};
const MESSAGE_MESSAGES: Record<string, string> = {
  required: 'Message is required',
  maxlength: 'Message cannot exceed 5000 characters',
};

/**
 * What a field slot says when the server rejected that field and sent no reason with it. Worded
 * for the person actually reading it: a visitor can do nothing with "rejected by the server",
 * which is the admin form's wording -- correct there, and a leaked implementation detail here.
 * Same register as the validator messages above: what happened, then what to do about it.
 */
const UNEXPLAINED_FIELD_REJECTION =
  'This was not accepted, but the site did not say why — try changing it.';

@Component({
  selector: 'app-contact-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './contact-form.component.html',
  styleUrl: './contact-form.component.scss',
})
export class ContactFormComponent {
  private readonly contactApi = inject(ContactService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  /**
   * Every message the server sent, keyed by the field it named -- a list per key, because the API
   * reports one entry per violation and does not dedup, so one field can be named twice in one
   * response. Keeping a single message per key kept the last and discarded the first before any
   * slot or the catch-all ran. Not reachable through this form today, since each control mirrors
   * the server's @Size with a client maxLength and is blocked before the round trip -- but that is
   * a property of these three validators, not a promise about what the server may send, and the
   * admin form reaches it. See groupFieldErrors().
   */
  protected readonly fieldErrors = signal<Record<string, string[]>>({});

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    message: ['', [Validators.required, Validators.maxLength(5000)]],
  });

  /**
   * Every field with a slot of its own, and the message that slot shows. Declared once and used
   * twice: the template renders these, and unclaimedErrors() subtracts exactly these keys. A field
   * therefore cannot be given a slot without also being taken out of the catch-all, which is what
   * keeps the catch-all honest as the form grows -- a hand-copied second list would not.
   *
   * The matching rule is plain equality in both directions, because this form has no collections:
   * every control is scalar, so an indexed key like `message[0]` names nothing on screen and
   * belongs in the catch-all rather than in a slot. (The admin project form needs a looser rule
   * for exactly the opposite reason -- it edits tags as one control.)
   */
  private readonly scalarSlots = {
    name: this.controlError(this.form.controls.name, 'name', NAME_MESSAGES),
    email: this.controlError(this.form.controls.email, 'email', EMAIL_MESSAGES),
    message: this.controlError(this.form.controls.message, 'message', MESSAGE_MESSAGES),
  } satisfies Record<string, Signal<string | null>>;

  protected readonly nameError = this.scalarSlots.name;
  protected readonly emailError = this.scalarSlots.email;
  protected readonly messageError = this.scalarSlots.message;

  /**
   * Whether the server rejected this message over something no slot above claims.
   *
   * errorInterceptor deliberately stays quiet for any 400 that carries field errors, so a key with
   * no slot is a rejection that said nothing at all -- and the person it happened to is a visitor
   * who has no other way to find out. The contract is fixed today (name, email, message) but the
   * backend decides what to call a field, and a rename ships on its side alone.
   *
   * A boolean, not the entries: neither the key nor the server's text reaches the template. The
   * admin form renders both, because `links[0].label` means something to the admin and the message
   * beside it is a Bean Validation default aimed at a developer. To a visitor who has just lost
   * what they wrote, "honeypot must not be blank" reads as a leaked stack trace, and stripping the
   * key off it leaves "must not be blank" about a field they cannot see -- no better. So this
   * decides only *that* something was refused, and the template says the rest in its own words.
   *
   * Which also settles the blank-message case here: the fallback the field slots need does not
   * apply to a destination that never shows the server's text, so an empty message and a full one
   * produce the same visible outcome rather than the bare-key one they used to.
   *
   * Object.keys().includes() rather than `key in this.scalarSlots`: the key comes off the wire, and
   * `'toString' in scalarSlots` is true. That would treat a rejection as claimed by a slot which
   * then would not render it -- the silent drop, reintroduced through the prototype chain.
   */
  protected readonly hasUnclaimedRejection = computed(() => {
    const slotted = Object.keys(this.scalarSlots);
    return Object.keys(this.fieldErrors()).some((key) => !slotted.includes(key));
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      // Every slot is held back until its control is touched or dirty, so this is what turns a
      // rejected send from a button that appears not to work into three visible complaints.
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.fieldErrors.set({});

    this.contactApi.submitContactMessage({ contactMessageWriteRequest: this.form.getRawValue() }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
        this.form.reset();
      },
      error: (problem: ApiProblem) => {
        this.submitting.set(false);
        // `?? []` is the load-bearing half: errorInterceptor normalizes every HttpErrorResponse
        // into an ApiProblem but rethrows anything else unchanged, so the shape here is only almost
        // guaranteed. Reading .fieldErrors off a bare Error does not throw -- it yields undefined.
        // Reading .length off *that* is what threw, and since it throws from inside the subscriber
        // RxJS reports it out of band: no field messages, no toast (the interceptor passed on a
        // non-HttpErrorResponse without one), an uncaught error in the console, and a Send that
        // once again appears to do nothing. Which is this component's original bug, by a longer
        // route. `submitting` is already false by then -- it is set on the line above -- so the
        // symptom is silence rather than a stuck spinner.
        //
        // The `?.` has no reachable case of its own: nothing in the pipeline rethrows a nullish
        // value. It is here because the admin form's handler has it, and these two lines are the
        // same contract with the same interceptor -- spelled the same way, they read as one rule
        // rather than as two independent judgements about how much to trust it.
        const fieldErrors = problem?.fieldErrors ?? [];
        if (fieldErrors.length > 0) {
          this.fieldErrors.set(groupFieldErrors(fieldErrors));
        }
        // Non-field errors (rate limiting, server errors) are surfaced globally by errorInterceptor.
      },
    });
  }

  /**
   * One message slot per field: this form's own validator message while the control is in
   * violation, otherwise whatever the server said about the same field. The client half, including
   * the touched/dirty gate and the events() subscription that is the only reason any of it
   * repaints, is shared with the admin project form -- see shared/form-errors.
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
   * Everything the server said about `field`, if anything. Routed through joinMessages() rather
   * than read straight out of the map for two reasons: a key that arrives with a blank message
   * would otherwise be subtracted from hasUnclaimedRejection() as claimed and then render as
   * nothing at all -- a rejection reaching no destination, which is the failure this slot mechanism
   * exists to prevent -- and a key can hold more than one message, since the API reports one entry
   * per violation without deduping. Showing the first would drop the rest into the same nowhere.
   *
   * hasOwn rather than `in` guards the *lookup*, not the incoming key: it stops a slot resolving
   * against Object.prototype and reporting a rejection the server never sent. That is unreachable
   * as this stands, since `field` is only ever one of the three literals in scalarSlots and none of
   * them names a prototype member -- it is the correct primitive for "does this map hold this key"
   * rather than a guard earning its keep, and there is deliberately no test for it.
   *
   * The reachable half of that hazard is on the other side, where the key does come off the wire:
   * see hasUnclaimedRejection(), which is tested with a key named `toString`.
   */
  private serverError(field: string): string | null {
    const errors = this.fieldErrors();
    return Object.hasOwn(errors, field)
      ? joinMessages(errors[field], UNEXPLAINED_FIELD_REJECTION)
      : null;
  }
}
