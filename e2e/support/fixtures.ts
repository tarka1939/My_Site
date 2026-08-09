import { E2E_TITLE_PREFIX, TAG_ALPHA, TAG_BETA, TAG_SHARED } from './env';
import type { ProjectWriteRequest } from './api';

/**
 * The seeded dataset the read-only journeys assert against. Two projects sharing one tag and
 * differing on a second is the minimum that makes tag filtering actually provable: filtering by
 * `TAG_ALPHA` has to show one and hide the other, which a single-project fixture cannot
 * distinguish from "the filter did nothing".
 *
 * `images` is deliberately left empty. The data model stores images as external URLs
 * (`docs/DECISIONS.md`, 2026-07-24), so a fixture with images would make the suite depend on a
 * third-party host being reachable — a classic source of E2E flake for no added coverage.
 *
 * The two also differ on their date period, for the same reason they differ on tags: one closed
 * period and one ongoing project is the minimum that makes the period *provable*. A single dated
 * fixture cannot distinguish "the period renders" from "a null `completedOn` happens to render the
 * same way", and null-means-ongoing is the rule the 2026-08-08 ADR calls a meaningful value rather
 * than missing data. Both dates sit on the 1st per that ADR's convention; only month/year is ever
 * rendered, so the expected strings below carry no day.
 */

export const FIXTURE_ALPHA: ProjectWriteRequest = {
  title: `${E2E_TITLE_PREFIX} Spectral Analyzer`,
  description:
    'Real-time FFT spectrum analyzer with configurable window functions and peak hold. Seeded by the Playwright E2E suite.',
  tags: [TAG_SHARED, TAG_ALPHA],
  links: [{ label: 'Source', url: 'https://example.invalid/spectral-analyzer' }],
  images: [],
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

export const FIXTURE_BETA: ProjectWriteRequest = {
  title: `${E2E_TITLE_PREFIX} Convolution Reverb`,
  description:
    'Partitioned convolution reverb with impulse-response loading. Seeded by the Playwright E2E suite.',
  tags: [TAG_SHARED, TAG_BETA],
  links: [],
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
