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

/**
 * The luminance every curve is drawn at, and the reason there is a solver below at all.
 *
 * A fixed HSL lightness does *not* give a fixed visual weight: at `l: 62%` the stroke runs from
 * 1.00:1 to 4.20:1 against the light plate and 2.64:1 to 12.16:1 against the dark one -- so some
 * cards would have shouted while their neighbours were invisible, and which was which would have
 * depended on the scheme. That 1.00:1 is not rounding: at hue 79.2, `l: 62%` lands on exactly the
 * light plate's luminance and the curve vanishes into it. HSL lightness is not lightness.
 *
 * Solving for sRGB relative luminance instead fixes both at once. The plates are
 * --color-surface-muted composited over --color-surface (not over --color-bg -- a card is what the
 * artwork sits on), giving a luminance of 0.7197 light and 0.0195 dark. Any stroke between 0.1586
 * and 0.2066 therefore clears 3:1 against *both*, and 0.18 sits near the middle of that window
 * (midpoint 0.1826).
 *
 * What that buys is a narrow band, not a single pinned ratio: across every hue the drawn stroke
 * measures 3.32:1 to 3.37:1 on the light plate and 3.28:1 to 3.33:1 on the dark one. The solver
 * itself is tighter than that -- it holds 3.34-3.35 and 3.30-3.31 -- and almost all of the spread
 * is the `Math.round` that turns its output into 8-bit channels. The floors are the part that
 * matters, and there are two of them, at different hues: the light plate bottoms out at 3.3211:1
 * at hue 45.3, the dark plate at 3.2814:1 at hue 57.4. They cannot coincide. Light contrast is
 * (plate + 0.05) / (stroke + 0.05) and dark is (stroke + 0.05) / (plate + 0.05), so they are
 * perfectly anti-correlated in the stroke's luminance: the hue that minimises one maximises the
 * other, and those two hues are in fact each other's -- hue 45.3 is where the dark plate peaks at
 * 3.3329:1, and hue 57.4 is where the light plate peaks at 3.3731:1. Both floors clear 3:1, which
 * is what the constant is for. Nothing here is text, so 3:1 is not a WCAG obligation -- it is the
 * threshold at which a line stops being a suggestion.
 *
 * The plate luminances and the window are re-derived in project-artwork.spec.ts rather than
 * trusted here: the previous set of figures in this comment had drifted from the constants they
 * were computed off (#159).
 */
const STROKE_LUMINANCE = 0.18;

/** Saturation of the curve. High, because luminance is being held fixed; this is what is left to
 * tell two hues apart. */
const STROKE_SATURATION = 0.82;

type Rgb = readonly [number, number, number];

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sector];
  return [(r + base) * 255, (g + base) * 255, (b + base) * 255];
}

/** sRGB relative luminance, WCAG's definition -- the same one the token comments in styles.scss
 * quote ratios from. */
function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The colour for `hue`, at `STROKE_LUMINANCE`.
 *
 * Bisection rather than a closed form: luminance is monotonic in HSL lightness at a fixed hue and
 * saturation, so twelve halvings land within 1/4096 of the target -- far finer than an 8-bit
 * channel can express -- and it stays a pure function of the hue, which is what keeps a project's
 * picture identical between two renders.
 */
function strokeFor(hue: number): Rgb {
  let low = 0;
  let high = 1;
  let rgb = hslToRgb(hue, STROKE_SATURATION, 0.5);
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) / 2;
    rgb = hslToRgb(hue, STROKE_SATURATION, middle);
    if (relativeLuminance(rgb) < STROKE_LUMINANCE) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return rgb;
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
 * The plate composites against whichever ground is up (`--color-surface-muted`), and every colour
 * the curve is drawn in is solved to one fixed luminance -- see `strokeFor`. Reading the live token
 * values out of the cascade instead would have meant a `prefers-color-scheme` listener, a repaint
 * on scheme change, and output that depends on the environment's theme.
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

  // One solved colour per stop, used for the curve and, at 42% alpha, for the area under it -- so
  // the fill is the same colour washed toward the plate rather than a second colour that has to be
  // checked against two grounds of its own.
  //
  // `rgb()`/`rgba()` with commas, rather than `oklch()` (which would make the luminance solver
  // unnecessary) or the modern space-separated forms. Nothing here catches an exception thrown
  // while drawing -- that would be a real bug, and swallowing it would leave a half-drawn picture
  // that still looks deterministic to a spec -- but `addColorStop` throws a SyntaxError on a colour
  // the browser cannot parse. So the syntax with no floor is the one to hand it; only the *absent*
  // canvas is degraded to a plain surface, and that is the component's job.
  const fill = context.createLinearGradient(0, 0, width, 0);
  const stroke = context.createLinearGradient(0, 0, width, 0);
  for (let stop = 0; stop <= 4; stop++) {
    const t = stop / 4;
    const hue = (((spec.baseHue + spec.hueSpan * t) % 360) + 360) % 360;
    const [r, g, b] = strokeFor(hue).map(Math.round);
    fill.addColorStop(t, `rgba(${r}, ${g}, ${b}, 0.42)`);
    stroke.addColorStop(t, `rgb(${r}, ${g}, ${b})`);
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
