import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NOINDEX, SITE_DESCRIPTION, SITE_NAME, toMetaDescription } from './site-meta';

/** What a route (or a loaded page) declares about itself. Every field is optional. */
export interface PageMeta {
  /** Full document title, e.g. `'My Site - Contact'`. Falls back to {@link SITE_NAME}. */
  readonly title?: string;
  /** Raw description text -- truncated and whitespace-collapsed here, not by the caller. */
  readonly description?: string | null;
  /** `robots` content, i.e. {@link NOINDEX}. Absent means indexable, and *removes* any stale tag. */
  readonly robots?: string;
  /** Router URL of the page, e.g. `'/projects/abc?tag=dsp'`. Used to build `og:url`. */
  readonly url?: string;
}

/**
 * The single writer of the document's title and SEO meta tags.
 *
 * Everything goes through {@link Meta.updateTag}, never `addTag`. `updateTag` looks the tag up by
 * its `name=`/`property=` selector and rewrites the existing element's `content`; `addTag` appends
 * a second one. With `addTag`, four navigations leave four `og:description` tags in `<head>` and a
 * crawler reads whichever it reaches first -- typically the oldest, i.e. the wrong one. That
 * silent-accumulation bug is what `seo.service.spec.ts` pins down.
 *
 * The tags this writes must already exist in `src/index.html` with matching selectors. They do, and
 * that is not incidental: the static ones are what a non-JS social scraper sees, and these are the
 * per-route overrides Googlebot sees after rendering. If a selector here and one there ever drift
 * apart (`property="og:title"` vs `name="og:title"`), `updateTag` will not find the static tag and
 * will append a duplicate instead of replacing it -- also covered by the spec.
 *
 * **Escaping is not this class's job, and must not be.** `Meta` writes through
 * `Element.setAttribute`, which takes a string value, not markup -- so a description containing
 * `"`, `<` or `&` is stored verbatim in the DOM and serialised with the right entity references by
 * the browser. Pre-escaping here would double-encode and put a literal `&quot;` in the snippet.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  /**
   * The description `index.html` shipped with, captured before anything overwrites it, and used for
   * routes that declare none.
   *
   * Read from the DOM rather than duplicated as a TypeScript constant so the static tag stays the
   * single source of truth: editing `index.html` cannot leave the runtime serving a stale
   * description it disagrees with. Safe to do in a field initializer -- this service is only
   * constructed when something first injects it, which is the title strategy on the first
   * navigation, and the capture happens in the constructor, before that call writes anything.
   */
  private readonly defaultDescription = this.readDocumentDescription();

  /**
   * Applies a page's metadata as a set: title, description, `og:url` and `robots` together.
   *
   * Called on every navigation (see `seo-title.strategy.ts`), which is what keeps the tags from
   * going stale -- each navigation overwrites the previous page's values, and a page that declares
   * no description gets the site-level one back rather than inheriting the last project's.
   */
  applyPage(page: PageMeta): void {
    this.setTitle(page.title);
    this.setDescription(page.description);
    this.setCanonicalUrl(page.url);
    this.setRobots(page.robots);
  }

  /**
   * Sets the title, and mirrors it into `og:title`/`twitter:title`.
   *
   * The share titles reuse the document title verbatim, including its `"My Site - "` prefix, rather
   * than carrying a separate short form. `og:site_name` does technically make the prefix redundant
   * in a preview card, but a second source of truth for a page's name is a thing to keep in sync
   * for a cosmetic gain, and previews that show the site name inline are common enough to look
   * normal.
   */
  setTitle(title: string | null | undefined): void {
    // Falls back rather than leaving the previous page's title in place: a route with no `title`
    // is not a route that wants the last one. `index.html`'s <title> is the same value.
    const resolved = title?.trim() || SITE_NAME;
    this.title.setTitle(resolved);
    this.meta.updateTag({ property: 'og:title', content: resolved });
    this.meta.updateTag({ name: 'twitter:title', content: resolved });
  }

  /**
   * Sets the description, and mirrors it into `og:description`/`twitter:description`.
   *
   * Exposed separately from {@link applyPage} for content that arrives after navigation: the
   * project detail page cannot know its description until the API responds, and by then the
   * navigation that would have carried it is long finished.
   */
  setDescription(description: string | null | undefined): void {
    const content = toMetaDescription(description) || this.defaultDescription;
    this.meta.updateTag({ name: 'description', content });
    this.meta.updateTag({ property: 'og:description', content });
    this.meta.updateTag({ name: 'twitter:description', content });
  }

  /**
   * Points `og:url` at the page actually being viewed.
   *
   * `index.html`'s static `og:url` is an unresolvable placeholder, because the canonical domain does
   * not exist yet (Phase 5 is paused, and `PROJECT_TODO.md` says not to guess it). At runtime the
   * origin *is* known -- it is whatever origin served the app -- so a JS-executing crawler need not
   * be told a placeholder. A non-JS scraper still sees the placeholder; that is the known limitation
   * the ADR accepts, and it disappears when the real origin is filled in.
   *
   * Query string and fragment are dropped on purpose: the list page's tag filter and paging are
   * component state rather than URL state today, but if that changes, `?tag=dsp&page=2` must not
   * become a distinct URL a crawler treats as its own page.
   */
  private setCanonicalUrl(url: string | undefined): void {
    const origin = this.document.location?.origin;
    // `origin` is the string "null" for an opaque origin (a `file://` document, a sandboxed
    // iframe). Composing a URL from it produces "null/projects/x", which is worse than the honest
    // placeholder already in the markup -- so leave the static tag alone in that case.
    if (!url || !origin || origin === 'null') {
      return;
    }
    const resolved = new URL(url, origin);
    this.meta.updateTag({ property: 'og:url', content: `${resolved.origin}${resolved.pathname}` });
  }

  /**
   * Writes `<meta name="robots">`, or **removes** it when the page does not ask for one.
   *
   * Removal is the half that is easy to forget and impossible to notice by hand: leaving the tag
   * behind after navigating from `/admin/projects` back to `/` would tell a crawler the public
   * landing page is `noindex`, silently de-indexing the site. There is no static `robots` tag in
   * `index.html`, so "absent" is the correct resting state.
   */
  private setRobots(robots: string | undefined): void {
    if (robots) {
      this.meta.updateTag({ name: 'robots', content: robots });
    } else {
      this.meta.removeTag('name="robots"');
    }
  }

  private readDocumentDescription(): string {
    return this.meta.getTag('name="description"')?.getAttribute('content')?.trim() || SITE_DESCRIPTION;
  }
}
