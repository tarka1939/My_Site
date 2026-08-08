import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toProjectMonth } from './project-period';

/**
 * Renders a project's date period as month/year, never a day -- see ./project-period.ts and the
 * 2026-08-08 ADR for why the stored day is a storage artefact that must not reach the page.
 *
 * Four states, and each has to be distinguishable:
 *   - start + end        -> "March 2024 – June 2025"
 *   - start + no end     -> "March 2024 – ongoing"   (null completedOn *means* ongoing)
 *   - start = end month  -> "March 2024"             (no "March 2024 – March 2024": with the day
 *                                                     dropped, a one-month project is one month)
 *   - neither            -> nothing at all, no empty label and no stray dash
 *
 * The `<time>` elements carry a `YYYY-MM` datetime, which is a valid HTML month string, so the
 * machine-readable value asserts exactly the precision the visible text does. The separator is
 * `aria-hidden`, with a visually hidden connector next to it, so the period reads as a sentence
 * ("Project period: March 2024 to June 2025") rather than as two bare dates around a dash.
 */
@Component({
  selector: 'app-project-period',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (start(); as start) {
      <p class="project-period">
        <span class="visually-hidden">Project period: </span>
        <time [attr.datetime]="start">{{ start | date: 'LLLL y' }}</time>
        @if (ongoing()) {
          <span aria-hidden="true"> &ndash; </span><span class="visually-hidden">, </span>
          <span class="is-ongoing">ongoing</span>
        } @else if (!singleMonth()) {
          <span aria-hidden="true"> &ndash; </span><span class="visually-hidden"> to </span>
          <time [attr.datetime]="end()">{{ end() | date: 'LLLL y' }}</time>
        }
      </p>
    } @else if (end(); as end) {
      <!-- An end with no start is rejected by the API and by a table CHECK constraint, so it should
           be unreachable. Rendered anyway rather than silently dropped: the generated types allow
           the combination, and swallowing a date the server did send would be the worse failure. -->
      <p class="project-period">
        <span class="visually-hidden">Project period: </span>
        completed <time [attr.datetime]="end">{{ end | date: 'LLLL y' }}</time>
      </p>
    }
  `,
  styles: `
    .project-period {
      margin: 0.25rem 0;
      font-size: 0.9rem;
      color: gray;
    }
  `,
})
export class ProjectPeriodComponent {
  readonly startedOn = input<string | null | undefined>(null);
  readonly completedOn = input<string | null | undefined>(null);

  protected readonly start = computed(() => toProjectMonth(this.startedOn()));
  protected readonly end = computed(() => toProjectMonth(this.completedOn()));

  /** A start with no end. Per the contract this is a state, not an absence. */
  protected readonly ongoing = computed(() => this.start() !== null && this.end() === null);

  /** Started and finished inside the same month -- indistinguishable once the day is dropped. */
  protected readonly singleMonth = computed(
    () => this.end() !== null && this.end() === this.start(),
  );
}
