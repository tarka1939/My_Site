/**
 * Turns a project's full `description` into the short summary the list card shows -- issue #86.
 *
 * **This takes plain text and deliberately knows nothing about Markdown.** `description` is
 * Markdown since #206, and the flattening happens in the *caller* -- `DescriptionExcerptPipe` for
 * the card, `ProjectDetailComponent` for the meta tag. That split is not tidiness: `core/seo/
 * site-meta.ts` imports this function and is in the eager graph, so importing the renderer here
 * pulled all of markdown-it into the initial bundle and put it 9.5 kB over its 400 kB error
 * budget. Keeping this module text-only is what keeps a ~100 kB parser in the lazy chunks that
 * actually render.
 *
 * The list card used to interpolate all of it, which is fine for
 * the one-line fixtures Phases 3-4 ran on and unusable for real entries of 1000-2400 characters:
 * every card becomes a wall of text and the grid stops communicating anything.
 *
 * Two independent limits do the clamping, and they are not redundant:
 *
 *  - **This function caps the text that reaches the DOM.** A CSS clamp only hides overflow
 *    visually; the full 2400 characters would still sit in the accessibility tree and be announced
 *    for every card, so a screen-reader user would get the exact "wall of text" problem the visual
 *    fix removes. It is also 12 x 2400 characters of markup on a page that shows none of it.
 *  - **The stylesheet caps the rendered *lines*** (`line-clamp` on `.card-description`). A
 *    character count cannot know how many lines it becomes -- that depends on card width, font
 *    size and the user's zoom -- so the visual tidiness of the grid has to be enforced in lines,
 *    not characters.
 *
 * So this is the fallback bound and the payload bound; the stylesheet is the layout bound. Neither
 * destroys anything: the detail page still renders `description` in full, and the card links to it.
 *
 * The first paragraph is taken whole rather than the first N characters of the description:
 * docs/CONTENT_DRAFT.md (branch `phase6/content-draft`) says each drafted entry's opening
 * paragraph was written to stand on its own, and a blind character cut would routinely splice the
 * end of one paragraph onto the start of the next. What the paragraph unit buys is that a cut
 * never runs *past* a paragraph boundary -- not that there is never a cut. The paragraph is not
 * automatically short enough: one of the five drafted openers is 287 characters and is still cut
 * by the cap below.
 */

/**
 * A blank line -- the paragraph break this content uses (see the `white-space: pre-wrap` note in
 * the detail component's SCSS). Tolerates CRLF and a "blank" line that carries spaces or tabs.
 */
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/;

/** Trailing punctuation that reads as a typo immediately before an ellipsis ("word,…"). */
const TRAILING_PUNCTUATION = /[\s.,;:!?–—-]+$/;

/**
 * Characters of description text a card may carry, excluding the appended ellipsis.
 *
 * Sized to sit *above* what the CSS clamp can show, so the stylesheet is normally what decides the
 * visible cut and this is the fallback bound on the payload. Measured in headless Chromium against
 * the real drafted copy, at the site's own font stack and default text size:
 *
 * | card                                          | description box | prose in 3 lines |
 * |-----------------------------------------------|-----------------|------------------|
 * | 3 columns, page at its 60rem max width        | 259 px          | 101-103 chars    |
 * | 1 column, viewport 567 px -- the widest card  | 501 px          | 200 chars        |
 *
 * **Those two rows were measured against a grid that no longer exists, and are kept as the record
 * of how the 240 was chosen rather than as a current description of the page.** #205 raised
 * `.project-grid` from `minmax(16rem, 1fr)` to `minmax(20rem, 1fr)`, so at the 60rem page there
 * are now **two** 452 px columns rather than three 293 px ones, and the description box is about
 * 420 px rather than 259 px (card width less the card's 1rem padding either side; the column width
 * was measured in a browser, the box derived from it).
 *
 * The per-line character counts have **not** been re-measured at the new widths, and the numbers
 * above should not be scaled in your head to guess them -- characters per line is a function of
 * the glyphs, as the paragraph below says. What can be said without measuring is the direction:
 * a wider box fits more prose in three lines, so the CSS clamp cuts later, and the 240 cap is
 * correspondingly *more* likely to be what binds first. That is the failure mode this comment
 * already treats as mild, not the one it warns about -- the warning was that the cap and the
 * clamp could coincide and leave the clamp with nothing to do, and widening the box moves them
 * further apart at the three-column end, not closer.
 *
 * **The widest card is still not the widest viewport**, which is what an earlier version of this
 * comment got wrong and is worth keeping. `.project-grid` sits inside a `main` of
 * `min(100vw, 60rem)` less 2rem of padding, with a 1.5rem gap, so two 20rem columns now need
 * 664 px of content width instead of 536 px: the grid collapses to one full-width column at a
 * wider viewport than before, and there a single card spans the whole container. Whoever
 * re-measures should measure *that* card, not the widest screen.
 *
 * **This is a sizing heuristic, not a guarantee.** Characters per line depends on the glyphs -- the
 * same 501 px box holds 325 characters of narrow text ("il1 tif jil ...") against 132 of wide
 * ("MWQ WMO ..."), so no fixed character count can dominate it for every input. When the cap does
 * bind first the consequence is mild: the reader sees this function's "…" rather than the
 * browser's, the payload is still bounded, and the detail page still carries the full text. What
 * the headroom buys is that the clamp is not routinely a no-op -- at 200 the cap and the widest
 * card's measured three-line capacity were the same number, leaving the clamp nothing to do there.
 *
 * 240 rather than a tighter number for a second reason: it clears four of the five drafted first
 * paragraphs (129, 164, 171 and 204 characters), so those reach the card whole, which is the point
 * of taking the paragraph as the unit at all. Only System Equalizer's 287-character opener is cut.
 * At 200 it was two of five, one of them losing a single word.
 */
export const CARD_EXCERPT_MAX_CHARS = 240;

/**
 * The card summary for a description: its first paragraph, whitespace collapsed, cut at a word
 * boundary to {@link CARD_EXCERPT_MAX_CHARS} with an ellipsis if it is longer than that.
 *
 * Returns an empty string for empty or whitespace-only input, so callers can skip the element
 * entirely rather than rendering an empty paragraph. (The contract requires `minLength: 1`, so
 * that case should be unreachable; it is handled rather than trusted.)
 */
export function toCardExcerpt(
  description: string | null | undefined,
  maxChars: number = CARD_EXCERPT_MAX_CHARS,
): string {
  const firstParagraph = (description ?? '').trim().split(PARAGRAPH_BREAK, 1)[0] ?? '';

  // Collapse the newlines *inside* the paragraph too. The card renders with the default
  // `white-space`, so the browser would collapse them anyway -- doing it here means the length
  // check below measures the string that will actually be laid out, not the source formatting.
  const text = firstParagraph.replace(/\s+/g, ' ').trim();

  if (maxChars < 1) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }

  const cut = cutAtWordBoundary(text, maxChars);
  // A cut made entirely of punctuation or whitespace strips to nothing -- an opening paragraph
  // that begins with an ASCII rule ("-----...") does it. Appending the ellipsis regardless would
  // render a card whose whole description is "…", which is truthy and so sails through the
  // template's `@if (… ; as excerpt)` guard. Say nothing instead.
  return cut ? `${cut}…` : '';
}

/**
 * Cuts to at most `maxChars`, backing up to the last word break so the summary does not end
 * mid-word. A word break is only honoured in the second half of the budget: a single unbroken
 * token near the start (a URL, a long identifier) would otherwise collapse the excerpt to a few
 * characters, and a hard cut of a long token is the better of the two bad options there.
 */
function cutAtWordBoundary(text: string, maxChars: number): string {
  const head = cutAtCodePoint(text, maxChars);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace >= maxChars / 2 ? head.slice(0, lastSpace) : head;
  return cut.replace(TRAILING_PUNCTUATION, '');
}

/**
 * Cuts to at most `maxChars` on a whole code point.
 *
 * `slice` counts UTF-16 code units, so a cut landing between the halves of a surrogate pair leaves
 * an unpaired surrogate, which renders as the replacement glyph. A high surrogate at the end of the
 * head is always unpaired -- its partner sits at index `maxChars`, outside the slice -- so dropping
 * it is enough. Only the hard-cut path can reach this (a word cut lands on a space, and a space is
 * never half of a pair), so it takes an unbroken token longer than the cap with an astral character
 * exactly at the boundary: a long URL or identifier carrying an emoji, or text in one of the
 * scripts that live above the BMP.
 */
function cutAtCodePoint(text: string, maxChars: number): string {
  const head = text.slice(0, maxChars);
  const lastUnit = head.charCodeAt(head.length - 1);
  const endsMidPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return endsMidPair ? head.slice(0, -1) : head;
}
