import type { Page } from '@playwright/test';

/**
 * Blocks until every font the page has asked for has finished loading (or failed).
 *
 * **Call this before measuring anything geometric.** Since the 2026-08-22 visual-direction ADR the
 * site serves its own Archivo and IBM Plex with `font-display: swap`, which means the first paint
 * is a local fallback and the real faces replace it some milliseconds later. Before that change the
 * site was `system-ui` with no webfonts, so there was no swap to race and a measurement taken at
 * any moment after load was the same measurement; that is no longer true, and the assumption was
 * load-bearing for `projects.spec.ts`'s line-count assertion in particular.
 *
 * The faces carry metric overrides (`size-adjust`, `ascent-override`, `descent-override`) tuned so
 * the fallback occupies the same average advance width and declares the same ascent and descent as
 * the face it stands in for, which makes the swap very nearly free. "Very nearly" is the reason
 * this helper exists anyway: the corrections are averages over a character set, not a guarantee
 * about any particular string, and a layout test that is right almost every time is worse than one
 * that is slow -- it teaches whoever hits the failure to press re-run instead of to look.
 *
 * `document.fonts.ready` resolves to the FontFaceSet, which is not serialisable across the
 * Playwright boundary, so the value is deliberately thrown away rather than returned.
 *
 * One caveat worth knowing: this settles the fonts the document has *requested so far*. Await it
 * after the element under test is on screen, not immediately after `goto`, or a face that only a
 * later-rendered element asks for can still load after the promise resolves.
 */
export async function waitForFontsReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
