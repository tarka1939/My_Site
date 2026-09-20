import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { renderComponent, submitForm, typeInto } from '../../../../testing/zoneless';
import { AboutService } from '../../../core/api/api/about.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ABOUT_BODY_MAX_CHARS, AdminAboutFormComponent } from './admin-about-form.component';

const STORED = { body: 'Existing **text**.', updatedAt: '2026-09-20T10:00:00Z' };

describe('AdminAboutFormComponent', () => {
  let getAboutPage: ReturnType<typeof vi.fn>;
  let updateAboutPage: ReturnType<typeof vi.fn>;
  let info: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sessionStorage.clear();
    getAboutPage = vi.fn().mockReturnValue(of(STORED));
    updateAboutPage = vi.fn().mockReturnValue(of(STORED));
    info = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminAboutFormComponent],
      providers: [
        provideRouter([]),
        { provide: AboutService, useValue: { getAboutPage, updateAboutPage } },
        { provide: NotificationService, useValue: { info, error: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('loads the current body into the editor and previews it', async () => {
    const fixture = await renderComponent(AdminAboutFormComponent);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector<HTMLTextAreaElement>('#about-body')?.value).toBe(STORED.body);
    // The preview is populated from the loaded value, not only from later keystrokes -- the
    // edit case, where a blank preview beside a full textarea would be wrong.
    expect(host.querySelector('.markdown-body strong')?.textContent).toBe('text');
  });

  it('previews what is typed, through the same renderer as the public page', async () => {
    const fixture = await renderComponent(AdminAboutFormComponent);

    await typeInto(fixture, '#about-body', '## Draft\n\n- a\n- b');

    const rendered = (fixture.nativeElement as HTMLElement).querySelector('.markdown-body')!;
    expect(rendered.querySelector('h2')?.textContent).toBe('Draft');
    expect(Array.from(rendered.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'a',
      'b',
    ]);
  });

  it('does not execute markup typed into the editor', async () => {
    const fixture = await renderComponent(AdminAboutFormComponent);

    await typeInto(fixture, '#about-body', '<script>window.pwnedAboutAdmin = true;</script>');

    const preview = (fixture.nativeElement as HTMLElement).querySelector('.markdown-preview')!;
    expect(preview.querySelector('script')).toBeNull();
    expect((globalThis as Record<string, unknown>)['pwnedAboutAdmin']).toBeUndefined();
    // The load-bearing assertion, as in the project form's spec: this is what pins `html: false`.
    expect(preview.textContent).toContain('<script>');
  });

  it('PUTs the body on save and confirms without navigating away', async () => {
    updateAboutPage.mockReturnValue(of({ ...STORED, body: 'Replaced.' }));
    const fixture = await renderComponent(AdminAboutFormComponent);

    await typeInto(fixture, '#about-body', 'Replaced.');
    await submitForm(fixture);

    expect(updateAboutPage).toHaveBeenCalledWith({ aboutPageWriteRequest: { body: 'Replaced.' } });
    expect(info).toHaveBeenCalledWith('About page saved.');
    // Re-seeded from the response, so the editor shows what was stored rather than what was sent.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('#about-body')
        ?.value,
    ).toBe('Replaced.');
  });

  it('sends an empty body as a valid save, which is how the page is cleared', async () => {
    updateAboutPage.mockReturnValue(of({ ...STORED, body: '' }));
    const fixture = await renderComponent(AdminAboutFormComponent);

    await typeInto(fixture, '#about-body', '');
    await submitForm(fixture);

    expect(updateAboutPage).toHaveBeenCalledWith({ aboutPageWriteRequest: { body: '' } });
  });

  it('refuses to save a body over the contract limit, before any round trip', async () => {
    const fixture = await renderComponent(AdminAboutFormComponent);

    await typeInto(fixture, '#about-body', 'x'.repeat(ABOUT_BODY_MAX_CHARS + 1));
    await submitForm(fixture);

    expect(updateAboutPage).not.toHaveBeenCalled();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#about-body-error')?.textContent).toContain('20,000');
    expect(host.querySelector('#about-body')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a server verdict on the body under the field, and clears it on the next edit', async () => {
    const problem: Partial<ApiProblem> = {
      fieldErrors: [{ field: 'body', message: 'must not contain that' }],
    };
    updateAboutPage.mockReturnValue(throwError(() => problem));
    const fixture = await renderComponent(AdminAboutFormComponent);

    await typeInto(fixture, '#about-body', 'bad');
    await submitForm(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#about-body-error')?.textContent).toContain('must not contain that');

    await typeInto(fixture, '#about-body', 'bad, edited');
    expect(host.querySelector('#about-body-error')).toBeNull();
  });

  it('disables saving when the current page could not be loaded', async () => {
    // Saving over a page whose current text is unknown is a blind overwrite: PUT is a full
    // replacement, so a save here would erase whatever the failed load would have shown.
    getAboutPage.mockReturnValue(throwError(() => new Error('network')));
    const fixture = await renderComponent(AdminAboutFormComponent);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('saving is disabled');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    await submitForm(fixture);
    expect(updateAboutPage).not.toHaveBeenCalled();
  });
});
