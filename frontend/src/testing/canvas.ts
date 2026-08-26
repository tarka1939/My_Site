/**
 * Test-only instrumentation that records what a component draws on a canvas, and can also make a
 * canvas unavailable on purpose.
 *
 * Why it exists: jsdom implements no 2D context at all (`getContext` returns null and reports a
 * "not implemented" error unless the optional `canvas` package is installed), so a spec that lets
 * the real call through would prove only that the code survives having no canvas -- never that the
 * artwork it draws is deterministic, or that two projects draw different things. Recording the
 * calls turns both of those into ordinary equality assertions.
 *
 * The recorder is a Proxy rather than a hand-written fake with the dozen members the drawing code
 * happens to use today. That is deliberate: a hand-written fake silently ignores any call it does
 * not implement, so a future `setLineDash([Math.random()])` would slip past "the same project
 * always draws the same thing" -- the assertion it is there to catch. A Proxy records every call
 * and every property write, whether or not this file knew about it.
 *
 * Patches `HTMLCanvasElement.prototype.getContext`, so `restore()` must run in an `afterEach`.
 */

/** Reads back the label of a recorded object (a gradient) without triggering the Proxy's get trap
 * for an ordinary member. */
const LABEL = Symbol('recorded-canvas-object');

export type CanvasMode =
  /** Hand back a recording context. */
  | 'record'
  /** No 2D context available -- the shape jsdom and a canvas-less browser both produce. */
  | 'null'
  /** `getContext` itself blows up, the other shape of "there is no canvas here". */
  | 'throw';

export interface CanvasRecording {
  /** Every `getContext` call, in call order -- so a spec can assert that none happened at all. */
  readonly requests: readonly { canvas: HTMLCanvasElement; contextId: string }[];
  /**
   * Calls and property writes on `canvas`'s context, in order, as comparable strings. A canvas
   * that is painted twice reports its *latest* paint, not a running total: each paint asks for a
   * context of its own, and comparing whole drawings is what the determinism assertions want.
   */
  opsFor(canvas: HTMLCanvasElement): readonly string[];
  restore(): void;
}

function format(value: unknown): string {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const label = (value as Record<symbol, unknown>)[LABEL];
    return typeof label === 'string' ? `<${label}>` : JSON.stringify(value);
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * A recording stand-in for a 2D context or a gradient.
 *
 * Labels are per-context, never global (`gradient#1` for the first gradient *this* context made),
 * so two renders of the same artwork produce byte-identical logs and can be compared directly.
 */
function recorder(log: string[], label: string, counter: { created: number }): unknown {
  const members = new Map<string, unknown>();
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property) {
      if (property === LABEL) {
        return label;
      }
      const name = String(property);
      if (!members.has(name)) {
        members.set(name, (...args: unknown[]) => {
          log.push(`${label}.${name}(${args.map(format).join(', ')})`);
          // `createLinearGradient` and friends have to return something usable: the drawing code
          // calls `addColorStop` on the result and assigns it to `fillStyle`.
          return name.startsWith('create')
            ? recorder(log, `gradient#${++counter.created}`, counter)
            : undefined;
        });
      }
      return members.get(name);
    },
    set(_target, property, value) {
      log.push(`${label}.${String(property)} = ${format(value)}`);
      return true;
    },
  });
}

export function recordCanvas(mode: CanvasMode = 'record'): CanvasRecording {
  const original = HTMLCanvasElement.prototype.getContext;
  const logs = new WeakMap<HTMLCanvasElement, string[]>();
  const requests: { canvas: HTMLCanvasElement; contextId: string }[] = [];

  function stub(this: HTMLCanvasElement, contextId: string): unknown {
    requests.push({ canvas: this, contextId });
    if (mode === 'throw') {
      throw new Error('canvas unavailable');
    }
    if (mode === 'null') {
      return null;
    }
    const log: string[] = [];
    logs.set(this, log);
    return recorder(log, 'context', { created: 0 });
  }

  HTMLCanvasElement.prototype.getContext = stub as HTMLCanvasElement['getContext'];

  return {
    requests,
    opsFor: (canvas) => logs.get(canvas) ?? [],
    restore: () => {
      HTMLCanvasElement.prototype.getContext = original;
    },
  };
}
