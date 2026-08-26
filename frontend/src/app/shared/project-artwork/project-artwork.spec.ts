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

/** Captures what a draw emits, without a DOM: colours, and the points of the curve. */
function capture(seed: number) {
  const colours: string[] = [];
  const points: number[][] = [];
  const context = {
    clearRect() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    moveTo(x: number, y: number) {
      points.push([x, y]);
    },
    lineTo(x: number, y: number) {
      points.push([x, y]);
    },
    createLinearGradient: () => ({
      addColorStop(_stop: number, colour: string) {
        colours.push(colour);
      },
    }),
  } as unknown as CanvasRenderingContext2D;

  drawProjectArtwork(context, artworkSpec(seed));
  return { colours, points };
}

function rgbOf(colour: string): number[] {
  const parts = colour.match(/-?\d+(\.\d+)?/g);
  if (!parts) {
    throw new Error(`unparseable colour ${colour}`);
  }
  return parts.slice(0, 3).map(Number);
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
      for (const colour of capture(seed).colours) {
        if (seen.has(colour)) {
          continue;
        }
        seen.add(colour);
        const rgb = rgbOf(colour);
        // The curve is opaque; the area under it is the same colour at 42%, washed toward the
        // plate, so the fill is measured composited rather than as declared.
        const isFill = colour.startsWith('rgba');
        const onLight = isFill ? over(rgb, 0.42, PLATE_LIGHT) : rgb;
        const onDark = isFill ? over(rgb, 0.42, PLATE_DARK) : rgb;
        const light = contrastRatio(onLight, PLATE_LIGHT);
        const dark = contrastRatio(onDark, PLATE_DARK);

        if (isFill) {
          // The area is a wash, so it takes a band rather than a floor: present enough to give the
          // curve a body, quiet enough that the curve stays the thing you see.
          expect(light, `${colour} washed onto the light plate`).toBeGreaterThan(1.2);
          expect(light, `${colour} washed onto the light plate`).toBeLessThan(QUIET);
          expect(dark, `${colour} washed onto the dark plate`).toBeGreaterThan(1.2);
          expect(dark, `${colour} washed onto the dark plate`).toBeLessThan(QUIET);
          continue;
        }

        expect(light, `${colour} on the light plate`).toBeGreaterThan(VISIBLE);
        expect(dark, `${colour} on the dark plate`).toBeGreaterThan(VISIBLE);
      }
    }
    // A sweep that produced two colours would satisfy every assertion above and prove nothing.
    expect(seen.size).toBeGreaterThan(50);
  });

  it('keeps the background grid quiet on both grounds', () => {
    // The grid is a rule behind the artwork, so it takes the ceiling the site's hairline takes
    // rather than a floor: it must be findable, not structural.
    const grid = over([128, 128, 128], 0.35, PLATE_LIGHT);
    const gridDark = over([128, 128, 128], 0.35, PLATE_DARK);
    expect(contrastRatio(grid, PLATE_LIGHT)).toBeLessThan(QUIET);
    expect(contrastRatio(gridDark, PLATE_DARK)).toBeLessThan(QUIET);
  });

  it('keeps every curve inside its box, whatever the seed', () => {
    // The response is normalised into the slot rather than plotted at absolute magnitude. Without
    // that, a project whose resonances happen to stack draws a curve clipped flat against the top
    // edge -- deterministically, so it would look intentional.
    for (const seed of SEEDS) {
      for (const [x, y] of capture(seed).points) {
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
      const ys = capture(seed)
        .points.map(([, y]) => y)
        // The fill path closes through the bottom two corners, which are not part of the curve.
        .filter((y) => y !== ARTWORK_HEIGHT);
      expect(Math.min(...ys), `seed ${seed}`).toBeLessThan(ARTWORK_HEIGHT * 0.25);
      expect(Math.max(...ys), `seed ${seed}`).toBeGreaterThan(ARTWORK_HEIGHT * 0.75);
    }
  });
});
