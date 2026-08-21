import { E2E_TITLE_PREFIX, TAG_ALPHA, TAG_BETA, TAG_SHARED } from './env';
import type { ProjectWriteRequest } from './api';

/**
 * The seeded dataset the read-only journeys assert against. Two projects sharing one tag and
 * differing on a second is the minimum that makes tag filtering actually provable: filtering by
 * `TAG_ALPHA` has to show one and hide the other, which a single-project fixture cannot
 * distinguish from "the filter did nothing".
 *
 * The two also differ on their date period, for the same reason they differ on tags: one closed
 * period and one ongoing project is the minimum that makes the period *provable*. A single dated
 * fixture cannot distinguish "the period renders" from "a null `completedOn` happens to render the
 * same way", and null-means-ongoing is the rule the 2026-08-08 ADR calls a meaningful value rather
 * than missing data. Both dates sit on the 1st per that ADR's convention; only month/year is ever
 * rendered, so the expected strings below carry no day.
 *
 * They differ on **content size** on the same principle, and that asymmetry is issue #99. Alpha
 * carries a long multi-paragraph description and two images; Beta carries a one-line description
 * and none. Only the pair proves anything: a card summarises a long description and reprints a
 * short one, a project with images gets a thumbnail and one without gets no `<img>` at all. Two
 * short imageless fixtures — what this file held before — cannot fail if the excerpt, the CSS line
 * clamp, or the gallery's alt text stops working, which is exactly what #99 reports.
 */

/**
 * Alpha's opening paragraph, longer than the card's excerpt cap on purpose.
 *
 * Written as one physical line with single spaces so it is its own whitespace-collapsed form: the
 * card excerpt collapses runs of whitespace before measuring, and a paragraph wrapped across source
 * lines would stop being a prefix of what the card renders, which is what `projects.spec.ts`
 * asserts.
 *
 * The trailing `…-NOT-ON-CARD` markers are deliberate and are the point of the length. The card is
 * allowed to cut wherever the cap falls — the suite does not pin the cap, that belongs in
 * `frontend`'s unit tests — but text past it, and text from any later paragraph, must never appear
 * on a card. A marker fails that assertion loudly instead of leaving it to a subtle word.
 */
const ALPHA_FIRST_PARAGRAPH =
  'A real-time FFT spectrum analyzer for live monitoring of an audio signal chain: configurable window functions, adjustable overlap between successive frames, peak hold on a slowly decaying trace, and a logarithmic frequency axis that stays readable from twenty hertz up to the Nyquist limit of whatever device is feeding it. This sentence sits past the card excerpt cap and must never reach a card: TAIL-MARKER-NOT-ON-CARD.';

const ALPHA_SECOND_PARAGRAPH =
  'The analyzer runs the transform off the audio thread and hands frames to the renderer through a lock-free ring buffer, so a slow repaint drops a frame instead of glitching the capture. Window choice, overlap and averaging are all live-adjustable while the stream is running, and the peak-hold trace can be frozen and exported as a CSV of bin centres and magnitudes for whoever has to argue about the result afterwards. SECOND-PARAGRAPH-MARKER-NOT-ON-CARD.';

const ALPHA_THIRD_PARAGRAPH =
  'Seeded by the Playwright E2E suite. The length is deliberate: this description is what proves the list card summarises rather than reprints, and that the card stylesheet clamps the summary to a fixed number of rendered lines in a real browser, which is the one thing a jsdom component test cannot check because it performs no layout at all. Nothing here is real project copy, and the two images are fixture URLs on a reserved .invalid domain that the suite serves itself.';

/**
 * Fixture image URLs.
 *
 * **Absolute `https:` URLs on a reserved `.invalid` domain, fulfilled by the browser-side route in
 * `projects.spec.ts` — never fetched from anywhere.** Three constraints had to hold at once and
 * this is the only shape that meets all three:
 *
 *  - `docs/openapi.yaml` types each entry as `format: uri`, `maxLength: 500`. A relative path
 *    (`/favicon.ico`) is a URI *reference*, not a URI, and a `data:` URL is a scheme most
 *    server-side URL validators reject. A plain absolute `https:` URL is the shape nothing can
 *    argue with, and these are ~40 characters.
 *  - The suite must not depend on a third-party host being reachable — the objection that kept
 *    images out of this file until now, and a correct one. RFC 2606 reserves `.invalid`, so this
 *    hostname can never resolve, for anyone, ever. The seeded production content uses
 *    `raw.githubusercontent.com`; borrowing that here would make every run of a *layout* test
 *    depend on GitHub's CDN, which is a trade with nothing on the winning side.
 *  - The image has to actually decode, so the gallery lays out at its real size instead of at a
 *    broken-image placeholder. `page.route` fulfils both URLs with bytes the test owns, so the
 *    render is byte-for-byte deterministic and no request leaves the browser.
 *
 * Two, not one: the generated alt text only says "image N of M" when there is more than one image
 * (a single image is named by title alone), so a one-image fixture cannot assert the position
 * clause at all.
 */
export const FIXTURE_ALPHA_IMAGES = [
  'https://images.e2e.invalid/spectral-analyzer-1.svg',
  'https://images.e2e.invalid/spectral-analyzer-2.svg',
];

export const FIXTURE_ALPHA: ProjectWriteRequest = {
  title: `${E2E_TITLE_PREFIX} Spectral Analyzer`,
  description: [ALPHA_FIRST_PARAGRAPH, ALPHA_SECOND_PARAGRAPH, ALPHA_THIRD_PARAGRAPH].join('\n\n'),
  tags: [TAG_SHARED, TAG_ALPHA],
  links: [{ label: 'Source', url: 'https://example.invalid/spectral-analyzer' }],
  images: FIXTURE_ALPHA_IMAGES,
  startedOn: '2024-03-01',
  completedOn: '2025-06-01',
};

/**
 * What Alpha's closed period must render as. Month and year only: the stored day is a storage
 * artefact, so `March 2024` and `datetime="2024-03"` are both assertions that it never leaks.
 */
export const FIXTURE_ALPHA_PERIOD = {
  start: { text: 'March 2024', datetime: '2024-03' },
  end: { text: 'June 2025', datetime: '2025-06' },
} as const;

/**
 * What Alpha's long description must and must not turn into on a card.
 *
 * `firstParagraph` is what the excerpt has to be a prefix of; `hiddenOnCard` is the text that must
 * not survive the summary. Note what is deliberately *absent*: the expected excerpt string itself.
 * Pinning it here would pin `CARD_EXCERPT_MAX_CHARS` in a second place, so tuning the cap — a
 * legitimate, purely visual change — would break a journey for no defect. The unit tests in
 * `frontend/src/app/shared/description-excerpt` own the cap's exact behaviour. What only a real
 * browser can prove, and what this suite therefore asserts, is that the card summarises at all.
 */
export const FIXTURE_ALPHA_CARD_TEXT = {
  firstParagraph: ALPHA_FIRST_PARAGRAPH,
  hiddenOnCard: ['TAIL-MARKER-NOT-ON-CARD', 'SECOND-PARAGRAPH-MARKER-NOT-ON-CARD'],
  /** Present in the last paragraph, so finding it proves the detail page renders the whole text. */
  lastParagraphMarker: 'Nothing here is real project copy',
} as const;

/**
 * Lines `.card-description` may occupy on screen, mirroring `line-clamp` in
 * `projects-list.component.scss`.
 *
 * Duplicated from the stylesheet on purpose. This is the only assertion in the project that fails
 * if the clamp stops laying out: `-webkit-box-orient: vertical` was once deleted and every unit
 * test stayed green, because jsdom resolves CSS but never performs layout, so it can see the
 * declaration and not the rendering. Changing the clamp to a different number of lines is a visible
 * design decision and should have to be made in both places.
 */
export const CARD_DESCRIPTION_CLAMP_LINES = 3;

/**
 * What the gallery's alt text must say, and what no alt text anywhere may say.
 *
 * `mustNotClaim` is issue #87's regression: alt text used to read "<title> screenshot <n>", a claim
 * about image *content* that nothing in the frontend is in a position to make — and one that was
 * already false for drafted entries whose images are architecture diagrams.
 */
export const FIXTURE_ALPHA_IMAGE_ALTS = [
  `${FIXTURE_ALPHA.title}, image 1 of 2`,
  `${FIXTURE_ALPHA.title}, image 2 of 2`,
];

/** Words no alt text on either page may contain, in any case. */
export const ALT_TEXT_MUST_NOT_CLAIM = /screenshot|diagram|photo|logo|chart/i;

export const FIXTURE_BETA: ProjectWriteRequest = {
  title: `${E2E_TITLE_PREFIX} Convolution Reverb`,
  // Short on purpose, and shorter than any plausible excerpt cap: Beta is the control for Alpha.
  // A card that truncated this too would mean the excerpt is unconditional rather than a cap.
  description:
    'Partitioned convolution reverb with impulse-response loading. Seeded by the Playwright E2E suite.',
  tags: [TAG_SHARED, TAG_BETA],
  links: [],
  // Imageless on purpose, and the counterpart to Alpha's two: the card template renders its
  // thumbnail behind an `images.length > 0` guard, and only a fixture with no images can show that
  // the guard holds rather than emitting an <img> with an empty src.
  images: [],
  // Ongoing: a start with an explicitly null completion. A different state from "no dates at all",
  // and the site has to say so in words rather than trailing off after the start date.
  startedOn: '2025-11-01',
  completedOn: null,
};

/** Beta is ongoing, so its period ends in a word rather than in a second date. */
export const FIXTURE_BETA_PERIOD = {
  start: { text: 'November 2025', datetime: '2025-11' },
  ongoingLabel: 'ongoing',
} as const;

export const SEEDED_PROJECTS = [FIXTURE_ALPHA, FIXTURE_BETA];
