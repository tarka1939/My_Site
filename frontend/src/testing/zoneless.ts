import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

/**
 * Interaction helpers for component specs, and the convention that goes with them.
 *
 * # Prefer a real DOM event plus `await fixture.whenStable()` over `fixture.detectChanges()`
 * # wherever a test asserts that something *reacted*.
 *
 * This app is zoneless (`provideZonelessChangeDetection()`; no `zone.js` in `package.json`, no
 * `polyfills` entry in `angular.json`). Under zoneless, `ComponentFixture.detectChanges()` sets
 * `includeAllTestViews = true` before ticking, which refreshes **every** test view regardless of
 * whether anything marked it dirty.
 *
 * So `detectChanges()` is structurally incapable of detecting one thing: a **missing dirty-mark**.
 * A component that changes state and fails to notify Angular still renders in a spec that forces a
 * refresh, and is stale forever in a real browser. `whenStable()` only flushes work that something
 * actually scheduled, so an assertion after it depends on the notification having happened.
 *
 * ## Two things this is *not*, both measured rather than assumed (issue #110)
 *
 * 1. **It does not mask a stale `computed`.** A cached computed returns its stale value however
 *    many times you force a refresh, so `detectChanges()` catches that class fine. The
 *    `untracked()` trap this codebase actually hit -- a `computed` reading only
 *    `AbstractControl.touched`/`dirty` caches its first answer forever -- is the stale-computed
 *    kind, and both styles catch it. Substituting `detectChanges()` for `whenStable()` throughout
 *    the contact form spec *and* dropping the `toSignal(control.events)` read still failed the same
 *    seven tests. (Only `touched` and `dirty` go through `untracked()`; `errors` is a plain class
 *    field on `AbstractControl`, not signal-backed at all.)
 *
 * 2. **It is not the only way to miss a repaint bug.** Catchability depends on the assertion being
 *    **positive**. A "the message clears once the field is fixed" test passes under a mutation that
 *    stops the message rendering at all -- vacuously, because it never appeared to begin with. A
 *    negative assertion cannot tell "correctly absent" from "never rendered". Assert presence on a
 *    path before asserting absence on it, in either style.
 *
 * Overstating this is worse than saying nothing: the narrow claim is the accurate one.
 *
 * ## What that means in practice
 *
 * - **Arrange steps stay fine on `detectChanges()`.** The first render after `createComponent()`
 *   always happens, so nothing about it depends on a dirty-mark. Setting up state with
 *   `patchValue()` and flushing it before the part under test is an arrange step too.
 * - **Assertions that do not depend on a repaint stay fine.** Checking that a service was called
 *   with certain arguments, that a signal holds a value, or that a `document.head` tag was written
 *   imperatively does not go through change detection at all.
 * - **Act through the DOM when the act *is* the wiring.** Calling `component['submit']()` skips the
 *   `(ngSubmit)` binding; dispatching a `submit` event does not. Template event listeners are also
 *   what marks an `OnPush` view dirty when a handler mutates something that is not a signal --
 *   `form.controls.links.controls` is a plain array, so the rendered link rows repaint only because
 *   the "+ Add link" click ran through a listener. A programmatic call in a spec does not do that,
 *   and `detectChanges()` hides the difference.
 *
 * There is deliberately **no test for the gap itself**. Removing a dirty-mark while leaving the
 * signal graph intact is not something application code can do -- that plumbing is Angular's -- so
 * a test claiming to cover it would be covering nothing. The convention is the deliverable.
 */

/** Create a component and let its first render settle. The zoneless equivalent of the initial
 * `createComponent()` + `detectChanges()` pair. */
export async function renderComponent<T>(component: Type<T>): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return fixture;
}

/**
 * The `index`th element matching `selector`, or a thrown error naming the selector.
 *
 * Throwing rather than returning null on purpose: `host.querySelector(sel)?.click()` on a selector
 * that matches nothing is a silent no-op, and a test that then asserts an *absence* passes for the
 * wrong reason. A spec should fail at the interaction, not three assertions later.
 */
function require_<E extends Element>(
  fixture: ComponentFixture<unknown>,
  selector: string,
  index = 0,
): E {
  const matches = (fixture.nativeElement as HTMLElement).querySelectorAll<E>(selector);
  const element = matches[index];
  if (!element) {
    throw new Error(
      `no element at index ${index} matching ${selector} (${matches.length} matched)`,
    );
  }
  return element;
}

/** Click an element the way a user does, then let whatever it scheduled settle. */
export async function clickOn(
  fixture: ComponentFixture<unknown>,
  selector: string,
  index = 0,
): Promise<void> {
  require_<HTMLElement>(fixture, selector, index).click();
  await fixture.whenStable();
}

/** Type into a rendered field, so the control and the view both see it, then let it settle. */
export async function typeInto(
  fixture: ComponentFixture<unknown>,
  selector: string,
  value: string,
): Promise<void> {
  const field = require_<HTMLInputElement | HTMLTextAreaElement>(fixture, selector);
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

/**
 * Submit a form the way a user does, rather than calling the component's submit handler.
 *
 * `bubbles` and `cancelable` match a real submit, which is what `(ngSubmit)` listens for and what
 * `preventDefault()` in the handler needs to be able to act on.
 */
export async function submitForm(
  fixture: ComponentFixture<unknown>,
  selector = 'form',
): Promise<void> {
  require_<HTMLFormElement>(fixture, selector).dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await fixture.whenStable();
}
