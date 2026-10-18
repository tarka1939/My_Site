import { DOCUMENT } from '@angular/common';
import { HttpContext } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, PRIMARY_OUTLET, Router } from '@angular/router';
import { Observable, filter } from 'rxjs';
import { AnalyticsService } from '../api/api/analytics.service';
import { AnalyticsPage } from '../api/model/analyticsPage';
import { PageViewEvent } from '../api/model/pageViewEvent';
import { AuthService } from '../auth/auth.service';
import { SKIP_ERROR_TOAST } from '../http/error.interceptor';

/**
 * The route `data` key that names which public page a route is, for example
 * `data: { analyticsPage: AnalyticsPage.Contact }`. Only the public routes carry it: About, the
 * projects list, a project's page, Contact and Privacy. The reset-password, admin and not-found
 * routes do not, so they are never counted (the 2026-10-18 analytics ADR in docs/DECISIONS.md).
 */
export const ANALYTICS_PAGE_KEY = 'analyticsPage';

/** The two browser signals that mean "do not count me". */
export interface PrivacySignals {
  readonly doNotTrack?: string | null;
  readonly globalPrivacyControl?: boolean;
}

/**
 * The browser's navigator, as far as the tracker reads it. A token so that specs can hand in a
 * navigator of their own, and read through DOCUMENT rather than the `navigator` global. It is the
 * live object, not a copy, so a signal switched on mid-visit is seen by the next event.
 */
export const PRIVACY_SIGNALS = new InjectionToken<PrivacySignals | null>('PRIVACY_SIGNALS', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).defaultView?.navigator ?? null,
});

/**
 * A project id is a UUID in the contract, and `projectId` is typed `format: uuid`. A path segment
 * that is not one cannot name a project, so it is not sent: the server would refuse it, and nothing
 * from a URL that the closed list did not ask for should leave the browser.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN_PAGES: readonly string[] = Object.values(AnalyticsPage);

/**
 * Counts the site's own visits: one page view per public page shown, and a click on one of a
 * project's own links. The design is the 2026-10-18 analytics ADR in docs/DECISIONS.md.
 *
 * Nothing is sent while the browser asks not to be tracked (Do Not Track or Global Privacy
 * Control) or while the admin is logged in. Both are checked for every event, not once at start, so
 * a visitor who switches a signal on, or an admin who logs in, stops being counted from the next
 * event on. The server drops such events too; this keeps them from being sent at all.
 *
 * Every request opts out of the error toast and every failure is swallowed. Counting is for the
 * owner's curiosity, and a visitor must never be told it failed: the endpoints answer 404 whenever
 * analytics is turned off on the server, which is the default.
 *
 * Page views start from {@link start}, called once at bootstrap from app.config.ts, not from a
 * component. A component spec that renders a page therefore sends nothing.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsTracker {
  private readonly api = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly signals = inject(PRIVACY_SIGNALS);
  private readonly destroyRef = inject(DestroyRef);

  private started = false;

  /**
   * The page the last navigation landed on, as `page` plus `projectId`, or null for a page that is
   * not counted. Kept whether or not that view was sent.
   */
  private lastPage: string | null = null;

  /** Send a page view for each navigation that lands on a public page. Idempotent. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.pageShown(pageViewFor(this.router.routerState.snapshot.root)));
  }

  /**
   * A click on one of a project's own links. `url` is the link's URL exactly as the API gave it:
   * the server compares it with the project's links as they are now, and counts only a match.
   */
  recordLinkClick(projectId: string, url: string): void {
    if (!this.mayCount()) {
      return;
    }
    this.send(
      this.api.recordLinkClick({ linkClickEvent: { projectId, url } }, 'body', false, {
        context: quiet(),
      }),
    );
  }

  /**
   * A navigation that stays on the page already shown sends nothing more. That is a fragment
   * change, such as the skip link's `#main-content`, which the router treats as a navigation. The
   * server would not count it twice anyway, since it keeps one row per visitor, page and day; this
   * only saves the request. Leaving the page and coming back is a new page shown, and is sent.
   */
  private pageShown(event: PageViewEvent | null): void {
    const page = event ? `${event.page}:${event.projectId ?? ''}` : null;
    const samePage = page !== null && page === this.lastPage;
    this.lastPage = page;

    if (event === null || samePage || !this.mayCount()) {
      return;
    }
    this.send(this.api.recordPageView({ pageViewEvent: event }, 'body', false, { context: quiet() }));
  }

  private mayCount(): boolean {
    const signals = this.signals;
    if (signals?.doNotTrack === '1' || signals?.globalPrivacyControl === true) {
      return false;
    }
    // A method, read now: it is false once the session has expired by the clock (#151).
    return !this.auth.isLoggedIn();
  }

  /**
   * Fire and forget. The error callback is what swallows a failure: without it RxJS reports the
   * error as unhandled. Not `sendBeacon` or `keepalive`: a page view is sent while the page stays,
   * and a project's links open in a new tab, so an ordinary request completes.
   */
  private send(request: Observable<unknown>): void {
    request.subscribe({ error: () => undefined });
  }
}

/**
 * Every analytics request carries this, so errorInterceptor raises no toast for its failure. See
 * SKIP_ERROR_TOAST: it silences every branch an anonymous request can reach. The one it leaves is a
 * 401 while the tab holds a token, and the tracker sends nothing while the admin is logged in, and
 * authInterceptor attaches no expired token, so no token goes out with these requests.
 */
function quiet(): HttpContext {
  return new HttpContext().set(SKIP_ERROR_TOAST, true);
}

/**
 * The page view for the route a navigation activated, or null when it is not a counted page. Read
 * from the deepest route in the primary outlet, which is the one that renders the page and the one
 * whose `:id` a project's page is.
 */
export function pageViewFor(root: ActivatedRouteSnapshot): PageViewEvent | null {
  let route = root;
  for (let child = primaryChild(route); child !== undefined; child = primaryChild(route)) {
    route = child;
  }

  const page: unknown = route.data[ANALYTICS_PAGE_KEY];
  if (typeof page !== 'string' || !KNOWN_PAGES.includes(page)) {
    return null;
  }
  if (page !== AnalyticsPage.Project) {
    return { page: page as AnalyticsPage };
  }

  const projectId = route.paramMap.get('id');
  return projectId !== null && UUID.test(projectId) ? { page, projectId } : null;
}

function primaryChild(route: ActivatedRouteSnapshot): ActivatedRouteSnapshot | undefined {
  return route.children.find((child) => child.outlet === PRIMARY_OUTLET);
}
