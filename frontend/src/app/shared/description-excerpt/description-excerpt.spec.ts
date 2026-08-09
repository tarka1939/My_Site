import { CARD_EXCERPT_MAX_CHARS, toCardExcerpt } from './description-excerpt';
import { DescriptionExcerptPipe } from './description-excerpt.pipe';

describe('toCardExcerpt', () => {
  it('returns a short description unchanged, with no ellipsis', () => {
    expect(toCardExcerpt('A DSP project.')).toBe('A DSP project.');
  });

  it('keeps only the first paragraph of a multi-paragraph description', () => {
    const description = [
      'A cross-platform, system-level audio equalizer built around a shared C++17 DSP core.',
      'The DSP core is platform-agnostic, with RBJ peaking biquad filters.',
      'CurveGen, the Python side, takes a WAV measurement.',
    ].join('\n\n');

    expect(toCardExcerpt(description)).toBe(
      'A cross-platform, system-level audio equalizer built around a shared C++17 DSP core.',
    );
  });

  it('treats a blank line carrying spaces or a CRLF as a paragraph break', () => {
    expect(toCardExcerpt('First paragraph.\r\n \r\nSecond paragraph.')).toBe('First paragraph.');
  });

  it('collapses hard newlines inside a paragraph rather than keeping the source wrapping', () => {
    // The card renders with the default `white-space`, so these would collapse on screen anyway --
    // what matters is that the length check below measures the laid-out string, not the source.
    expect(toCardExcerpt('One line\nwrapped over\nthree.')).toBe('One line wrapped over three.');
  });

  it('cuts an over-long first paragraph at a word boundary and marks it with an ellipsis', () => {
    const paragraph = 'word '.repeat(100).trim(); // 499 characters

    const excerpt = toCardExcerpt(paragraph);

    expect(excerpt.length).toBeLessThanOrEqual(CARD_EXCERPT_MAX_CHARS + 1);
    expect(excerpt.endsWith('…')).toBe(true);
    // Cut at a space, so the last kept word is whole -- no "wor…".
    expect(excerpt.slice(0, -1)).toBe('word '.repeat(40).trim());
  });

  it('drops trailing punctuation so the cut does not read as a typo', () => {
    const excerpt = toCardExcerpt(`${'padding '.repeat(24)}tail, and more text beyond the cap`);

    expect(excerpt.endsWith(',…')).toBe(false);
    expect(excerpt.endsWith('tail…')).toBe(true);
  });

  it('hard-cuts a single unbroken token rather than collapsing to nothing', () => {
    // A 400-character URL-like token has no word break to back up to; backing up to the space
    // before it would leave an excerpt of two words for a paragraph that has plenty of text.
    const excerpt = toCardExcerpt(`See ${'x'.repeat(400)} for details`);

    expect(excerpt.length).toBe(CARD_EXCERPT_MAX_CHARS + 1);
    expect(excerpt.startsWith('See xxx')).toBe(true);
  });

  it('returns an empty string for empty, blank, null and undefined descriptions', () => {
    // The caller renders no element at all for these rather than an empty paragraph.
    expect(toCardExcerpt('')).toBe('');
    expect(toCardExcerpt('   \n\n  ')).toBe('');
    expect(toCardExcerpt(null)).toBe('');
    expect(toCardExcerpt(undefined)).toBe('');
  });

  it('honours an explicit cap', () => {
    expect(toCardExcerpt('one two three four five', 12)).toBe('one two…');
    expect(toCardExcerpt('one two three', 0)).toBe('');
  });
});

describe('DescriptionExcerptPipe', () => {
  it('applies the default cap through the pipe', () => {
    const pipe = new DescriptionExcerptPipe();
    const paragraph = 'word '.repeat(100).trim();

    expect(pipe.transform('A DSP project.')).toBe('A DSP project.');
    expect(pipe.transform(paragraph)).toBe(`${'word '.repeat(40).trim()}…`);
    expect(pipe.transform(paragraph).length).toBeLessThanOrEqual(CARD_EXCERPT_MAX_CHARS + 1);
  });
});
