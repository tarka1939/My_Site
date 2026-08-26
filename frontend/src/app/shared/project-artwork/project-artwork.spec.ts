import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  artworkSeed,
  artworkSpec,
  drawProjectArtwork,
} from './project-artwork';

/**
 * The generator's invariants, measured rather than rendered.
 *
 * This follows styles.spec.ts, and for its reason: the two colour defects this project has shipped
 * (#116, #152) were both invisible to every DOM assertion aimed at them, because the DOM was
 * correct and the colour was not. A canvas is worse -- its output is not in the DOM at all -- so
 * the only thing a spec can hold is the arithmetic behind what gets drawn.
 *
 * What it therefore checks is not "does this look like a frequency response", which no test can
 * see (CLAUDE.md), but the three properties a reader would notice if they broke: a project's
 * picture never changes, the curve stays inside its box, and every colour it can produce is
 * visible on both grounds.
 */

// --- WCAG 2.2 relative luminance (SC 1.4.3), as in styles.spec.ts -------------------------------

function channel(eightBit: number): number {
  const c = eightBit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: number[]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: number[], b: number[]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function over(colour: number[], alpha: number, ground: number[]): number[] {
  return colour.map((c, index) => alpha * c + (1 - alpha) * ground[index]);
}

function hex(value: string): number[] {
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
}

/**
 * The two grounds the artwork can land on: --color-surface-muted (`rgb(128 128 128 / 18%)`)
 * composited over --color-surface in each scheme. Both values are copied from styles.scss, which
 * styles.spec.ts is what guards.
 */
const PLATE_LIGHT = over([128, 128, 128], 0.18, hex('#f2f0f6'));
const PLATE_DARK = over([128, 128, 128], 0.18, hex('#121218'));

/** SC 1.4.11's floor. Not an obligation for decoration -- it is the point below which a line stops
 * reading as a line. */
const VISIBLE = 3;
/** styles.scss's ceiling for a quiet rule, for the same reason it applies to the site's hairline:
 * past this a background grid stops being a grid and starts being a cage. */
const QUIET = 2.5;

/**
 * Captures what a draw emits, without a DOM: the gradient colours, the points of the curve, and
 * every colour assigned directly to `strokeStyle`.
 *
 * The last of those is not incidental. An earlier version of this file recomputed the grid's alpha
 * and the fill's alpha from constants it declared itself, and mutation testing found both: raising
 * the grid to `0.9` and the fill to fully opaque each left the suite green, because neither
 * assertion was reading anything the code did. Everything measured below is now parsed out of a
 * string the generator actually produced.
 */
function capture(seed: number) {
  const gradients: string[][] = [];
  const paths: number[][][] = [];
  const strokeStyles: unknown[] = [];
  const point = (x: number, y: number) => {
    paths[paths.length - 1]?.push([x, y]);
  };
  const context = {
    clearRect() {},
    // Points are grouped by path, and that is not tidiness. Measuring them as one flat list means
    // the grid's own points satisfy assertions aimed at the curve: a mutation squeezing the curve
    // into a 10% band in the middle of the slot passed a "uses the full height" test, because the
    // grid still ran corner to corner.
    beginPath() {
      paths.push([]);
    },
    closePath() {},
    stroke() {},
    fill() {},
    moveTo: point,
    lineTo: point,
    set strokeStyle(value: unknown) {
      strokeStyles.push(value);
    },
    createLinearGradient: () => {
      // One list per gradient, in creation order, so the area under the curve and the curve itself
      // are told apart by what they are rather than by what colour they came out.
      const stops: string[] = [];
      gradients.push(stops);
      return {
        addColorStop(_stop: number, colour: string) {
          stops.push(colour);
        },
      };
    },
  } as unknown as CanvasRenderingContext2D;

  drawProjectArtwork(context, artworkSpec(seed));
  // Three paths, in draw order: the grid, the area under the curve, the curve. Named here so a
  // test asks for the one it means, and asserted below so a restructure cannot quietly renumber
  // them.
  return { gradients, paths, strokeStyles };
}

/** The curve alone -- not the grid, and not the closed outline of the area under it. */
function curveOf(seed: number): number[][] {
  const { paths } = capture(seed);
  expect(paths.length, `seed ${seed} draws three paths`).toBe(3);
  return paths[2];
}

function componentsOf(colour: string): number[] {
  const parts = colour.match(/-?\d+(\.\d+)?/g);
  if (!parts) {
    throw new Error(`unparseable colour ${colour}`);
  }
  return parts.map(Number);
}

function rgbOf(colour: string): number[] {
  return componentsOf(colour).slice(0, 3);
}

/** The alpha the colour was actually written with -- 1 for an `rgb()`, the fourth component of an
 * `rgba()`. Read rather than assumed; see the note on `capture`. */
function alphaOf(colour: string): number {
  const parts = componentsOf(colour);
  return parts.length > 3 ? parts[3] : 1;
}

/** Enough seeds to sweep the whole hue circle several times over. */
const SEEDS = Array.from({ length: 400 }, (_, index) => index * 7919);

describe('artworkSeed', () => {
  it('hashes a project to the same number every time', () => {
    expect(artworkSeed('Equalizer', ['dsp', 'cpp'])).toBe(artworkSeed('Equalizer', ['dsp', 'cpp']));
  });

  it('ignores the order the tags arrive in', () => {
    // The backend's tag order is randomised per JVM run; see the note on artworkSeed.
    expect(artworkSeed('Equalizer', ['cpp', 'dsp'])).toBe(artworkSeed('Equalizer', ['dsp', 'cpp']));
  });

  it('does not confuse a title with a tag next to it', () => {
    // Joining the parts on any separator that can occur in a title collapses these two projects
    // into one hash, and they would draw the same picture. The parts are length-prefixed instead.
    expect(artworkSeed('a b', [])).not.toBe(artworkSeed('a', ['b']));
    expect(artworkSeed('a:b', [])).not.toBe(artworkSeed('a', ['b']));
  });

  it('separates projects that differ in any part', () => {
    const seeds = new Set([
      artworkSeed('Equalizer', ['dsp']),
      artworkSeed('Equalizer', ['colour-science']),
      artworkSeed('Equalizer', ['dsp', 'cpp']),
      artworkSeed('Reverb', ['dsp']),
      artworkSeed('equalizer', ['dsp']),
    ]);
    expect(seeds.size).toBe(5);
  });
});

describe('drawProjectArtwork', () => {
  it('draws every colour it can produce visibly on both grounds', () => {
    // The defect this pins is measurable and was live: at a fixed HSL lightness the curve ranged
    // from 1.04:1 to 4.20:1 against the light plate depending only on hue, so some cards would
    // have been invisible while their neighbours shouted. HSL lightness is not lightness, and the
    // generator now solves for luminance -- this is the assertion that it still does.
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { gradients } = capture(seed);
      // Two gradients, in creation order: the area under the curve, then the curve. Asserted so
      // that a restructure has to come back through this test rather than silently reassigning
      // which of the two every measurement below is aimed at.
      expect(gradients.length, `seed ${seed}`).toBe(2);
      const [area, curve] = gradients;

      for (const colour of curve) {
        if (seen.has(colour)) {
          continue;
        }
        seen.add(colour);
        expect(alphaOf(colour), `the curve is opaque: ${colour}`).toBe(1);
        const rgb = rgbOf(colour);
        expect(contrastRatio(rgb, PLATE_LIGHT), `${colour} on the light plate`).toBeGreaterThan(
          VISIBLE,
        );
        expect(contrastRatio(rgb, PLATE_DARK), `${colour} on the dark plate`).toBeGreaterThan(
          VISIBLE,
        );
      }

      for (const colour of area) {
        if (seen.has(colour)) {
          continue;
        }
        seen.add(colour);
        // The area is a wash, so it takes a band rather than a floor: enough to give the curve a
        // body, quiet enough that the curve stays the thing you see. The alpha is read out of the
        // colour the generator wrote, never assumed -- an opaque fill has to fail here.
        const alpha = alphaOf(colour);
        expect(alpha, `the area under the curve is a wash: ${colour}`).toBeLessThan(0.6);
        for (const [plate, where] of [
          [PLATE_LIGHT, 'light'],
          [PLATE_DARK, 'dark'],
        ] as const) {
          const washed = contrastRatio(over(rgbOf(colour), alpha, plate), plate);
          expect(washed, `${colour} washed onto the ${where} plate`).toBeGreaterThan(1.2);
          expect(washed, `${colour} washed onto the ${where} plate`).toBeLessThan(QUIET);
        }
      }
    }
    // A sweep that produced two colours would satisfy every assertion above and prove nothing.
    expect(seen.size).toBeGreaterThan(50);
  });

  it('keeps the background grid quiet on both grounds', () => {
    // The grid is a rule behind the artwork, so it takes the ceiling the site's hairline takes
    // rather than a floor: it must be findable, not structural.
    //
    // The colour is read off the strokeStyle the generator assigned, not restated here. Restating
    // it is what let a mutation raise the grid to alpha 0.9 with this test still green.
    const { strokeStyles } = capture(1);
    const flat = strokeStyles.filter((style): style is string => typeof style === 'string');
    // Exactly one flat colour: the curve's stroke is a gradient object, so a second string here
    // would mean something else started painting without being measured.
    expect(flat.length).toBe(1);

    for (const [plate, where] of [
      [PLATE_LIGHT, 'light'],
      [PLATE_DARK, 'dark'],
    ] as const) {
      const drawn = over(rgbOf(flat[0]), alphaOf(flat[0]), plate);
      expect(contrastRatio(drawn, plate), `${flat[0]} on the ${where} plate`).toBeLessThan(QUIET);
      // And not so quiet it is not there at all -- an invisible grid is the same as no grid, and
      // the "below the ceiling" half of this assertion passes happily for alpha 0.
      expect(contrastRatio(drawn, plate), `${flat[0]} on the ${where} plate`).toBeGreaterThan(1.2);
    }
  });

  it('keeps every curve inside its box, whatever the seed', () => {
    // The response is normalised into the slot rather than plotted at absolute magnitude. Without
    // that, a project whose resonances happen to stack draws a curve clipped flat against the top
    // edge -- deterministically, so it would look intentional.
    for (const seed of SEEDS) {
      for (const [x, y] of curveOf(seed)) {
        expect(x, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(x, `seed ${seed}`).toBeLessThanOrEqual(ARTWORK_WIDTH);
        expect(y, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(y, `seed ${seed}`).toBeLessThanOrEqual(ARTWORK_HEIGHT);
      }
    }
  });

  it('uses the full height of the slot rather than a band in the middle', () => {
    // The other half of normalising: a curve that never leaves the middle third is a flat line as
    // far as a reader is concerned, and every card would look the same.
    for (const seed of SEEDS.slice(0, 40)) {
      const ys = curveOf(seed).map(([, y]) => y);
      expect(Math.min(...ys), `seed ${seed}`).toBeLessThan(ARTWORK_HEIGHT * 0.25);
      expect(Math.max(...ys), `seed ${seed}`).toBeGreaterThan(ARTWORK_HEIGHT * 0.75);
    }
  });
});
