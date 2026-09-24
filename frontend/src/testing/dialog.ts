/**
 * Minimal stand-ins for `HTMLDialogElement.showModal()` and `close()`, which jsdom (28.x) does not
 * implement at all -- `showModal` is simply undefined, so a component that calls it throws.
 *
 * Deliberately as little as keeps the assertions honest, and nothing that would make a spec pass
 * on the stub's behalf:
 *
 * - `showModal()` sets the `open` attribute (jsdom does reflect `open` into the property, and it is
 *   what `dialog.open` and the component's `[open]` styling read).
 * - `close()` removes it at once and fires `close` **asynchronously**, in a later task -- as a
 *   browser does: `open` is false as soon as `close()` returns, but the event is queued. Only if the
 *   dialog was open, as a browser does. That event is the one the component cleans up on, so a
 *   spec asserting focus or scroll is restored is exercising the component's handler, not this
 *   file -- and has to wait a task for it (`fixture.whenStable()` alone does not wait for a
 *   `setTimeout`). A synchronous stub would let a component, or a spec, come to depend on the
 *   cleanup having happened by the time `close()` returns, which no browser guarantees.
 *
 * What this does **not** do, on purpose: move focus, trap focus, or handle Escape. A browser does
 * all three, and so does the component explicitly; faking them here would let a spec pass with
 * the component's own handling deleted. Patches the prototype, so `restore()` belongs in an
 * `afterEach`.
 */
export function stubDialog(): { restore(): void } {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const had = { showModal: proto['showModal'], close: proto['close'] };

  proto['showModal'] = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
  proto['close'] = function (this: HTMLDialogElement): void {
    if (!this.hasAttribute('open')) {
      return;
    }
    this.removeAttribute('open');
    setTimeout(() => this.dispatchEvent(new Event('close')));
  };

  return {
    restore(): void {
      for (const name of ['showModal', 'close'] as const) {
        if (had[name] === undefined) {
          delete proto[name];
        } else {
          proto[name] = had[name];
        }
      }
    },
  };
}
