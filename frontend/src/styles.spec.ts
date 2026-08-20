import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The error colour shipped at 2.87:1 on a dark canvas through three review rounds and 193 tests
 * (issue #116). Nothing caught it because nothing could: every check on those regions was a DOM
 * assertion, and the DOM was right the whole time -- it was the colour that was wrong.
 *
 * So this file does not assert on rendered output. It reads the stylesheets as text and checks the
 * two things that actually failed: that the declared token clears WCAG AA against the canvases it
 * will be painted on, and that no component has gone back to hard-coding a red of its own. A
 * literal in a component cannot be flipped per scheme, which is the whole mechanism by which
 * #b3261e ended up unreadable.
 */

const AA_NORMAL_TEXT = 4.5;

const REPO_STYLES = join(process.cwd(), 'src', 'styles.scss');
const COMPONENT_ROOT = join(process.cwd(), 'src', 'app');

/** What `color-scheme: light dark` actually resolves the canvas to, per browser. */
const CANVAS = {
  light: '#ffffff',
  chromeDark: '#121212',
  /** The lightest of the major browsers' dark canvases, and so the binding constraint. */
  lightestDark: '#2b2a33',
};

// --- WCAG 2.2 relative luminance (SC 1.4.3), transcribed from the spec ----------------------

function channel(eightBit: number): number {
  const c = eightBit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function expand(hex: string): number[] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = expand(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- Reading the stylesheets ----------------------------------------------------------------

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * The light value is declared in `:root` and the dark one inside the `prefers-color-scheme` block,
 * so splitting on that block tells them apart without depending on either one's line number.
 */
function declaredErrorColours(): { light: string; dark: string } {
  const css = stripComments(readFileSync(REPO_STYLES, 'utf8'));
  const marker = '@media (prefers-color-scheme: dark)';
  const cut = css.indexOf(marker);
  expect(cut, marker + ' block is missing from styles.scss').toBeGreaterThan(-1);

  const read = (section: string, where: string) => {
    const match = /--color-error:\s*(#[0-9a-fA-F]{3,6})\s*;/.exec(section);
    expect(match, '--color-error is not declared ' + where).not.toBeNull();
    return match![1].toLowerCase();
  };

  return {
    light: read(css.slice(0, cut), 'in :root'),
    dark: read(css.slice(cut), 'inside the dark-scheme block'),
  };
}

/** Every stylesheet a component can carry: its .scss file, or an inline `styles:` block. */
function componentStyleSources(): { file: string; css: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(scss|ts)$/.test(entry.name) ? [full] : [];
    });

  return walk(COMPONENT_ROOT).flatMap((full) => {
    const file = relative(process.cwd(), full).replace(/\\/g, '/');
    const source = readFileSync(full, 'utf8');
    if (file.endsWith('.scss')) return [{ file, css: stripComments(source) }];
    // An inline stylesheet is a template literal on the @Component decorator.
    return [...source.matchAll(/styles:\s*`([\s\S]*?)`/g)].map((m) => ({
      file,
      css: stripComments(m[1]),
    }));
  });
}

/**
 * Hard-coded reds that are deliberately not the token, each with the reason it is exempt. A new
 * entry is a claim that the colour does not need to change between schemes -- check that before
 * adding one.
 */
const ALLOWED_FIXED_REDS: Record<string, string> = {
  // A filled surface, not text or a stroke: the destructive-action button and the error
  // notification both paint #fff on top of it at 10.28:1. Its contrast is against its own
  // foreground, so which way the canvas flips does not affect it.
  '#7a1f1f': 'filled error surface, always carries #fff on top at 10.28:1',
};

/** Red enough to be signalling with, rather than an incidentally warm grey. */
function isSignallingRed(hex: string): boolean {
  const [r, g, b] = expand(hex);
  return r > g && r > b && r - Math.max(g, b) >= 24;
}

describe('contrast maths', () => {
  // The transcription above is the only thing standing behind every ratio in this file and in
  // styles.scss's comments, and a subtly wrong one would agree with itself forever. These anchors
  // are published values, so they fail if it drifts.
  it('reproduces published reference ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#b3261e', '#b3261e')).toBeCloseTo(1, 5);
  });

  it('still measures the defect from issue #116 at the ratio observed in a live render', () => {
    // Reported off a real page: body resolved to rgb(18,18,18), error text to rgb(179,38,30).
    expect(contrastRatio('#b3261e', CANVAS.chromeDark)).toBeCloseTo(2.87, 2);
  });

  it('expands three-digit hex the way a browser does', () => {
    expect(relativeLuminance('#fff')).toBe(relativeLuminance('#ffffff'));
  });
});

describe('--color-error', () => {
  it('clears AA for normal text on the light canvas', () => {
    const { light } = declaredErrorColours();
    expect(contrastRatio(light, CANVAS.light)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it.each([
    ['Chrome', CANVAS.chromeDark],
    ['the lightest major browser', CANVAS.lightestDark],
  ])('clears AA for normal text on the dark canvas of %s', (_browser, canvas) => {
    // Both, not just Chrome's: #2b2a33 is lighter, so a value tuned to #121212 alone can still
    // land under AA there. That is the mistake --color-text-muted's comment already warns about.
    const { dark } = declaredErrorColours();
    expect(contrastRatio(dark, canvas)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('is a different value per scheme', () => {
    // No single value clears AA on both canvases. If these ever match, the flip has been lost and
    // one of the two schemes is failing whatever the assertions above report.
    const { light, dark } = declaredErrorColours();
    expect(dark).not.toBe(light);
  });
});

describe('component stylesheets', () => {
  const sources = componentStyleSources();

  it('were actually found and read', () => {
    // Without this, a wrong cwd or a moved directory turns the check below into a no-op that
    // passes by scanning nothing at all.
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(sources.some((s) => s.css.includes('var(--color-error)'))).toBe(true);
  });

  it('signal errors through the token, never a hard-coded red', () => {
    // A literal in a component is out of reach of the prefers-color-scheme block in styles.scss,
    // which is exactly how #b3261e stayed at 2.87:1 in dark mode across four components.
    const named = /:\s*(red|crimson|firebrick|darkred|indianred|tomato|orangered|salmon)\b/gi;
    const offenders = sources.flatMap(({ file, css }) => {
      const hexes = [...css.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g)].map((m) =>
        m[0].toLowerCase(),
      );
      const words = [...css.matchAll(named)].map((m) => m[1].toLowerCase());
      return [...hexes.filter(isSignallingRed), ...words]
        .filter((colour) => !(colour in ALLOWED_FIXED_REDS))
        .map((colour) => file + ': ' + colour);
    });

    expect(offenders).toEqual([]);
  });
});
