import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { renderComponent } from '../../../../testing/zoneless';
import { httpInterceptors } from '../../../app.config';
import { AnalyticsSummary } from '../../../core/api/model/analyticsSummary';
import { provideApi } from '../../../core/api/provide-api';
import { AuthService } from '../../../core/auth/auth.service';
import { SKIP_ERROR_TOAST } from '../../../core/http/error.interceptor';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AdminAnalyticsComponent, rangeStart, totalsOf } from './admin-analytics.component';

const API = environment.apiBaseUrl;
const SUMMARY_URL = `${API}/admin/analytics`;
/** Midday UTC, so nothing in the first block depends on the date boundary; the last block does. */
const NOW = Date.parse('2026-10-18T12:00:00.000Z');
/** NOW's UTC date less 29 days: the default 30-day range, today included. */
const DEFAULT_FROM = '2026-09-19';
const EQUALIZER_ID = '3f2b8c1e-7d4a-4e9b-a6c5-0d1e2f3a4b5c';
const DELETED_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const GITHUB = 'https://github.com/tarka1939/Equalizer';
const OLD_DEMO = 'https://example.com/old-demo';

/** Shaped as the contract describes it: every day of the range, every page in the enum's order. */
const SUMMARY: AnalyticsSummary = {
  from: '2026-10-16',
  to: '2026-10-18',
  days: [
    { date: '2026-10-16', views: 1200, visitors: 500, linkClicks: 2 },
    // A day with nothing counted. The API sends it rather than leaving a gap, and so does the page.
    { date: '2026-10-17', views: 0, visitors: 0, linkClicks: 0 },
    { date: '2026-10-18', views: 300, visitors: 120, linkClicks: 1 },
  ],
  pages: [
    { page: 'about', views: 600 },
    { page: 'projects', views: 400 },
    { page: 'project', views: 450 },
    { page: 'contact', views: 50 },
    { page: 'privacy', views: 0 },
  ],
  projects: [
    {
      projectId: EQUALIZER_ID,
      title: 'Equalizer',
      views: 400,
      linkClicks: 2,
      links: [{ url: GITHUB, label: 'GitHub', clicks: 2 }],
    },
    {
      projectId: DELETED_ID,
      title: null,
      views: 50,
      linkClicks: 1,
      links: [{ url: OLD_DEMO, label: null, clicks: 1 }],
    },
  ],
};

/** A range in which nothing was counted, which the API answers with zeros, not an empty body. */
const NOTHING: AnalyticsSummary = {
  ...SUMMARY,
  days: SUMMARY.days.map((day) => ({ ...day, views: 0, visitors: 0, linkClicks: 0 })),
  pages: SUMMARY.pages.map((page) => ({ ...page, views: 0 })),
  projects: [],
};

/**
 * Through the real interceptor chain, so what the page shows for a failure is what it shows with
 * errorInterceptor really in front of it, and "no toast" is that interceptor's behaviour rather
 * than a stub's.
 */
describe('AdminAnalyticsComponent', () => {
  let httpMock: HttpTestingController;
  let notifications: NotificationService;
  let fixture: ComponentFixture<AdminAnalyticsComponent>;

  beforeEach(() => {
    // AuthService reads the stored session in its constructor.
    sessionStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors(httpInterceptors)),
        provideHttpClientTesting(),
        provideApi(API),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    notifications = TestBed.inject(NotificationService);
    // Logged in, as the guard requires, so the request goes out as the admin's does.
    TestBed.inject(AuthService).setSession({
      token: 't',
      expiresAt: new Date(NOW + 60_000).toISOString(),
    });
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** The one summary request outstanding, checked to send `from` and to leave `to` to the API. */
  function expectSummary(from: string): TestRequest {
    const request = httpMock.expectOne((candidate) => candidate.url === SUMMARY_URL);
    expect(request.request.urlWithParams).toBe(`${SUMMARY_URL}?from=${from}`);
    return request;
  }

  async function renderWith(summary: AnalyticsSummary): Promise<void> {
    fixture = await renderComponent(AdminAnalyticsComponent);
    expectSummary(DEFAULT_FROM).flush(summary);
    await fixture.whenStable();
  }

  /** Each body row of the table under the h2 named `heading`, as its cells' text. */
  function rowsUnder(heading: string): string[][] {
    const table = tableUnder(heading);
    return [...table.querySelectorAll('tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    );
  }

  /** The table labelled by the h2 named `heading`, found through the label rather than position. */
  function tableUnder(heading: string): HTMLTableElement {
    const h2 = [...host().querySelectorAll('h2')].find((h) => h.textContent?.trim() === heading);
    expect(h2, `no heading "${heading}"`).toBeDefined();
    const table = host().querySelector<HTMLTableElement>(`table[aria-labelledby="${h2!.id}"]`);
    expect(table, `no table labelled by "${heading}"`).not.toBeNull();
    return table!;
  }

  function radio(days: number): HTMLInputElement {
    const label = [...host().querySelectorAll('.range label')].find(
      (candidate) => candidate.textContent?.trim() === `Last ${days} days`,
    );
    expect(label, `no "Last ${days} days" option`).toBeDefined();
    return label!.querySelector('input')!;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function expectNoToast(): void {
    expect(notifications.notifications()).toEqual([]);
  }

  describe('the request', () => {
    it('asks for the last 30 days by default, as a UTC date, with the toast off', async () => {
      fixture = await renderComponent(AdminAnalyticsComponent);

      const request = expectSummary(DEFAULT_FROM);
      expect(request.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
      expect(request.request.headers.get('Authorization')).toBe('Bearer t');
      expect(radio(30).checked).toBe(true);
      expect(radio(7).checked).toBe(false);
      // Loading until the answer comes.
      expect(host().querySelector('[role="status"]')?.textContent).toContain('Loading');

      request.flush(SUMMARY);
      await fixture.whenStable();
      expect(host().querySelector('[role="status"]')).toBeNull();
    });

    it('asks again for 7 and for 90 days, and drops a request the new range replaced', async () => {
      fixture = await renderComponent(AdminAnalyticsComponent);
      const first = expectSummary(DEFAULT_FROM);

      radio(7).click();
      await fixture.whenStable();

      // Abandoned, so its answer can never land under the 7-day selection.
      expect(first.cancelled).toBe(true);
      expect(radio(7).checked).toBe(true);
      expectSummary('2026-10-12').flush(SUMMARY);
      await fixture.whenStable();

      radio(90).click();
      await fixture.whenStable();
      expectSummary('2026-07-21').flush(SUMMARY);
      await fixture.whenStable();

      expect(radio(90).checked).toBe(true);
      expect(tableUnder('By day')).toBeDefined();
    });

    it('still loads the next range after one failed', async () => {
      fixture = await renderComponent(AdminAnalyticsComponent);
      expectSummary(DEFAULT_FROM).flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      expect(host().querySelector('[role="alert"]')).not.toBeNull();

      radio(7).click();
      await fixture.whenStable();
      expectSummary('2026-10-12').flush(SUMMARY);
      await fixture.whenStable();

      expect(host().querySelector('[role="alert"]')).toBeNull();
      expect(rowsUnder('By day')).toHaveLength(3);
    });
  });

  describe('a range with counts', () => {
    it('shows the three totals, each summed over the days, and says what they count', async () => {
      await renderWith(SUMMARY);

      const totals = [...host().querySelectorAll('.totals > div')].map((group) => [
        group.querySelector('dt')?.textContent?.trim(),
        group.querySelector('dd')?.textContent?.trim(),
      ]);
      expect(totals).toEqual([
        ['Views', '1,500'],
        ['Visitor-days', '620'],
        ['Link clicks', '3'],
      ]);
      expect(text()).toContain(
        'A view is a visitor who saw a page that day, not a page load, and visitors are counted ' +
          'per day, so their total is visitor-days.',
      );
      // The range the API applied, which is what the totals cover.
      expect(text()).toContain('2026-10-16 to 2026-10-18, in UTC days.');
    });

    it('lists every day, the empty one included, oldest first', async () => {
      await renderWith(SUMMARY);

      expect(rowsUnder('By day')).toEqual([
        ['2026-10-16', '1,200', '500', '2'],
        ['2026-10-17', '0', '0', '0'],
        ['2026-10-18', '300', '120', '1'],
      ]);
      const dates = [...tableUnder('By day').querySelectorAll('tbody time')];
      expect(dates.map((date) => date.getAttribute('datetime'))).toEqual([
        '2026-10-16',
        '2026-10-17',
        '2026-10-18',
      ]);
    });

    it('draws each day a bar scaled to the busiest day, hidden from assistive technology', async () => {
      await renderWith(SUMMARY);

      const bars = [...tableUnder('By day').querySelectorAll<HTMLElement>('.bar')];
      expect(bars.map((bar) => bar.style.width)).toEqual(['100%', '0%', '25%']);
      for (const bar of bars) {
        expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
      }
    });

    it('draws empty bars, not NaN-wide ones, when no day has a view', async () => {
      // Link clicks with no page views: unusual, but not empty, so the tables are shown.
      const clicksOnly: AnalyticsSummary = {
        ...NOTHING,
        days: NOTHING.days.map((day, index) => ({ ...day, linkClicks: index === 0 ? 1 : 0 })),
      };
      await renderWith(clicksOnly);

      const bars = [...tableUnder('By day').querySelectorAll<HTMLElement>('.bar')];
      expect(bars).toHaveLength(3);
      expect(bars.map((bar) => bar.style.width)).toEqual(['0%', '0%', '0%']);
    });

    it('names each page, in the order the API sends them', async () => {
      await renderWith(SUMMARY);

      expect(rowsUnder('By page')).toEqual([
        ['About', '600'],
        ['Projects list', '400'],
        ['Project pages', '450'],
        ['Contact', '50'],
        ['Privacy', '0'],
      ]);
    });

    it('lists each project with its links, naming a deleted one and a link with no label', async () => {
      await renderWith(SUMMARY);

      expect(rowsUnder('By project')).toEqual([
        ['Equalizer', '400', '2'],
        [`GitHub ${GITHUB}`, '', '2'],
        ['Deleted project', '50', '1'],
        // The URL alone: the project no longer has a link with this URL, so it has no label.
        [OLD_DEMO, '', '1'],
      ]);
      // Grouped, so a project's link rows cannot be read as belonging to the next project.
      expect(tableUnder('By project').tBodies).toHaveLength(2);
    });

    it('says so when no project was viewed or followed, instead of an empty table', async () => {
      await renderWith({ ...SUMMARY, projects: [] });

      expect(tableUnder('By day')).toBeDefined();
      expect(host().querySelector('table[aria-labelledby="analytics-projects"]')).toBeNull();
      expect(text()).toContain('No project page was viewed and no project link was followed in this range.');
    });

    it('gives every header cell a scope and right-aligns every number', async () => {
      await renderWith(SUMMARY);

      const tables = [...host().querySelectorAll('table')];
      expect(tables).toHaveLength(3);
      for (const table of tables) {
        for (const header of table.querySelectorAll('th')) {
          expect(['col', 'row']).toContain(header.getAttribute('scope'));
        }
        // Every column after the first holds numbers, header included.
        for (const row of table.querySelectorAll('tr')) {
          for (const cell of [...row.children].slice(1)) {
            if (cell.textContent?.trim()) {
              expect(getComputedStyle(cell).textAlign, cell.textContent ?? '').toBe('right');
            }
          }
          expect(getComputedStyle(row.children[0]).textAlign).toBe('left');
        }
      }
    });
  });

  describe('a range with nothing in it', () => {
    it('says "No views in this range." and shows no totals or tables', async () => {
      await renderWith(NOTHING);

      expect(text()).toContain('No views in this range.');
      expect(host().querySelector('table')).toBeNull();
      expect(host().querySelector('.totals')).toBeNull();
      expect(host().querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('a failure', () => {
    it('explains a 404 as analytics turned off, naming ANALYTICS_ENABLED, without a toast', async () => {
      fixture = await renderComponent(AdminAnalyticsComponent);
      expectSummary(DEFAULT_FROM).flush(
        { type: 'about:blank', title: 'Not Found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
      await fixture.whenStable();

      expect(text()).toContain('Analytics is turned off on the server, so nothing is being counted.');
      expect(host().querySelector('code')?.textContent).toBe('ANALYTICS_ENABLED=true');
      expect(host().querySelector('table')).toBeNull();
      expectNoToast();
    });

    it.each<[string, number, object | null, string]>([
      // errorInterceptor never toasts a 400 that carries field errors, expecting a form to show
      // them. There is no form here, so this is the case that would otherwise fail silently.
      [
        'a 400 with field errors',
        400,
        {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          errors: [{ field: 'getAnalyticsSummary.from', message: 'The range may be at most 366 days.' }],
        },
        'The range may be at most 366 days.',
      ],
      [
        'a 400 for a date that does not parse',
        400,
        { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'from is not a date.' },
        'from is not a date.',
      ],
      [
        'a 500 with no body',
        500,
        null,
        'The server could not complete this just now. Please try again in a moment (error 500).',
      ],
    ])('renders %s on the page, without a toast', async (_case, status, body, message) => {
      fixture = await renderComponent(AdminAnalyticsComponent);
      expectSummary(DEFAULT_FROM).flush(body, { status, statusText: 'Error' });
      await fixture.whenStable();

      const alert = host().querySelector('[role="alert"]');
      expect(alert?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        `Could not load the analytics. ${message}`,
      );
      expect(host().querySelector('table')).toBeNull();
      expectNoToast();
    });

    it('renders a network failure on the page, without a toast', async () => {
      fixture = await renderComponent(AdminAnalyticsComponent);
      expectSummary(DEFAULT_FROM).error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(host().querySelector('[role="alert"]')?.textContent).toContain(
        'Could not reach the server.',
      );
      expectNoToast();
    });
  });
});

describe('totalsOf', () => {
  it('is all zeros for a range with no days', () => {
    expect(totalsOf({ ...SUMMARY, days: [] })).toEqual({ views: 0, visitorDays: 0, linkClicks: 0 });
  });
});

/**
 * The range's first day, at both sides of UTC midnight and in time zones on both sides of UTC.
 *
 * A machine's own zone decides nothing here. The zone is set for each case, because local-time
 * arithmetic gives the right answer wherever local and UTC dates agree, which in UTC itself is
 * always, and the bug only shows on a machine where they differ at the moment of the test.
 */
describe('rangeStart', () => {
  const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  afterEach(() => {
    // Assigned back rather than deleted: Node keeps the last zone set when TZ is deleted.
    process.env['TZ'] = originalZone;
  });

  const ZONES = ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

  it.each([
    // 23:59 UTC on 1 March is already 2 March in Kiritimati (UTC+14), and 00:00 UTC on 2 March is
    // still 1 March in Pago Pago (UTC-11).
    ['UTC', 1, 2],
    ['Pacific/Kiritimati', 2, 2],
    ['Pacific/Pago_Pago', 1, 1],
  ])('takes the zone it is given in %s, so the cases below are not vacuous', (zone, late, early) => {
    process.env['TZ'] = zone;

    expect(new Date('2026-03-01T23:59:59.999Z').getDate()).toBe(late);
    expect(new Date('2026-03-02T00:00:00.000Z').getDate()).toBe(early);
  });

  describe.each(ZONES)('in %s', (zone) => {
    beforeEach(() => {
      process.env['TZ'] = zone;
    });

    it.each([
      // The last moment of 1 March UTC, and the first of 2 March.
      ['2026-03-01T23:59:59.999Z', 30, '2026-01-31'],
      ['2026-03-02T00:00:00.000Z', 30, '2026-02-01'],
      ['2026-03-01T23:59:59.999Z', 7, '2026-02-23'],
      ['2026-03-02T00:00:00.000Z', 7, '2026-02-24'],
      // Across a year end, and into a leap day.
      ['2026-01-03T00:00:00.000Z', 7, '2025-12-28'],
      ['2028-03-01T12:00:00.000Z', 2, '2028-02-29'],
      // A one-day range is today.
      ['2026-10-18T23:59:59.999Z', 1, '2026-10-18'],
      ['2026-10-18T12:00:00.000Z', 90, '2026-07-21'],
    ])('at %s, %i days start on %s', (now, days, expected) => {
      expect(rangeStart(days, Date.parse(now))).toBe(expected);
    });
  });
});
