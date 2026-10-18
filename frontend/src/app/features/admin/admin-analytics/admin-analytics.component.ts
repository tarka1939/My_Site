import { HttpContext } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  Observable,
  catchError,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { AnalyticsService } from '../../../core/api/api/analytics.service';
import { AnalyticsSummary } from '../../../core/api/model/analyticsSummary';
import { ApiProblem } from '../../../core/http/api-problem';
import { SKIP_ERROR_TOAST } from '../../../core/http/error.interceptor';

/** The range presets, in days, each ending today (UTC). */
export const RANGE_PRESETS = [7, 30, 90] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
const DEFAULT_RANGE: RangePreset = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sums over the range's days. There is no visitor total: see the contract on GET /admin/analytics. */
export interface Totals {
  readonly views: number;
  readonly visitorDays: number;
  readonly linkClicks: number;
}

interface Loaded {
  readonly kind: 'loaded';
  readonly summary: AnalyticsSummary;
  readonly totals: Totals;
  /** The busiest day's views, which every day's bar is drawn against. */
  readonly maxViews: number;
  /** Nothing at all in the range: no view and no link click. */
  readonly empty: boolean;
}

type DashboardState =
  | { readonly kind: 'loading' }
  | Loaded
  /** 404: analytics is turned off on the server, so the endpoint is not mapped. */
  | { readonly kind: 'off' }
  | { readonly kind: 'failed'; readonly message: string };

/** Display names for the AnalyticsPage values. An unknown value is shown as it came. */
const PAGE_LABELS: Readonly<Record<string, string>> = {
  about: 'About',
  projects: 'Projects list',
  // The contract's `project` entry is the sum over every project's page.
  project: 'Project pages',
  contact: 'Contact',
  privacy: 'Privacy',
};

/**
 * The admin's view of the site's own visit counting (Phase 7c): totals, days, pages and projects
 * for the last 7, 30 or 90 UTC days.
 *
 * Every failure is rendered here, so the request sets SKIP_ERROR_TOAST. That matters most for a
 * 400 with field errors: errorInterceptor never toasts one, on the assumption that a form shows
 * it, and this page has no form, so without its own message the page would fail silently (the
 * trap of #92, #106 and #185). A 401 for an expired session still logs out and redirects, which
 * the token does not switch off.
 */
@Component({
  selector: 'app-admin-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-analytics.component.html',
  styleUrl: './admin-analytics.component.scss',
})
export class AdminAnalyticsComponent {
  private readonly analyticsApi = inject(AnalyticsService);

  /**
   * The browser's formatter rather than DecimalPipe, in the app's locale as the pipe would use.
   * Importing the pipe here moved Angular's number formatting into a chunk every page loads: the
   * initial bundle measured 307.75 kB with it and 304.01 kB without, for an admin-only page.
   */
  private readonly numbers = new Intl.NumberFormat(inject(LOCALE_ID));

  protected readonly ranges = RANGE_PRESETS;
  protected readonly range = signal<RangePreset>(DEFAULT_RANGE);
  protected readonly state = signal<DashboardState>({ kind: 'loading' });

  protected readonly loaded = computed(() => {
    const state = this.state();
    return state.kind === 'loaded' ? state : null;
  });

  protected readonly failure = computed(() => {
    const state = this.state();
    return state.kind === 'failed' ? state.message : null;
  });

  private readonly requested = new BehaviorSubject<RangePreset>(DEFAULT_RANGE);

  constructor() {
    // switchMap, so a range picked while another is loading replaces it rather than racing it:
    // whichever answered last would otherwise be shown under the newer range's selection.
    this.requested
      .pipe(
        distinctUntilChanged(),
        switchMap((days) => this.load(days)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected selectRange(days: RangePreset): void {
    this.range.set(days);
    this.requested.next(days);
  }

  /** A count with thousands grouped, so 1500 reads as 1,500 in the default locale. */
  protected count(value: number): string {
    return this.numbers.format(value);
  }

  protected pageLabel(page: string): string {
    return PAGE_LABELS[page] ?? page;
  }

  /** A day's bar as a percentage of the busiest day's. 0, not NaN, when no day has a view. */
  protected barWidth(views: number, maxViews: number): number {
    return maxViews > 0 ? (views / maxViews) * 100 : 0;
  }

  private load(days: RangePreset): Observable<DashboardState> {
    // `to` is left to the API, whose default is today (UTC). Only `from` is computed here.
    return this.analyticsApi
      .getAnalyticsSummary({ from: rangeStart(days, Date.now()) }, 'body', false, {
        context: new HttpContext().set(SKIP_ERROR_TOAST, true),
      })
      .pipe(
        map((summary): DashboardState => loadedState(summary)),
        // Inside the switchMap, so a failure ends this request only and the next range still loads.
        catchError((problem: ApiProblem | undefined) => of(failedState(problem))),
        startWith<DashboardState>({ kind: 'loading' }),
      );
  }
}

/**
 * The first day of a `days`-long range ending on today's UTC date, as `YYYY-MM-DD`.
 *
 * UTC throughout. A visitor's local date differs from the UTC one for part of every day almost
 * everywhere, and local date arithmetic would then ask for a range a day off from the one the
 * API counts in. Every UTC day is exactly DAY_MS long, since UTC has no daylight saving.
 */
export function rangeStart(days: number, now: number): string {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return new Date(today - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

export function totalsOf(summary: AnalyticsSummary): Totals {
  return summary.days.reduce(
    (totals, day) => ({
      views: totals.views + day.views,
      visitorDays: totals.visitorDays + day.visitors,
      linkClicks: totals.linkClicks + day.linkClicks,
    }),
    { views: 0, visitorDays: 0, linkClicks: 0 },
  );
}

function loadedState(summary: AnalyticsSummary): Loaded {
  const totals = totalsOf(summary);
  return {
    kind: 'loaded',
    summary,
    totals,
    maxViews: summary.days.reduce((max, day) => Math.max(max, day.views), 0),
    empty: totals.views === 0 && totals.linkClicks === 0,
  };
}

/**
 * `problem?.`: errorInterceptor rethrows an ApiProblem only for an HttpErrorResponse, and anything
 * else unchanged, so this cannot assume the shape.
 */
function failedState(problem: ApiProblem | undefined): DashboardState {
  if (problem?.status === 404) {
    return { kind: 'off' };
  }
  const fieldMessages = (problem?.fieldErrors ?? []).map((error) => error.message);
  const message =
    fieldMessages.length > 0
      ? fieldMessages.join(' ')
      : problem?.detail || problem?.title || 'Something went wrong.';
  return { kind: 'failed', message };
}
