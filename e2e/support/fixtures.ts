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
 */

export const FIXTURE_ALPHA: ProjectWriteRequest = {
  title: `${E2E_TITLE_PREFIX} Spectral Analyzer`,
  description:
    'Real-time FFT spectrum analyzer with configurable window functions and peak hold. Seeded by the Playwright E2E suite.',
  tags: [TAG_SHARED, TAG_ALPHA],
  links: [{ label: 'Source', url: 'https://example.invalid/spectral-analyzer' }],
  images: [],
};

export const FIXTURE_BETA: ProjectWriteRequest = {
  title: `${E2E_TITLE_PREFIX} Convolution Reverb`,
  description:
    'Partitioned convolution reverb with impulse-response loading. Seeded by the Playwright E2E suite.',
  tags: [TAG_SHARED, TAG_BETA],
  links: [],
  images: [],
};

export const SEEDED_PROJECTS = [FIXTURE_ALPHA, FIXTURE_BETA];
