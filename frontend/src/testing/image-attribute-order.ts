/**
 * Test-only instrumentation that records the order in which Angular writes attributes and the
 * `src` property onto elements.
 *
 * Why this exists: the LCP work in the project templates depends on `loading` being set *before*
 * `src`, which is why the eager/lazy split is two elements carrying static attributes instead of
 * one element with `[attr.loading]`. Static attributes are written during the creation pass;
 * bindings are written during the update pass, after `[src]`. Asserting only the final attribute
 * values cannot tell those apart -- jsdom has no fetch scheduler, so both look identical once the
 * DOM has settled. Recording the write order can.
 *
 * Patches `Element.prototype.setAttribute` and the `HTMLImageElement.prototype.src` setter, so
 * `restore()` must run in an `afterEach`.
 */
export function trackImageAttributeOrder(): {
  /** Names written to `element`, in write order, deduplicated to the first write of each name. */
  writesFor: (element: Element) => string[];
  restore: () => void;
} {
  const writes: { element: Element; name: string }[] = [];

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
    writes.push({ element: this, name });
    originalSetAttribute.call(this, name, value);
  };

  const originalSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...originalSrc,
    set(this: HTMLImageElement, value: string) {
      writes.push({ element: this, name: 'src' });
      originalSrc.set!.call(this, value);
    },
  });

  return {
    writesFor: (element) =>
      writes
        .filter((write) => write.element === element)
        .map((write) => write.name)
        // Setting the `src` property reflects into the `src` attribute, so it is recorded twice.
        .filter((name, index, all) => all.indexOf(name) === index),
    restore: () => {
      Element.prototype.setAttribute = originalSetAttribute;
      Object.defineProperty(HTMLImageElement.prototype, 'src', originalSrc);
    },
  };
}
