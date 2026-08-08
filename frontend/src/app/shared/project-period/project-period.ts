/**
 * Helpers for a project's date period -- `Project.startedOn` / `Project.completedOn` in
 * docs/openapi.yaml.
 *
 * Two rules from the 2026-08-08 project-dates ADR drive everything in here:
 *
 * 1. A null `completedOn` next to a non-null `startedOn` means the project is **ongoing**. That is
 *    a meaningful value, not missing data, and has to render as such rather than as a gap.
 * 2. Dates are stored at day precision but must only ever be rendered as month/year. The source
 *    material cannot support a day, so showing one would assert something untrue.
 */

/** `YYYY-MM-DD`, the `format: date` wire shape and what `<input type="date">` produces. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Narrows an ISO `YYYY-MM-DD` date down to its `YYYY-MM` month -- the only precision this UI ever
 * renders, and also a valid HTML month string for a `<time datetime>` attribute.
 *
 * Deliberately string surgery rather than `new Date(value)`: parsing `'2024-03-01'` yields UTC
 * midnight, so formatting it in any negative-offset timezone would render "February 2024".
 *
 * Returns null for empty *and* for unparseable input, so callers get one "nothing to show" branch
 * and a malformed value renders nothing instead of throwing inside DatePipe.
 */
export function toProjectMonth(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = ISO_DATE.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, year, month] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  return `${year}-${month}`;
}

/**
 * The two period rules the API rejects with a 400 keyed on `completedOn` (see the
 * ProjectWriteRequest schema). Checked client-side so the admin sees them before a round trip --
 * the server stays the authority.
 */
export type ProjectPeriodViolation = 'completedWithoutStart' | 'completedBeforeStart';

export const PROJECT_PERIOD_MESSAGES: Record<ProjectPeriodViolation, string> = {
  completedWithoutStart: 'Add a start date -- a project cannot finish without having started.',
  completedBeforeStart: 'The completion date cannot be earlier than the start date.',
};

export function validateProjectPeriod(
  startedOn: string | null | undefined,
  completedOn: string | null | undefined,
): ProjectPeriodViolation | null {
  const start = blankToNull(startedOn);
  const end = blankToNull(completedOn);

  if (end === null) {
    // No completion date is always valid: with a start it means ongoing, without one it means the
    // period is simply unspecified.
    return null;
  }
  if (start === null) {
    return 'completedWithoutStart';
  }
  // Both are zero-padded `YYYY-MM-DD`, so a lexicographic compare is a chronological compare.
  return end < start ? 'completedBeforeStart' : null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
