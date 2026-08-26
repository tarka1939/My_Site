import type { Page } from '@playwright/test';

/**
 * Serves the fixture project images, locally, to the browser under test.
 *
 * `FIXTURE_ALPHA_IMAGES` point at `https://images.e2e.invalid/...`. RFC 2606 reserves `.invalid`,
 * so that hostname cannot resolve for anybody — which is the property that matters: the suite gets
 * absolute `https:` URLs the contract's `format: uri` accepts and that the admin API stores like
 * any other, with **no possibility** of a request escaping to a third-party host. What the
 * fixtures cannot supply on their own is bytes, and an image that never decodes lays out as a
 * broken-image placeholder rather than as an image. This route supplies them.
 *
 * Call it **before** the first `page.goto` of any spec that renders a project card or gallery.
 * **Omitting it now fails the suite outright**, which it did not before #156. A card image that
 * fires `error` is replaced by generated artwork, and `images.e2e.invalid` fails DNS, so with no
 * route the card renders no `<img>` at all and `projects.spec.ts`'s thumbnail assertions —
 * `toHaveCount(1)`, `alt=""`, `src` — fail rather than merely costing a lookup. The old note said
 * nothing failed outright because alt text and the CSS clamp are properties of the markup rather
 * than of a successful fetch; that reasoning was right and is now obsolete, because whether the
 * markup exists is itself conditional on the fetch.
 *
 * The detail gallery still degrades the older, quieter way — it keeps its `<img>` and lays out
 * against a broken-image placeholder — so there it is the `naturalWidth > 0` poll, not a missing
 * element, that would catch an absent stub. Both specs that reach the public project list call it.
 *
 * Nothing in CI runs this suite (`.github/workflows/` holds only a README), so this comment is the
 * only warning a future reader gets. Keep it true.
 *
 * SVG rather than a raster format: it is a few hundred bytes of text with an intrinsic size the
 * renderer can use immediately, and the label makes it obvious in a failure screenshot that the
 * image came from here rather than from the network.
 */
export async function stubFixtureImages(page: Page): Promise<void> {
  await page.route('https://images.e2e.invalid/**', async (route) => {
    const label = new URL(route.request().url()).pathname.replace(/^\/|\.svg$/g, '');
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body:
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">` +
        `<rect width="640" height="400" fill="#1f7a8c"/>` +
        `<text x="320" y="215" font-family="monospace" font-size="36" text-anchor="middle" ` +
        `fill="#ffffff">${label}</text>` +
        `</svg>`,
    });
  });
}
