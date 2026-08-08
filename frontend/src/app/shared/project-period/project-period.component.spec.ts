import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectPeriodComponent } from './project-period.component';

function renderPeriod(
  startedOn: string | null,
  completedOn: string | null,
): { fixture: ComponentFixture<ProjectPeriodComponent>; host: HTMLElement } {
  const fixture = TestBed.createComponent(ProjectPeriodComponent);
  fixture.componentRef.setInput('startedOn', startedOn);
  fixture.componentRef.setInput('completedOn', completedOn);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

/** What a sighted reader sees: everything except the visually hidden screen-reader scaffolding. */
function visibleText(host: HTMLElement): string {
  const period = host.querySelector('.project-period');
  if (!period) {
    return '';
  }
  const clone = period.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.visually-hidden').forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** What a screen reader gets: everything except the aria-hidden decoration. */
function announcedText(host: HTMLElement): string {
  const period = host.querySelector('.project-period');
  if (!period) {
    return '';
  }
  const clone = period.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

describe('ProjectPeriodComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProjectPeriodComponent] }).compileComponents();
  });

  it('renders a completed period as a month/year range', () => {
    const { host } = renderPeriod('2024-03-01', '2025-06-01');

    expect(visibleText(host)).toBe('March 2024 – June 2025');

    const times = host.querySelectorAll('time');
    expect(times.length).toBe(2);
    expect(times[0].getAttribute('datetime')).toBe('2024-03');
    expect(times[1].getAttribute('datetime')).toBe('2025-06');
  });

  it('never renders the stored day, in the text or in the datetime attribute', () => {
    // The day is a storage artefact (the convention is the 1st of the month) and the source data
    // cannot support day-level accuracy -- rendering one would assert something untrue.
    const { host } = renderPeriod('2024-03-17', '2025-06-29');

    expect(visibleText(host)).toBe('March 2024 – June 2025');
    const datetimes = [...host.querySelectorAll('time')].map((t) => t.getAttribute('datetime'));
    expect(datetimes).toEqual(['2024-03', '2025-06']);
  });

  it('renders an ongoing project as ongoing rather than as an empty end', () => {
    const { host } = renderPeriod('2024-03-01', null);

    expect(visibleText(host)).toBe('March 2024 – ongoing');
    expect(host.querySelector('.is-ongoing')).not.toBeNull();
    // One date, not two: there is no second <time> with an empty datetime.
    expect(host.querySelectorAll('time').length).toBe(1);
    expect(announcedText(host)).toBe('Project period: March 2024, ongoing');
  });

  it('renders nothing at all when neither date is set', () => {
    const { host } = renderPeriod(null, null);

    expect(host.querySelector('.project-period')).toBeNull();
    expect(host.querySelectorAll('time').length).toBe(0);
    // No empty label and no stray dash left behind.
    expect((host.textContent ?? '').trim()).toBe('');
  });

  it('collapses a period that starts and ends in the same month', () => {
    const { host } = renderPeriod('2024-03-05', '2024-03-28');

    expect(visibleText(host)).toBe('March 2024');
    expect(host.querySelectorAll('time').length).toBe(1);
  });

  it('announces the range with a connector, not a bare dash', () => {
    const { host } = renderPeriod('2024-03-01', '2025-06-01');

    expect(announcedText(host)).toBe('Project period: March 2024 to June 2025');
  });

  it('still shows a completion date that arrives without a start date', () => {
    // The API and a table CHECK constraint both reject this combination, so it should be
    // unreachable -- but the generated type permits it, and dropping a date the server sent would
    // be worse than rendering an odd-looking one.
    const { host } = renderPeriod(null, '2025-06-01');

    expect(visibleText(host)).toBe('completed June 2025');
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2025-06');
  });

  it('renders nothing for a malformed date instead of throwing', () => {
    const { host } = renderPeriod('not-a-date', null);

    expect(host.querySelector('.project-period')).toBeNull();
  });
});
