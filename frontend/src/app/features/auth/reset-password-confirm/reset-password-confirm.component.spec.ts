import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { renderComponent, submitForm, typeInto } from '../../../../testing/zoneless';
import { AuthService as AuthApiService } from '../../../core/api/api/auth.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { ResetPasswordConfirmComponent } from './reset-password-confirm.component';

/**
 * The rejection both password-reset endpoints send for a spent token, verbatim from issue #185's
 * capture against production. Written out rather than abbreviated because the whole defect was a
 * belief about this body -- the component asserted in a comment that it carried "no field errors",
 * and it carries exactly one, which is why errorInterceptor deliberately never toasted it.
 */
const SPENT_TOKEN: ApiProblem = {
  status: 400,
  title: 'Invalid Reset Token',
  detail: 'Invalid or expired reset token',
  fieldErrors: [{ field: 'token', message: 'Invalid or expired reset token' }],
  rateLimited: false,
};

const RATE_LIMITED: ApiProblem = {
  status: 429,
  title: 'Too Many Requests',
  detail: 'Too many password reset token checks',
  fieldErrors: [],
  rateLimited: true,
};

const SERVER_ERROR: ApiProblem = {
  status: 500,
  title: 'Request failed (500).',
  fieldErrors: [],
  rateLimited: false,
};

function problemWith(fieldErrors: { field: string; message: string }[]): ApiProblem {
  return {
    status: 400,
    title: 'Validation Failed',
    detail: 'Request failed validation',
    fieldErrors,
    rateLimited: false,
  };
}

function routeWith(token: string | null) {
  return { snapshot: { queryParamMap: convertToParamMap(token === null ? {} : { token }) } };
}

/** Collapsed so template indentation does not reach the assertion and the copy can be read whole. */
function textOf(fixture: ComponentFixture<unknown>, selector: string): string | null {
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return element ? (element.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
}

function hasForm(fixture: ComponentFixture<unknown>): boolean {
  return (fixture.nativeElement as HTMLElement).querySelector('form') !== null;
}

describe('ResetPasswordConfirmComponent', () => {
  // Typed rather than left as ReturnType<typeof vi.fn>, which infers Mock<Procedure |
  // Constructable> and is then not callable through the indirection below.
  let validate: Mock<(...args: unknown[]) => unknown>;
  let confirm: Mock<(...args: unknown[]) => unknown>;

  beforeEach(async () => {
    // Reassignable through the indirection below, so a test can change what the API answers after
    // the module is configured but before the component -- which constructs and calls validate in
    // the same breath -- is created.
    validate = vi.fn<(...args: unknown[]) => unknown>().mockReturnValue(of(null));
    confirm = vi.fn<(...args: unknown[]) => unknown>().mockReturnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [ResetPasswordConfirmComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthApiService,
          useValue: {
            validatePasswordResetToken: (...args: unknown[]) => validate(...args),
            confirmPasswordReset: (...args: unknown[]) => confirm(...args),
          },
        },
        { provide: ActivatedRoute, useValue: routeWith('good-token') },
      ],
    }).compileComponents();
  });

  /** Fill both fields through the DOM, so the controls are dirty and the group validates. */
  async function fillPasswords(
    fixture: ComponentFixture<ResetPasswordConfirmComponent>,
  ): Promise<void> {
    await typeInto(fixture, '#reset-new-password', 'correct horse battery');
    await typeInto(fixture, '#reset-confirm-password', 'correct horse battery');
  }

  it('checks the token on route entry rather than waiting for a submit', async () => {
    await renderComponent(ResetPasswordConfirmComponent);

    expect(validate).toHaveBeenCalledWith({ passwordResetValidateBody: { token: 'good-token' } });
  });

  it('shows no form while the check is still in flight', async () => {
    // Never emits: a form that appears and is then taken away is barely better than the bug, so
    // the assertion is that nothing fillable exists yet -- not merely that a message also exists.
    validate.mockReturnValue(new Subject());

    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    expect(hasForm(fixture)).toBe(false);
    expect(textOf(fixture, '[role="status"]')).toBe('Checking this reset link…');
  });

  it('renders the form once the link validates', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    expect(hasForm(fixture)).toBe(true);
    expect(textOf(fixture, '.link-dead')).toBeNull();
    expect(textOf(fixture, '.notice')).toBeNull();
  });

  it('replaces the form with a dead-link state when the check rejects the token', async () => {
    validate.mockReturnValue(throwError(() => SPENT_TOKEN));

    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    expect(hasForm(fixture)).toBe(false);
    expect(textOf(fixture, '.link-dead')).toContain('This reset link no longer works.');
    expect(textOf(fixture, '.link-dead')).toContain('Request a new link');
  });

  it('offers a route to a fresh link, and stays on the reset page to do it', async () => {
    validate.mockReturnValue(throwError(() => SPENT_TOKEN));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl');

    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector<HTMLAnchorElement>('.link-dead a')?.getAttribute('href')).toBe(
      '/admin/forgot-password',
    );
    // A redirect would read as the app having lost the reader's place, and a banner shown after a
    // navigation is easy to miss -- see #187.
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('treats a rate-limited check as unchecked, not as a dead link', async () => {
    validate.mockReturnValue(throwError(() => RATE_LIMITED));

    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    // The distinction that matters: a 429 says something about this network's request rate and
    // nothing at all about this token, so calling the link dead here sends people off to request
    // links they do not need.
    expect(textOf(fixture, '.link-dead')).toBeNull();
    expect(hasForm(fixture)).toBe(true);
    expect(textOf(fixture, '.notice')).toContain('too many checks have come from your network');
  });

  it('leaves the form usable when the check fails for a reason that is not a rejection', async () => {
    validate.mockReturnValue(throwError(() => SERVER_ERROR));

    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    expect(hasForm(fixture)).toBe(true);
    expect(textOf(fixture, '.link-dead')).toBeNull();
    expect(textOf(fixture, '.notice')).toContain('could not be checked just now');
  });

  it('says the link is incomplete, without asking the backend, when there is no token', async () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: routeWith(null) });

    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    expect(validate).not.toHaveBeenCalled();
    expect(hasForm(fixture)).toBe(false);
    expect(textOf(fixture, '.link-dead')).toContain('This reset link is incomplete.');
  });

  it('treats a whitespace-only token as missing rather than sending it to be rejected', async () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: routeWith('   ') });

    const fixture = await renderComponent(ResetPasswordConfirmComponent);

    expect(validate).not.toHaveBeenCalled();
    expect(textOf(fixture, '.link-dead')).toContain('This reset link is incomplete.');
  });

  /**
   * #185's regression test, and the one that fails against the component as it stood: the response
   * carries a single field error keyed `token`, no `token` input exists to render it, and
   * errorInterceptor stays quiet precisely because field errors are present. The old handler set
   * `submitting` back to false and did nothing else, so the button appeared not to work.
   *
   * Still reachable after #187, which is why the two land together -- a token can expire between
   * the check on load and the submit.
   */
  it('shows the token rejection from a submit instead of swallowing it', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    await fillPasswords(fixture);
    confirm.mockReturnValue(throwError(() => SPENT_TOKEN));

    await submitForm(fixture);

    expect(textOf(fixture, '.link-dead')).toContain('Your password was not changed.');
    expect(textOf(fixture, '.link-dead')).toContain('Request a new link');
    // Different words from the load-time state: this reader has typed a password and needs telling
    // it did not take effect, which the arrival-time copy has no reason to say.
    expect(textOf(fixture, '.link-dead')).not.toContain('This reset link no longer works.');
    expect(hasForm(fixture)).toBe(false);
  });

  it('renders a rejection of the new password beside the field it names', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    await fillPasswords(fixture);
    confirm.mockReturnValue(
      throwError(() =>
        problemWith([{ field: 'newPassword', message: 'size must be between 8 and 100' }]),
      ),
    );

    await submitForm(fixture);

    expect(textOf(fixture, '#reset-new-password-error')).toBe('size must be between 8 and 100');
    expect(hasForm(fixture)).toBe(true);
  });

  it('surfaces a rejection keyed to something no slot on the page claims', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    await fillPasswords(fixture);
    confirm.mockReturnValue(
      throwError(() => problemWith([{ field: 'honeypot', message: 'must not be blank' }])),
    );

    await submitForm(fixture);

    // Deliberately none of the server's own words -- the key names nothing this page shows, and
    // the message beside it is a Bean Validation default written for a developer.
    expect(textOf(fixture, '.form-error')).toContain('Your password was not changed.');
    expect(textOf(fixture, '.form-error')).not.toContain('honeypot');
  });

  it('does not treat a rejection as slotted just because Object.prototype has the key', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    await fillPasswords(fixture);
    confirm.mockReturnValue(
      throwError(() => problemWith([{ field: 'toString', message: 'must not be blank' }])),
    );

    await submitForm(fixture);

    expect(textOf(fixture, '.form-error')).toContain('Your password was not changed.');
  });

  it('confirms the reset and offers the way back in', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    await fillPasswords(fixture);

    await submitForm(fixture);

    expect(confirm).toHaveBeenCalledWith({
      passwordResetConfirmBody: { token: 'good-token', newPassword: 'correct horse battery' },
    });
    expect(textOf(fixture, '[role="status"]')).toBe('Your password has been updated.');
    expect(hasForm(fixture)).toBe(false);
  });

  it('does not submit a password the form itself rejects', async () => {
    const fixture = await renderComponent(ResetPasswordConfirmComponent);
    await typeInto(fixture, '#reset-new-password', 'short');
    await typeInto(fixture, '#reset-confirm-password', 'short');

    await submitForm(fixture);

    expect(confirm).not.toHaveBeenCalled();
    expect(textOf(fixture, '#reset-new-password-error')).toBe(
      'Password must be at least 8 characters',
    );
  });
});
