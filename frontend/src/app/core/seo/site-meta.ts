import { toCardExcerpt } from '../../shared/description-excerpt/description-excerpt';

/**
 * Site-level SEO constants and the one text transform the meta tags need.
 *
 * The runtime counterpart of the static tags in `src/index.html` -- see the 2026-08-10 SEO ADR in
 * `docs/DECISIONS.md` for why there are two layers at all (social scrapers do not execute JS, so
 * the static set is what a shared link actually previews as; Googlebot does, so it gets per-route
 * accuracy on top).
 */

/** The site's name: `og:site_name`, and the prefix every route title carries. Not a full title. */
export const SITE_NAME = 'Krzysztof Tarka';

/**
 * The site's own document title -- what a page that names nothing more specific is called.
 *
 * **Must match `index.html`'s `<title>`, `og:title` and `twitter:title`, which are all this
 * string.** They used to disagree: the static `<title>` was the bare {@link SITE_NAME} while the
 * share tags carried this longer form, so a non-JS consumer got two different names for one
 * document -- the `<title>` a search result prints, and the `og:title` a shared link previews as.
 *
 * Unlike {@link SITE_DESCRIPTION}, this cannot be read back out of the document: by the time any
 * route needs the fallback, the title strategy has already overwritten `document.title` on an
 * earlier navigation, so there is nothing original left to read. Hence a constant, and hence the
 * instruction above.
 */
export const SITE_TITLE = `${SITE_NAME} — project portfolio`;

/**
 * Fallback site description.
 *
 * **`index.html` is the source of truth, not this constant.** `SeoService` reads the static
 * `<meta name="description">` out of the document at construction -- before any route has
 * overwritten it -- and uses that as the default for routes that declare none. This value is only
 * reached when the document carries no description tag at all, which in practice means unit tests,
 * whose harness page is not `index.html`. Keeping it in sync is therefore nice, not load-bearing:
 * editing `index.html` alone cannot silently regress the running site.
 */
export const SITE_DESCRIPTION =
  'A portfolio of software and audio/DSP projects — what each one does, how it was built, and where to find the code.';

/**
 * `content` for `<meta name="robots">` on pages that must never be indexed: the admin area, the
 * password-reset form, and the 404 view.
 *
 * **This tag and `robots.txt` do not stack**, and on two of those three paths `robots.txt` is the
 * mechanism actually doing the work. `public/robots.txt` disallows `/admin` and `/reset-password`;
 * a crawler that obeys a `Disallow` never fetches those pages, so it never renders them and never
 * reads this tag. Google is explicit that `noindex` is only honoured on a page it is allowed to
 * crawl. The 404 view is the one route where this tag is the operative mechanism: `**` is not
 * disallowed, so it is fetched, rendered and read normally -- and it needs to be, because Netlify
 * rewrites every unknown path to `index.html` with **HTTP 200** (`public/_redirects`), so a 404
 * view is not a 404 response and would otherwise be indexable like any other page.
 *
 * Both are kept for `/admin` and `/reset-password` anyway, deliberately:
 *
 * - The `Disallow` is the only half a non-JS crawler can act on at all. This app is client-rendered
 *   and every path returns the same `index.html`, so a scraper that does not execute JS fetching
 *   `/admin` sees the site-level tags and *no* robots tag -- an apparent duplicate of the landing
 *   page. Dropping it and relying on this constant alone would leave that case uncovered.
 * - This tag is the belt-and-braces half: a JS-executing crawler that arrives on a direct link and
 *   does not honour `robots.txt`, or a deploy where `robots.txt` is missing or unreachable. It is
 *   also the only answer to `Disallow`'s own gap -- a blocked URL can still be listed URL-only from
 *   external links -- though blocking the fetch is precisely what stops that answer being read.
 *   Nothing links to `/admin`, so in practice that residual is theoretical.
 *
 * (An earlier version of this comment claimed the reverse: that this tag is "what a crawler that
 * has the page in hand reads" for `/admin`. A compliant crawler never has it in hand. Corrected
 * after the PR #103 review.)
 */
export const NOINDEX = 'noindex, nofollow';

/**
 * How a page's own name becomes a document title: `"Krzysztof Tarka - Projects"`.
 *
 * Route configs spell their titles out literally (`title: 'Krzysztof Tarka - Contact'`) because they are
 * static strings in a route table; this exists for the one title that cannot be static -- the
 * project detail page, whose name is the project's own title.
 */
export function siteTitle(pageName: string): string {
  return `${SITE_NAME} - ${pageName}`;
}

/**
 * Length cap for a meta description, in characters.
 *
 * Google truncates the displayed snippet somewhere around 155-160 characters on desktop and less on
 * mobile, and the cut-off is measured in pixels rather than characters, so no number is exact. 160
 * is the conventional bound: past it the tail is invisible in a search result, and a description
 * that trails off mid-thought reads worse than a shorter complete one.
 */
export const META_DESCRIPTION_MAX_CHARS = 160;

/**
 * A project's `description` reduced to a meta-description-sized summary.
 *
 * Deliberately delegates to {@link toCardExcerpt} (issue #86's list-card excerpt) rather than
 * truncating again here. That function already solves every part of this problem -- take the first
 * paragraph whole, collapse the whitespace a `content` attribute would otherwise carry verbatim,
 * cut on a word boundary, never split a surrogate pair, and return `''` rather than a lone ellipsis
 * for input that strips to nothing -- and its reasoning is documented at length in
 * `shared/description-excerpt/description-excerpt.ts`. Only the budget differs: a card is bounded
 * by what its box can show, a meta description by what a search result will print.
 *
 * Returns `''` for empty, whitespace-only or absent input, so callers can fall back to the
 * site-level description instead of writing an empty tag.
 */
export function toMetaDescription(description: string | null | undefined): string {
  return toCardExcerpt(description, META_DESCRIPTION_MAX_CHARS);
}
