/**
 * Turns a project's full `description` into the short summary the list card shows -- issue #86.
 *
 * `description` is plain text, up to 5000 characters (docs/openapi.yaml), with blank lines as
 * paragraph breaks and no Markdown. The list card used to interpolate all of it, which is fine for
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
 * The first paragraph is taken whole rather than the first N characters of the description,
 * because a paragraph is the smallest unit of this content that is written to stand on its own --
 * docs/CONTENT_DRAFT.md (branch `phase6/content-draft`) says each drafted entry's opening
 * paragraph was written as exactly that. Falling straight to a character cut would routinely
 * splice the end of one paragraph onto the start of the next.
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
 * Sized to comfortably exceed what the CSS clamp can show, not to match it: the page is capped at
 * 60rem (`app.scss`), which gives roughly 100-120 visible characters across three clamped lines at
 * the default font size, and fewer as text is zoomed. Leaving that headroom is deliberate -- the
 * stylesheet decides what is visible, and it must never run out of text before it runs out of
 * lines, or the clamp would silently do nothing on wide cards.
 */
export const CARD_EXCERPT_MAX_CHARS = 200;

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
  return `${cutAtWordBoundary(text, maxChars)}…`;
}

/**
 * Cuts to at most `maxChars`, backing up to the last word break so the summary does not end
 * mid-word. A word break is only honoured in the second half of the budget: a single unbroken
 * token near the start (a URL, a long identifier) would otherwise collapse the excerpt to a few
 * characters, and a hard cut of a long token is the better of the two bad options there.
 */
function cutAtWordBoundary(text: string, maxChars: number): string {
  const head = text.slice(0, maxChars);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace >= maxChars / 2 ? head.slice(0, lastSpace) : head;
  return cut.replace(TRAILING_PUNCTUATION, '');
}
