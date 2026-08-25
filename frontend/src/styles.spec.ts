import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The error colour shipped at 2.87:1 on a dark canvas through three review rounds and 193 tests
 * (issue #116). Nothing caught it because nothing could: every check on those regions was a DOM
 * assertion, and the DOM was right the whole time -- it was the colour that was wrong. Then it
 * happened again: --color-border shipped as #ccc, a correct 1.61:1 hairline on white and an
 * 11.67:1 white box on the dark canvas, drawing 16 strokes across the site (issue #152).
 *
 * So this file does not assert on rendered output. It reads the stylesheets as text and checks the
 * things that actually failed: that every declared token clears the threshold that applies to what
 * it is *for*, on both of the grounds it will be painted on, and that no component has gone back to
 * hard-coding a colour of its own. A literal in a component cannot be flipped per scheme, which is
 * the whole mechanism by which #b3261e ended up unreadable.
 *
 * Since 2026-08-22 it also guards the type layer, for the same reason: #152's other three defects
 * were a missing scale, headings inheriting body leading, and the tag chips falling to the UA's
 * Arial 13.3333px. All three are declarations, none of them is visible to a DOM assertion, and
 * jsdom performs no layout so no rendered measurement could see them either.
 */

const AA_NORMAL_TEXT = 4.5;
/** WCAG 2.2 SC 1.4.11 / 2.4.7: non-text UI boundaries and focus indicators. */
const NON_TEXT_CONTRAST = 3;
/**
 * A hairline is supposed to be quiet. There is no WCAG floor here -- a decorative rule is exempt
 * from 1.4.11 precisely because it is not the sole indicator of anything -- so the threshold that
 * matters is an upper one: past this the stroke stops reading as a line and starts reading as a
 * box, which is #152's defect restated as a number.
 */
const HAIRLINE_MAX = 2.5;

const REPO_STYLES = join(process.cwd(), 'src', 'styles.scss');
const INDEX_HTML = join(process.cwd(), 'src', 'index.html');
const FONT_DIR = join(process.cwd(), 'public', 'fonts');
const COMPONENT_ROOT = join(process.cwd(), 'src', 'app');
const PROJECTS_LIST_STYLES = join(
  COMPONENT_ROOT,
  'features',
  'projects',
  'projects-list',
  'projects-list.component.scss',
);

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

interface Rule {
  selector: string;
  body: string;
}

/**
 * Splits a stylesheet into its top-level `selector { body }` pairs, tracking brace depth so a
 * nested block (`@media`, or SCSS nesting in a component file) is returned whole as one rule rather
 * than being cut at its first inner `}`. Querying by selector rather than by line number is what
 * keeps these assertions readable when the file moves around.
 */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  let depth = 0;
  let start = 0;
  let selectorStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) {
        found.push({ selector: css.slice(selectorStart, i).trim(), body: '' });
        start = i + 1;
      }
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        found[found.length - 1].body = css.slice(start, i);
        selectorStart = i + 1;
      }
    }
  }
  return found.filter((r) => r.selector !== '');
}

const normaliseSelector = (selector: string) => selector.replace(/\s+/g, ' ').trim();

function ruleFor(css: string, selector: string): Rule {
  const wanted = normaliseSelector(selector);
  const match = rules(css).find((r) => normaliseSelector(r.selector) === wanted);
  expect(match, 'no rule found for selector: ' + selector).toBeDefined();
  return match!;
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    map.set(name.trim(), value.trim());
  }
  return map;
}

const globalCss = () => stripComments(readFileSync(REPO_STYLES, 'utf8'));

/**
 * Every custom property, with the value each scheme resolves it to. A token declared only in
 * `:root` resolves to the same value on both grounds -- which is not an error in itself (some
 * values genuinely do not need to flip) but IS the shape both #116 and #152 took, so the checks
 * below always measure both schemes rather than trusting that a shared value is a safe one.
 */
function tokens(): Map<string, { light: string; dark: string }> {
  const css = globalCss();
  const darkQuery = rules(css).find((r) => /@media[^{]*prefers-color-scheme:\s*dark/.test(r.selector));
  expect(darkQuery, 'the prefers-color-scheme: dark block is missing from styles.scss').toBeDefined();

  const light = declarations(ruleFor(css, ':root').body);
  const dark = declarations(ruleFor(darkQuery!.body, ':root').body);

  const map = new Map<string, { light: string; dark: string }>();
  for (const [name, value] of light) {
    if (name.startsWith('--')) map.set(name, { light: value, dark: dark.get(name) ?? value });
  }
  for (const name of dark.keys()) {
    expect(map.has(name), name + ' is declared in the dark block but never in :root').toBe(true);
  }
  return map;
}

function hexToken(name: string): { light: string; dark: string } {
  const all = tokens();
  const value = all.get(name);
  expect(value, name + ' is not declared in :root').toBeDefined();
  for (const scheme of ['light', 'dark'] as const) {
    expect(value![scheme], name + ' (' + scheme + ') is not a plain hex colour').toMatch(
      /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/,
    );
  }
  return { light: value!.light.toLowerCase(), dark: value!.dark.toLowerCase() };
}

/** The two colours anything on this site is ever painted on, per scheme. */
function grounds(): { light: string[]; dark: string[] } {
  const bg = hexToken('--color-bg');
  const surface = hexToken('--color-surface');
  return { light: [bg.light, surface.light], dark: [bg.dark, surface.dark] };
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
    expect(contrastRatio('#b3261e', '#121212')).toBeCloseTo(2.87, 2);
  });

  it('still measures the defect from issue #152 on both of the grounds it was drawn on', () => {
    // The same #ccc, twice: a correct hairline on white and a hard white box on the dark canvas.
    // Both numbers matter -- the first is why nobody noticed for so long.
    expect(contrastRatio('#cccccc', '#ffffff')).toBeCloseTo(1.61, 2);
    expect(contrastRatio('#cccccc', '#121212')).toBeCloseTo(11.67, 2);
  });

  it('expands three-digit hex the way a browser does', () => {
    expect(relativeLuminance('#fff')).toBe(relativeLuminance('#ffffff'));
  });
});

// -------------------------------------------------------------------------------------------
// Colour tokens
// -------------------------------------------------------------------------------------------

/**
 * What each colour token has to clear, and against what. This table is the point of the file: the
 * 2026-08-22 ADR's rule is that no new colour may be declared without its ratios being recorded,
 * and the completeness test below turns that from an instruction into something that fails.
 */
type TokenCheck = (scheme: 'light' | 'dark') => void;

const atLeast = (fg: string, bg: string, threshold: number, what: string) => {
  const ratio = contrastRatio(fg, bg);
  expect(ratio, what + ' measured ' + ratio.toFixed(2) + ':1, needs ' + threshold + ':1').
    toBeGreaterThanOrEqual(threshold);
};

/** Text, so AA's 4.5:1, against the ground AND the card surface -- text lands on both. */
const readableOnBothGrounds = (token: string): TokenCheck => (scheme) => {
  const value = hexToken(token)[scheme];
  for (const ground of grounds()[scheme]) {
    atLeast(value, ground, AA_NORMAL_TEXT, token + ' (' + scheme + ') on ' + ground);
  }
};

const CHECKS: Record<string, TokenCheck> = {
  // The grounds themselves: checked as the thing everything else is measured against, and against
  // each other, since a card that matches the page exactly is not a surface at all.
  '--color-bg': (scheme) => {
    const bg = hexToken('--color-bg')[scheme];
    const surface = hexToken('--color-surface')[scheme];
    expect(bg, 'the ground and the card surface are the same colour').not.toBe(surface);
  },
  '--color-surface': (scheme) => {
    // Deliberately a *ceiling*: the card is meant to read as a lifted plane, not as a panel with a
    // different paint job. If this ever climbs, the hairline's low ratio stops being the design and
    // starts being an accident.
    const ratio = contrastRatio(
      hexToken('--color-surface')[scheme],
      hexToken('--color-bg')[scheme],
    );
    expect(ratio, 'card surface is ' + ratio.toFixed(2) + ':1 against the ground').toBeLessThan(1.4);
  },

  '--color-text': readableOnBothGrounds('--color-text'),
  '--color-text-muted': (scheme) => {
    readableOnBothGrounds('--color-text-muted')(scheme);
    // It doubles as the boundary of every control -- an input, a tag chip -- where WCAG 1.4.11
    // wants 3:1 of the one thing saying "this is a control". Clearing AA for text clears that too,
    // but stating it separately is what stops someone lightening it for a softer hint and
    // silently taking every input outline with them.
    for (const ground of grounds()[scheme]) {
      atLeast(hexToken('--color-text-muted')[scheme], ground, NON_TEXT_CONTRAST, 'control boundary');
    }
  },
  '--color-accent': readableOnBothGrounds('--color-accent'),
  '--color-error': readableOnBothGrounds('--color-error'),

  '--color-hairline': (scheme) => {
    const value = hexToken('--color-hairline')[scheme];
    for (const ground of grounds()[scheme]) {
      const ratio = contrastRatio(value, ground);
      expect(
        ratio,
        'hairline is ' + ratio.toFixed(2) + ':1 on ' + ground + ' -- that is a box, not a line',
      ).toBeLessThanOrEqual(HAIRLINE_MAX);
    }
  },

  '--color-focus': (scheme) => {
    // The answer the ADR left open. A ring drawn at outline-offset always has the ground or the
    // card surface on both sides of it, never the fill of the control it surrounds, so these two
    // are the adjacencies SC 1.4.11 and 2.4.7 are asking about.
    for (const ground of grounds()[scheme]) {
      atLeast(
        hexToken('--color-focus')[scheme],
        ground,
        NON_TEXT_CONTRAST,
        'focus ring (' + scheme + ') on ' + ground,
      );
    }
  },

  '--color-on-accent': (scheme) => {
    atLeast(
      hexToken('--color-on-accent')[scheme],
      hexToken('--color-accent')[scheme],
      AA_NORMAL_TEXT,
      'button label on the accent fill (' + scheme + ')',
    );
  },

  '--color-surface-danger': (scheme) => {
    for (const ground of grounds()[scheme]) {
      atLeast(
        hexToken('--color-surface-danger')[scheme],
        ground,
        NON_TEXT_CONTRAST,
        'danger fill (' + scheme + ') on ' + ground,
      );
    }
  },
  '--color-on-danger': (scheme) => {
    atLeast(
      hexToken('--color-on-danger')[scheme],
      hexToken('--color-surface-danger')[scheme],
      AA_NORMAL_TEXT,
      'label on the danger fill (' + scheme + ')',
    );
  },

  '--color-surface-notice': (scheme) => {
    for (const ground of grounds()[scheme]) {
      atLeast(
        hexToken('--color-surface-notice')[scheme],
        ground,
        NON_TEXT_CONTRAST,
        'toast surface (' + scheme + ') on ' + ground,
      );
    }
  },
  '--color-on-notice': (scheme) => {
    atLeast(
      hexToken('--color-on-notice')[scheme],
      hexToken('--color-surface-notice')[scheme],
      AA_NORMAL_TEXT,
      'toast text (' + scheme + ')',
    );
  },
};

/**
 * Not a hex, so it cannot be run through the formula: it is a semi-transparent grey that
 * composites against whichever ground is live. Its two composites are asserted separately below,
 * which is why it is listed here rather than being silently skipped.
 */
const NON_HEX_COLOUR_TOKENS = ['--color-surface-muted'];

describe('colour tokens', () => {
  it('has a check for every colour token that exists', () => {
    // The ADR's rule -- "every new colour is defined per scheme with its computed ratio recorded"
    // -- made mechanical. Adding a token without deciding what it has to clear fails here, which
    // is the only moment anyone is thinking about it.
    const declared = [...tokens().keys()].filter((name) => name.startsWith('--color-')).sort();
    expect(declared).toEqual([...Object.keys(CHECKS), ...NON_HEX_COLOUR_TOKENS].sort());
  });

  for (const [token, check] of Object.entries(CHECKS)) {
    it.each([['light'], ['dark']] as const)(token + ' holds on the %s scheme', (scheme) => {
      check(scheme);
    });
  }

  it('flips every token that cannot survive being one value on both grounds', () => {
    // The #116/#152 shape, stated directly: these five were each chosen against one ground, and a
    // single value cannot clear its threshold on both. If any pair here ever matches, the flip has
    // been lost and one scheme is failing whatever the per-scheme assertions above report.
    for (const token of [
      '--color-bg',
      '--color-text',
      '--color-text-muted',
      '--color-accent',
      '--color-error',
      '--color-hairline',
      '--color-surface',
      '--color-focus',
      '--color-on-accent',
      '--color-surface-danger',
      '--color-surface-notice',
      '--color-on-notice',
    ]) {
      const { light, dark } = hexToken(token);
      expect(dark, token + ' is the same value on both grounds').not.toBe(light);
    }
  });

  it('keeps the composited muted surface readable on both grounds', () => {
    const value = tokens().get('--color-surface-muted');
    const match = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%\s*\)/.exec(value?.light ?? '');
    expect(match, '--color-surface-muted is no longer an rgb() with an alpha percentage').not.toBeNull();
    const [r, g, b] = [1, 2, 3].map((i) => Number(match![i]));
    const alpha = Number(match![4]) / 100;

    for (const scheme of ['light', 'dark'] as const) {
      const ground = expand(hexToken('--color-bg')[scheme]);
      const composited =
        '#' +
        [r, g, b]
          .map((c, i) => Math.round(alpha * c + (1 - alpha) * ground[i]))
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('');
      atLeast(hexToken('--color-text')[scheme], composited, AA_NORMAL_TEXT, 'ink on muted surface');
      atLeast(
        hexToken('--color-text-muted')[scheme],
        composited,
        AA_NORMAL_TEXT,
        'muted text on muted surface',
      );
    }
  });

  it('has removed --color-border rather than adjusting it', () => {
    // It was a light-mode value drawing every dark-mode box. The rename is what makes the
    // replacement visible at all 16 call sites instead of leaving a token whose name says
    // "any border" and whose value only ever suited one of them.
    expect(tokens().has('--color-border')).toBe(false);
    const offenders = componentStyleSources()
      .filter(({ css }) => css.includes('--color-border'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// Type
// -------------------------------------------------------------------------------------------

const SCALE = ['--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl'];

const remValue = (token: string): number => {
  const raw = tokens().get(token)?.light ?? '';
  const match = /^([\d.]+)rem$/.exec(raw);
  expect(match, token + ' is not declared in rem (got ' + JSON.stringify(raw) + ')').not.toBeNull();
  return Number(match![1]);
};

describe('type scale', () => {
  it('is a scale: every step is larger than the one below it', () => {
    const sizes = SCALE.map(remValue);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], SCALE[i] + ' is not larger than ' + SCALE[i - 1]).toBeGreaterThan(
        sizes[i - 1],
      );
    }
  });

  it('lands every step on a whole pixel at a 16px root', () => {
    for (const token of SCALE) {
      const px = remValue(token) * 16;
      expect(px, token + ' resolves to ' + px + 'px').toBe(Math.round(px));
    }
  });

  it('gives headings a size a reader can tell from body text', () => {
    // #152's second defect measured h2 at 17.6px against 16px body -- 1.1x, so a section heading
    // barely registered as one. A step this small is invisible at a glance whatever else is right
    // about it, so the floor is stated rather than left to the scale's own arithmetic.
    const body = remValue('--text-base');
    expect(remValue('--text-xl') / body).toBeGreaterThanOrEqual(1.5);
    expect(remValue('--text-2xl') / body).toBeGreaterThanOrEqual(2);
  });

  it('sets every heading level from the scale, never from a UA default', () => {
    const css = globalCss();
    const sizeOf = (selector: string) => declarations(ruleFor(css, selector).body).get('font-size');
    expect(sizeOf('h1')).toBe('var(--text-2xl)');
    expect(sizeOf('h2')).toBe('var(--text-xl)');
    expect(sizeOf('h3')).toBe('var(--text-lg)');
    expect(sizeOf('h4, h5, h6')).toBe('var(--text-md)');
  });

  it('sets body text from the scale too', () => {
    const body = declarations(ruleFor(globalCss(), 'body').body);
    expect(body.get('font-size')).toBe('var(--text-base)');
  });
});

describe('leading', () => {
  it('gives headings display leading, not body leading', () => {
    // #152's fourth defect: line-height 1.5 inherited into h1, so a 32px face carried 48px of
    // leading and read as a loose paragraph. Display type wants 1.1-1.25.
    for (const token of ['--leading-heading', '--leading-snug']) {
      const value = Number(tokens().get(token)?.light);
      expect(value, token + ' is ' + value).toBeGreaterThanOrEqual(1.1);
      expect(value, token + ' is ' + value).toBeLessThanOrEqual(1.25);
    }
  });

  it('keeps body leading looser than heading leading', () => {
    expect(Number(tokens().get('--leading-body')?.light)).toBeGreaterThan(
      Number(tokens().get('--leading-heading')?.light),
    );
  });

  it('applies the heading value to the heading rule', () => {
    // Not --leading-body, and not an inherited nothing: reverting either one is the mutation this
    // exists to catch, and both leave the scale and the token untouched.
    const heading = declarations(ruleFor(globalCss(), 'h1, h2, h3, h4, h5, h6').body);
    expect(heading.get('line-height')).toBe('var(--leading-heading)');
    expect(heading.get('font-family')).toBe('var(--font-display)');
    expect(heading.get('text-wrap')).toBe('balance');
  });
});

describe('form controls', () => {
  it('inherit the page font at the root', () => {
    // #152's third defect, systemically. A UA gives every form control its own font -- Arial
    // 13.3333px is what the tag chips fell to -- so this is not one stylesheet's oversight but the
    // default every new control inherits until something says otherwise.
    const rule = rules(globalCss()).find(
      (r) =>
        /\bbutton\b/.test(r.selector) &&
        /\binput\b/.test(r.selector) &&
        /\btextarea\b/.test(r.selector) &&
        /\bselect\b/.test(r.selector),
    );
    expect(rule, 'styles.scss has no rule resetting button/input/select/textarea').toBeDefined();
    expect(declarations(rule!.body).get('font')).toBe('inherit');
  });

  it('never restate a font family in a component except through a token', () => {
    // `font-family: monospace` was how the mono face used to be asked for, and it is exactly the
    // kind of value the design system has to own: it resolves to a different face on every
    // platform and it cannot participate in the metric-matched fallbacks.
    const offenders = componentStyleSources().flatMap(({ file, css }) =>
      [...css.matchAll(/font(?:-family)?\s*:\s*([^;]+);/g)]
        .map((m) => m[1].trim())
        .filter((value) => value !== 'inherit' && !/^var\(--font-[a-z]+\)$/.test(value))
        .map((value) => file + ': ' + value),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the tag chips', () => {
  const chipCss = () => stripComments(readFileSync(PROJECTS_LIST_STYLES, 'utf8'));

  it('are set in the mono face at a size from the scale', () => {
    // The specific element from #152 §3, on the most-repeated component of the landing page. The
    // root reset means a missing declaration here no longer lands them in Arial -- but the ADR
    // says tags are mono, and losing that is losing a design decision rather than a fallback.
    const filter = ruleFor(chipCss(), '.tag-filter');
    const chip = ruleFor(filter.body, 'button');
    const decls = declarations(chip.body);
    expect(decls.get('font-family')).toBe('var(--font-mono)');
    expect(decls.get('font-size')).toBe('var(--text-sm)');
  });

  it('carry a boundary strong enough to read as a control', () => {
    // An unselected chip has no fill and no icon, so its outline is the only thing saying it is
    // pressable -- SC 1.4.11's 3:1 case. --color-hairline would be 1.6:1 here, which is right for
    // a card edge and wrong for this.
    const chip = ruleFor(ruleFor(chipCss(), '.tag-filter').body, 'button');
    expect(declarations(chip.body).get('border')).toBe('1px solid var(--color-text-muted)');
  });
});

// -------------------------------------------------------------------------------------------
// Fonts
// -------------------------------------------------------------------------------------------

describe('self-hosted faces', () => {
  const fontFaces = () => rules(globalCss()).filter((r) => r.selector.trim() === '@font-face');

  it('serve every face from this origin, and ship the file each one names', () => {
    // The privacy argument in the ADR is only true while this holds: one `url(https://...)` and
    // visitor IPs start reaching a third party again, silently and on every page view.
    const remote = fontFaces().filter((face) => /url\(\s*['"]?https?:/.test(face.body));
    expect(remote.map((f) => f.body.trim())).toEqual([]);

    const referenced = fontFaces().flatMap((face) =>
      [...face.body.matchAll(/url\(\s*['"]?\/fonts\/([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
    );
    expect(referenced.length).toBeGreaterThanOrEqual(4);
    for (const file of referenced) {
      expect(file.endsWith('.woff2'), file + ' is not woff2').toBe(true);
      expect(existsSync(join(FONT_DIR, file)), 'missing font file: ' + file).toBe(true);
    }
  });

  it('gives every local fallback a full set of metric overrides', () => {
    // Without these a swap reflows the page, and e2e/tests/projects.spec.ts measures a rendered
    // line count. A partial set is worse than none: correcting the width but not the ascent leaves
    // a line box that changes height at the moment of the swap.
    const fallbacks = fontFaces().filter((face) => /src:\s*local\(/.test(face.body));
    expect(fallbacks.length, 'no metric-matched fallback faces found').toBeGreaterThanOrEqual(3);
    for (const face of fallbacks) {
      const decls = declarations(face.body);
      for (const descriptor of [
        'size-adjust',
        'ascent-override',
        'descent-override',
        'line-gap-override',
      ]) {
        expect(decls.get(descriptor), descriptor + ' missing from ' + decls.get('font-family')).
          toMatch(/^[\d.]+%$/);
      }
    }
  });

  it('names a fallback face in every font token, after the webfont', () => {
    const all = tokens();
    for (const [token, fallback] of [
      ['--font-display', 'Archivo Fallback'],
      ['--font-body', 'IBM Plex Sans Fallback'],
      ['--font-mono', 'IBM Plex Mono Fallback'],
    ]) {
      const stack = all.get(token)?.light ?? '';
      expect(stack, token + ' does not name ' + fallback).toContain(fallback);
      // A generic last resort after it, so a browser with no local Arial or Courier still lands
      // somewhere chosen rather than on whatever `initial` happens to be.
      expect(stack, token + ' has no generic family at the end of the stack').toMatch(
        /(sans-serif|monospace)\s*;?$/,
      );
    }
  });

  it('preloads only the two faces the first screen is set in, and nothing that does not exist', () => {
    // "Preload only what is above the fold" from the ADR. Preloading all four would just move the
    // contention; preloading a file the stylesheet does not name is a wasted request that nothing
    // would ever notice.
    const html = readFileSync(INDEX_HTML, 'utf8');
    const preloaded = [...html.matchAll(/rel="preload"[^>]*href="\/fonts\/([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(preloaded.sort()).toEqual([
      'archivo-latin-wght-normal.woff2',
      'ibm-plex-sans-latin-400-normal.woff2',
    ]);

    const declared = globalCss();
    for (const file of preloaded) {
      expect(existsSync(join(FONT_DIR, file)), 'preloads a missing file: ' + file).toBe(true);
      expect(declared, 'preloads a file no @font-face names: ' + file).toContain(file);
      // Fonts are always fetched in CORS mode, so a preload without crossorigin is a second,
      // unused request rather than a warmed cache -- and it looks identical in the markup.
      const tag = new RegExp('href="/fonts/' + file + '"[^>]*crossorigin', 's');
      expect(tag.test(html.replace(/\s+/g, ' ')), file + ' is preloaded without crossorigin').toBe(
        true,
      );
    }
  });
});

// -------------------------------------------------------------------------------------------
// Component stylesheets
// -------------------------------------------------------------------------------------------

describe('component stylesheets', () => {
  const sources = componentStyleSources();

  it('were actually found and read', () => {
    // Without this, a wrong cwd or a moved directory turns the checks below into no-ops that pass
    // by scanning nothing at all.
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(sources.some((s) => s.css.includes('var(--color-error)'))).toBe(true);
  });

  it('name every colour through a token, never a literal', () => {
    // A literal in a component is out of reach of the prefers-color-scheme block in styles.scss,
    // which is exactly how #b3261e stayed at 2.87:1 in dark mode across four components and how
    // #ccc drew 16 white boxes on the dark canvas. There is deliberately no allowlist: the two
    // literals that used to have one -- #fff on an accent fill and #7a1f1f behind it -- both
    // turned out to need flipping the moment the palette moved, which is the whole argument.
    const named =
      /:\s*(red|crimson|firebrick|darkred|indianred|tomato|orangered|salmon|white|black|gray|grey|silver|lightgray|lightgrey|darkgray|darkgrey)\b/gi;
    const offenders = sources.flatMap(({ file, css }) => {
      const hexes = [...css.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g)].map((m) => m[0]);
      const words = [...css.matchAll(named)].map((m) => m[1]);
      return [...hexes, ...words].map((colour) => file + ': ' + colour);
    });

    expect(offenders).toEqual([]);
  });

  it('never hard-code a font weight, because only two body cuts exist', () => {
    // IBM Plex Sans ships at 400 and 600 only. `font-weight: 700` on body text therefore renders
    // as the 600 cut whatever the stylesheet says -- a declaration that quietly does not mean what
    // it reads as. Naming the token is what keeps the weights declared and the weights shipped the
    // same set; adding a third cut is then one decision in one place, made against the byte cost.
    const offenders = sources.flatMap(({ file, css }) =>
      [...css.matchAll(/font-weight\s*:\s*([^;]+);/g)]
        .map((m) => m[1].trim())
        .filter((value) => !/^var\(--weight-[a-z]+\)$/.test(value) && value !== 'inherit')
        .map((value) => file + ': ' + value),
    );
    expect(offenders).toEqual([]);
  });

  it('never hard-code a font size a step of the scale should own', () => {
    // 0.85rem, 0.9rem and 1.1rem were all in here, and none of them was on any scale -- they were
    // each picked once, next to the thing they were shrinking. That is how #152 §2 happened.
    const offenders = sources.flatMap(({ file, css }) =>
      [...css.matchAll(/font-size\s*:\s*([^;]+);/g)]
        .map((m) => m[1].trim())
        .filter((value) => !/^var\(--text-[\w-]+\)$/.test(value) && value !== 'inherit')
        .map((value) => file + ': ' + value),
    );
    expect(offenders).toEqual([]);
  });
});
