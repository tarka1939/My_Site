import { computed, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * The pieces every form on this site needs to make a rejection visible, and only those pieces.
 *
 * What is deliberately *not* here: how a form looks a server key up. The admin project form matches
 * indexed keys (`tags[2]` belongs to its one comma-separated tags control) and has per-row slots;
 * the contact form has three scalar controls and matches keys exactly. Those rules differ in kind,
 * and each form pairs its lookup with the subtraction its catch-all does, so they stay in step with
 * each other rather than with this file. Only the two things that are identical live here.
 */

/**
 * What a slot says when the server named a field but gave nothing to say about it. The contract
 * everywhere is that a rejection reaches a destination; a key whose message is null, undefined or
 * blank would otherwise be subtracted from a form's catch-all as claimed and then render as
 * nothing, which is a submission rejected in silence again.
 */
export const UNEXPLAINED_REJECTION = 'Rejected by the server, which gave no reason.';

/**
 * Join what the server said, skipping entries with no text. Both parts matter: `[null, 'the real
 * complaint'].join('; ')` is `"; the real complaint"`, a leading separator leaking into the UI, and
 * a set of entries that are all blank must still say *something* -- there was a rejection.
 *
 * Types say these are strings. The wire does not: this is a JSON body, and the one function whose
 * whole job is that nothing reaches no destination is the wrong place to trust that.
 */
export function joinMessages(messages: string[]): string | null {
  const usable = messages.filter(
    (message) => typeof message === 'string' && message.trim().length > 0,
  );
  if (usable.length > 0) {
    return usable.join('; ');
  }
  return messages.length > 0 ? UNEXPLAINED_REJECTION : null;
}

function messageFor(
  errors: ValidationErrors | null,
  messages: Record<string, string>,
): string | null {
  for (const key of Object.keys(errors ?? {})) {
    if (messages[key]) {
      return messages[key];
    }
  }
  return null;
}

/**
 * This form's own validator message for `control`, worded by `messages` and keyed by the error key
 * `Validators.*` produces -- or null while the control is clean, so a blank form does not open
 * covered in complaints. `markAllAsTouched()` in a submit handler is what makes them appear on a
 * rejected send instead of the silent return this exists to end.
 *
 * The events() read is what keeps this reactive, and is not optional: AbstractControl exposes
 * `touched`, `dirty` and `errors` through untracked() (Angular 21), so a computed reading only
 * those would cache its first answer and never update. This app is zoneless, so a message that
 * never repaints is a failure state that renders as an idle one -- the exact bug both forms have
 * been fixed for. `events` emits on every value, status and touched change, so the computed is
 * invalidated exactly when one of them moves.
 *
 * Callers compose the server's half themselves, since the lookup rule differs per form:
 * `computed(() => clientMessage() ?? this.serverError(field))`.
 *
 * toSignal() needs an injection context, so call this from a field initializer or a constructor.
 */
export function clientErrorSignal(
  control: AbstractControl,
  messages: Record<string, string>,
): Signal<string | null> {
  const events = toSignal(control.events, { initialValue: null });

  return computed(() => {
    events();
    return control.touched || control.dirty ? messageFor(control.errors, messages) : null;
  });
}
