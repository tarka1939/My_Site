/**
 * The generated card artwork: a deterministic frequency response drawn from a project's own title
 * and tags.
 *
 * It exists because three of five real projects have no image at all, and a grid where most cards
 * are empty rectangles is the problem Direction C was chosen to solve (docs/DECISIONS.md,
 * 2026-08-22). It is a **fallback**: where a project has a real image, the image wins and none of
 * this runs -- the template never instantiates the component, so no seed is hashed and no drawing
 * context is ever requested.
 *
 * Why a response curve rather than an abstract pattern: the subject of this portfolio is DSP,
 * colour science and numerical methods, so the stand-in should look like it came from that world.
 * The shape is a sum of Lorentzian resonances over a log-frequency axis, plotted on a Bode grid --
 * which is what a filter magnitude plot is, drawn with coefficients nobody chose.
 *
 * Split from the component on purpose: everything here is a pure function of its arguments, which
 * is what makes "the same project always draws the same thing" testable without a DOM at all.
 */

/** Logical drawing surface. See `drawProjectArtwork` for why this is fixed rather than measured. */
export const ARTWORK_WIDTH = 320;
export const ARTWORK_HEIGHT = 160;

/**
 * Horizontal sampling step, in logical pixels. 4px is below the visible faceting threshold for a
 * curve this smooth, and keeps the path at 81 points rather than 321.
 */
const SAMPLE_STEP = 4;

/** A resonance: where on the frequency axis it sits, how wide it is, and how hard it pushes. */
interface Resonance {
  readonly at: number;
  readonly width: number;
  readonly gain: number;
}

export interface ArtworkSpec {
  /** Degrees. The colour the response starts in at the left edge. */
  readonly baseHue: number;
  /** Degrees swept from `baseHue` to the right edge; signed, so the sweep runs either way. */
  readonly hueSpan: number;
  /** Overall slope of the response, before the resonances are added. */
  readonly tilt: number;
  readonly peaks: readonly Resonance[];
}

/**
 * A 32-bit FNV-1a hash of the project's identity as *content*, not as a database id.
 *
 * Keyed off title + tags rather than `id` deliberately: the artwork should be a picture of what the
 * project is, so two projects with the same name and tags drawing the same thing is correct, and a
 * project re-seeded into a fresh database keeps its picture.
 *
 * **Tags are sorted before hashing, and that is load-bearing.** The backend holds them in a
 * `HashSet` handed to `Set.copyOf`, whose iteration order is randomised per JVM run -- e2e's
 * projects.spec.ts already refuses to assert tag order for exactly that reason. Hashing them in
 * arrival order would give a project a different picture after every backend restart, which is the
 * one thing this function promises not to do, and it would have looked like flake rather than a bug.
 */
export function artworkSeed(title: string, tagNames: readonly string[]): number {
  // Length-prefixed rather than joined on a separator: a title is free text, so with any separator
  // that can occur in a title, the project "a:b" with no tags and the project "a" tagged "b" would
  // hash to the same string and draw the same picture.
  const source = [title, ...[...tagNames].sort()].map((part) => part.length + ':' + part).join('');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    // Math.imul, not `*`: the FNV prime overflows 53-bit float precision, so `*` would silently
    // stop being FNV-1a partway through the string.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 -- a small, well-distributed PRNG. Deterministic in its seed, which is the point. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turn a seed into a response. Every draw below is bounded, so there is no roll that produces a
 * flat line, a single spike or a muddy colour -- the whole range is intended output.
 */
export function artworkSpec(seed: number): ArtworkSpec {
  const next = sequence(seed);
  const between = (low: number, high: number) => low + next() * (high - low);

  const peaks: Resonance[] = [];
  const peakCount = 3 + Math.floor(next() * 3);
  for (let index = 0; index < peakCount; index++) {
    peaks.push({
      at: between(0.06, 0.94),
      width: between(0.05, 0.17),
      // Signed: a response with only boosts is a row of hills, and it is the notch that makes it
      // read as a filter rather than as decoration.
      gain: between(-0.8, 1),
    });
  }

  return {
    baseHue: between(0, 360),
    // At least 70 degrees, so a card is always a *spread* rather than one flat colour: two
    // neighbours that happen to hash to nearby base hues still resolve into different pictures.
    hueSpan: between(70, 170) * (next() < 0.5 ? -1 : 1),
    tilt: between(-0.4, 0.4),
    peaks,
  };
}

/** Magnitude at normalised log-frequency `x`, in arbitrary units -- it is normalised before use. */
function magnitudeAt(spec: ArtworkSpec, x: number): number {
  let magnitude = spec.tilt * (x - 0.5);
  for (const peak of spec.peaks) {
    const distance = (x - peak.at) / peak.width;
    magnitude += peak.gain / (1 + distance * distance);
  }
  return magnitude;
}

/**
 * Draw the response onto a 2D context.
 *
 * **Nothing here paints a background.** The grid, the fill and the curve are all drawn over
 * whatever the host element is sitting on, which is the card's own media plate. That is what makes
 * the no-canvas path safe: with no context, the plate is simply left as it is, so "degraded" and
 * "empty slot" cannot be the same state -- there is no hole available to leave.
 *
 * It is also what keeps the artwork right in both colour schemes without knowing which one is live.
 * The plate composites against whichever ground is up (`--color-surface-muted`), and the curve is
 * drawn in mid-lightness saturated hues that read on both. Reading the live token values out of the
 * cascade instead would have meant a `prefers-color-scheme` listener, a repaint on scheme change,
 * and output that depends on the environment's theme.
 *
 * Nothing animates, so `prefers-reduced-motion` is not consulted -- there is no motion to reduce. A
 * decorative loop behind twelve cards costs a compositor frame forever in exchange for something
 * nobody is looking at. This draws once per card and stops.
 */
export function drawProjectArtwork(
  context: CanvasRenderingContext2D,
  spec: ArtworkSpec,
  width: number = ARTWORK_WIDTH,
  height: number = ARTWORK_HEIGHT,
): void {
  const samples: number[] = [];
  let low = Infinity;
  let high = -Infinity;
  for (let x = 0; x <= width; x += SAMPLE_STEP) {
    const magnitude = magnitudeAt(spec, x / width);
    samples.push(magnitude);
    low = Math.min(low, magnitude);
    high = Math.max(high, magnitude);
  }

  // Normalise the curve into the box rather than plotting absolute magnitude: every card then
  // fills its slot, instead of some cards drawing a near-straight line across the middle.
  const span = Math.max(high - low, 1e-6);
  const top = height * 0.16;
  const bottom = height * 0.84;
  const yFor = (magnitude: number) => bottom - ((magnitude - low) / span) * (bottom - top);

  context.clearRect(0, 0, width, height);

  // The Bode grid. Neutral grey at low alpha, so it is a faint rule on the light plate and on the
  // dark one -- one value, no scheme knowledge. The half-pixel offsets keep 1px lines crisp.
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(128, 128, 128, 0.35)';
  context.beginPath();
  for (let rule = 1; rule < 4; rule++) {
    const y = Math.round((height * rule) / 4) + 0.5;
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  for (let rule = 1; rule < 6; rule++) {
    const x = Math.round((width * rule) / 6) + 0.5;
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  context.stroke();

  // The legacy comma syntax rather than `hsl(h s% l% / a)`. Nothing here catches an exception
  // thrown while drawing -- that would be a real bug, and swallowing it would leave a half-drawn
  // picture that still looks deterministic to a spec -- but `addColorStop` throws a SyntaxError on
  // a colour the browser cannot parse, so the fix is to hand it a syntax that has no floor rather
  // than to add a catch. Only the *absent* case is degraded to a plain surface; see the component.
  const fill = context.createLinearGradient(0, 0, width, 0);
  const stroke = context.createLinearGradient(0, 0, width, 0);
  for (let stop = 0; stop <= 4; stop++) {
    const t = stop / 4;
    const hue = (((spec.baseHue + spec.hueSpan * t) % 360) + 360) % 360;
    fill.addColorStop(t, `hsla(${hue.toFixed(1)}, 72%, 56%, 0.42)`);
    stroke.addColorStop(t, `hsl(${hue.toFixed(1)}, 82%, 62%)`);
  }

  context.beginPath();
  context.moveTo(0, height);
  for (let index = 0; index < samples.length; index++) {
    context.lineTo(index * SAMPLE_STEP, yFor(samples[index]));
  }
  context.lineTo(width, height);
  context.closePath();
  context.fillStyle = fill;
  context.fill();

  context.beginPath();
  for (let index = 0; index < samples.length; index++) {
    const x = index * SAMPLE_STEP;
    const y = yFor(samples[index]);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.strokeStyle = stroke;
  context.stroke();
}
