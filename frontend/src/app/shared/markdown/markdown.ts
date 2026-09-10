import MarkdownIt from 'markdown-it';

/**
 * Project descriptions, rendered (#206).
 *
 * <h2>Why a library rather than a few regexes</h2>
 *
 * Markdown looks like a formatting problem and is a parsing one: emphasis nesting, code spans that
 * must suppress every other rule inside them, list continuation, and the difference between a link
 * and a bracket someone typed. A hand-rolled subset gets the common cases right, and the cases it
 * gets wrong are silent -- an admin writes something reasonable and the page renders something
 * else. This project already hand-rolls what is genuinely bounded (the artwork generator, the
 * excerpt pipe); a grammar is not that.
 *
 * <h2>The two things `html: false` buys</h2>
 *
 * It escapes raw HTML in the source instead of passing it through, so `<script>` in a description
 * reaches the DOM as visible text rather than as markup. That matters even though only the admin
 * can write a description, because it is the difference between one control and none: Angular's
 * `[innerHTML]` sanitizer is the other layer, and two layers means neither one failing is
 * immediately an XSS.
 *
 * **Never render this through `bypassSecurityTrustHtml`.** That call is the single thing that turns
 * this file from safe into a sink -- it tells Angular to skip the sanitizer entirely, which is the
 * layer this one is deliberately paired with. Bind `[innerHTML]` to the string and let Angular
 * sanitize; it strips `<script>`, `on*` handlers and `javascript:` URLs on the way in.
 *
 * <h2>The subset, and what is left out on purpose</h2>
 *
 * Every construct is a rendering surface that has to be styled and looked at, so this enables what
 * a project description actually uses and nothing else. `image` is disabled because a project's
 * pictures have their own `images` field with its own alt-text handling (#87) -- a second, unalted
 * path to an `<img>` would quietly bypass that. `table` is disabled because a table wide enough to
 * be worth writing does not fit the detail column and would need horizontal-scroll handling nobody
 * has asked for.
 *
 * `linkify` is off so a bare URL stays text: descriptions cite repository paths and flags, and
 * auto-linking turns a fragment someone typed into a live link they did not write. `breaks` is off
 * so a single newline is not a `<br>` -- the seeded content wraps its source at column 100, and
 * turning those into hard breaks would render every paragraph as a ragged column.
 */
const renderer = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  typographer: false,
}).disable(['image', 'table']);

/**
 * A description as HTML, for binding through `[innerHTML]` -- never through `bypassSecurityTrust*`.
 *
 * Returns `''` for absent input rather than throwing, because a description is optional in the
 * contract and a missing one is an ordinary state, not an error.
 */
export function renderMarkdown(source: string | null | undefined): string {
  if (!source) {
    return '';
  }
  return renderer.render(source);
}

/**
 * The same text with every mark removed -- the faithful flattening, headings included.
 *
 * Rendering and then stripping, rather than pattern-matching the source. The point is that this
 * agrees with {@link renderMarkdown} by construction: one parser decides what a construct is, and
 * a second implementation would drift from it exactly where the syntax is hard, which is where
 * being wrong is least visible. Stripping tags from arbitrary HTML would be unsafe, but this is
 * not arbitrary -- it is the output of a parser with `html: false`, so the only tags present are
 * ones the renderer emitted.
 *
 * Block ends become blank lines so a paragraph structure survives the round trip.
 *
 * For a *summary* -- a card excerpt, a meta description -- use {@link markdownToSummaryText}
 * instead. See there for why the difference matters.
 */
export function markdownToPlainText(source: string | null | undefined): string {
  if (!source) {
    return '';
  }
  return stripToText(renderer.render(source));
}

/**
 * Flattened text with heading blocks dropped -- the right input for anything that takes the first
 * paragraph and calls it a summary.
 *
 * **Why this is not just {@link markdownToPlainText}.** Both summary consumers -- the list card's
 * excerpt and `<meta name="description">` -- take the first paragraph of the flattened text. A
 * description that opens with `## What it does`, which is the natural way to write one, makes that
 * first paragraph the heading: a fourteen-character meta description reading "What it does", and a
 * card whose summary says nothing about the project. Caught by looking at a rendered page, not by
 * a test -- every unit test passed with the heading in place, because each one asserted that
 * flattening was *faithful*, which it was.
 *
 * Dropping headings rather than skipping to the first paragraph that "looks like prose": the rule
 * stays something a reader can predict, and a description that is nothing but headings correctly
 * summarises to nothing rather than to an arbitrary one of them.
 */
export function markdownToSummaryText(source: string | null | undefined): string {
  if (!source) {
    return '';
  }
  return stripToText(renderer.render(source).replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g, ''));
}

/**
 * Rendered HTML to text. Shared so the two flatteners cannot disagree about anything except which
 * blocks they were given.
 */
function stripToText(html: string): string {
  return decodeEntities(
    html
      // `</li>` closes to a *single* newline while every other block closes to a blank line, and
      // the difference decides what a summary says. `toCardExcerpt` splits on a blank line to
      // take the first paragraph, so closing list items to `\n\n` makes each bullet its own
      // paragraph and a description opening with a list summarises to its first bullet alone.
      // `</ul>`/`</ol>` still supply the blank line, so the list as a whole is still a block.
      // The trailing newline is consumed here for the same reason it is on `<br>` below:
      // markdown-it emits `</li>\n`, so replacing the tag alone still leaves `\n\n`.
      .replace(/<\/li>\n?/g, '\n')
      .replace(/<\/(p|h[1-6]|blockquote|pre|ol|ul)>/g, '\n\n')
      // The trailing newline is consumed deliberately: markdown-it emits `<br>\n` for a hard
      // break, so mapping the tag alone leaves `\n\n` behind -- a blank line, which every
      // paragraph-splitting caller then reads as a paragraph boundary. Two trailing spaces in the
      // opening sentence would silently truncate a card excerpt and a meta description there,
      // which is exactly what markdownToSummaryText exists to have stopped happening.
      .replace(/<br\s*\/?>\n?/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Undo the escaping the renderer applied.
 *
 * A fixed table rather than a DOM round trip (`element.innerHTML = ...; return textContent`).
 * markdown-it escapes exactly these five, so the table is complete for this input, and keeping the
 * function pure is what lets it be tested without a DOM -- the same reason the artwork generator is
 * split from its component. A DOM round trip would also mean assigning attacker-influenced text to
 * `innerHTML` to *un*-escape it, which is a strange shape to have anywhere near a sanitiser.
 */
function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  // `&amp;` last would double-decode `&amp;lt;` into `<`; the alternation handles each once.
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (match) => entities[match] ?? match);
}
