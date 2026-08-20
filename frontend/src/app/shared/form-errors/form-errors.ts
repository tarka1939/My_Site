import { computed, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { ApiFieldError } from '../../core/http/api-problem';

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
 * Fold one response's violations into "every message the server sent about this field", keyed by
 * field name.
 *
 * A list per key, not a message per key. `ApiProblem.fieldErrors` is one entry per violation with
 * no dedup -- GlobalExceptionHandler maps every getFieldErrors() entry straight through -- so two
 * constraints on one field arrive as two entries sharing a `field`. Folding that with
 * Object.fromEntries(map(e => [e.field, e.message])) keeps the last and discards the first, before
 * any slot, catch-all or toast has run: the silent drop, upstream of every guard built to prevent
 * it. A link label of 51 spaces reaches this today -- the row control only checks `required`, and
 * `Validators.required` passes whitespace -- and comes back as @NotBlank *and* @Size, both keyed
 * `links[0].label`.
 *
 * Insertion order is preserved within a key, so joinMessages() renders the violations in the order
 * the server listed them.
 *
 * Built through a Map and Object.fromEntries rather than by assigning into an object literal. The
 * keys come off the wire, and `result[field] = messages` with a field named `__proto__` runs the
 * Object.prototype setter and swaps the object's prototype instead of storing a key -- the entry
 * would vanish. fromEntries defines own data properties, so a `__proto__` key stays an own key and
 * both Object.hasOwn and Object.keys still see it, which is what the callers look it up with.
 */
export function groupFieldErrors(fieldErrors: ApiFieldError[]): Record<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const error of fieldErrors) {
    const existing = grouped.get(error.field);
    if (existing) {
      existing.push(error.message);
    } else {
      grouped.set(error.field, [error.message]);
    }
  }

  return Object.fromEntries(grouped);
}

/**
 * Join what the server said about one field, skipping entries with no text. Both parts matter:
 * `[null, 'the real complaint'].join('; ')` is `"; the real complaint"`, a leading separator
 * leaking into the UI, and a set of entries that are all blank must still say *something* -- there
 * was a rejection, and the contract everywhere is that a rejection reaches a destination. A key
 * that is present with a blank message would otherwise be subtracted from a form's catch-all as
 * claimed and then render as nothing, which is a submission rejected in silence again.
 *
 * Types say these are strings. The wire does not: this is a JSON body, and the one function whose
 * whole job is that nothing reaches no destination is the wrong place to trust that.
 *
 * Total by construction. "Did the server name this field at all" is the caller's question, and
 * every caller already has a lookup that answers it; asking it here as well only added an
 * empty-input branch that no call site could reach.
 *
 * `fallback` is a required argument rather than a default because the wording has an audience. The
 * admin form's names the server, which is right for a reader who knows what `links[0].label` means
 * and wrong for a visitor who has just lost their message. A default here would hand the next form
 * the previous form's audience -- which is how an admin-voiced string reached the public contact
 * page once already.
 */
export function joinMessages(messages: string[], fallback: string): string {
  const usable = messages.filter(
    (message) => typeof message === 'string' && message.trim().length > 0,
  );
  return usable.length > 0 ? usable.join('; ') : fallback;
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
 * The events() read is what keeps this reactive, and is not optional: none of `touched`, `dirty`
 * or `errors` registers a dependency when a computed reads it, though for two different reasons.
 * Verified against @angular/forms@21.2.19: `touched` returns `untracked(this.touchedReactive)` and
 * `dirty` is `!pristine`, which does the same -- signals deliberately read outside the reactive
 * graph -- while `errors` is a plain instance field with no signal behind it at all, assigned
 * directly by updateValueAndValidity(). Either way a computed reading only those caches its first
 * answer and never updates. This app is zoneless, so a message that never repaints is a failure
 * state that renders as an idle one -- the exact bug both forms have been fixed for. `events`
 * emits on every value, status and touched change, so the computed is invalidated exactly when one
 * of them moves.
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
