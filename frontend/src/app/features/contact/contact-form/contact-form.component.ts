import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../../core/api/api/contact.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { clientErrorSignal, joinMessages } from '../../../shared/form-errors/form-errors';

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
  protected readonly fieldErrors = signal<Record<string, string>>({});

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
   * Server field errors that no slot on this form claimed, shown together next to Send.
   *
   * errorInterceptor deliberately stays quiet for any 400 that carries field errors, so a key with
   * no slot is a message that was rejected and said nothing -- and the person it happened to is a
   * visitor who has no other way to find out. The contract is fixed today (name, email, message)
   * but the backend decides what to call a field, and a rename ships on its side alone.
   */
  protected readonly unclaimedErrors = computed(() => {
    const slotted = Object.keys(this.scalarSlots);
    return Object.entries(this.fieldErrors())
      .filter(([key]) => !slotted.includes(key))
      .map(([field, message]) => ({ field, message }));
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
        // Optional-chained: errorInterceptor normalizes every HttpErrorResponse into an ApiProblem
        // but rethrows anything else unchanged, so the shape here is only almost guaranteed. Reading
        // .fieldErrors off a bare Error throws inside the subscriber, where RxJS reports it out of
        // band -- the form would sit on "Sending…" forever with nothing on screen to say why.
        const fieldErrors = problem?.fieldErrors ?? [];
        if (fieldErrors.length > 0) {
          this.fieldErrors.set(Object.fromEntries(fieldErrors.map((e) => [e.field, e.message])));
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
   * What the server said about `field`, if anything. Routed through joinMessages() rather than read
   * straight out of the map, because a key that arrives with a blank message would otherwise be
   * subtracted from unclaimedErrors() as claimed and then render as nothing at all -- a rejection
   * that reaches no destination, which is the failure this whole slot mechanism exists to prevent.
   *
   * hasOwn rather than `in`: the map is built from a JSON body, and a field literally named
   * `toString` would otherwise resolve against Object.prototype and report a rejection that the
   * server never sent.
   */
  private serverError(field: string): string | null {
    const errors = this.fieldErrors();
    return Object.hasOwn(errors, field) ? joinMessages([errors[field]]) : null;
  }
}
