import { ComponentFixture, TestBed } from '@angular/core/testing';
import { config, of, throwError } from 'rxjs';
import { renderComponent, submitForm, typeInto } from '../../../../testing/zoneless';
import { ContactService } from '../../../core/api/api/contact.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { ContactFormComponent } from './contact-form.component';

const ACK = { id: '1', createdAt: '2026-08-16T00:00:00Z' };

/** A 400 carrying several violations at once, which is what the API sends -- it does not dedup. */
function problemWith(fieldErrors: { field: string; message: string }[]): ApiProblem {
  return {
    status: 400,
    title: 'Bad Request',
    detail: 'Request failed validation',
    fieldErrors,
    rateLimited: false,
  };
}

function validationProblem(field: string, message: string): ApiProblem {
  return problemWith([{ field, message }]);
}

// Every interaction below goes through a real DOM event and whenStable(), never detectChanges().
// The convention, and the two things it deliberately does not claim, live in
// src/testing/zoneless.ts.

function type(
  fixture: ComponentFixture<ContactFormComponent>,
  selector: string,
  value: string,
): Promise<void> {
  return typeInto(fixture, selector, value);
}

/** Send the way a visitor does -- submit the form, rather than calling submit() directly. */
function send(fixture: ComponentFixture<ContactFormComponent>): Promise<void> {
  return submitForm(fixture);
}

/** Type something all three validators accept, through the DOM, so the controls are dirty too. */
async function fillValidMessage(fixture: ComponentFixture<ContactFormComponent>): Promise<void> {
  await type(fixture, '#contact-name', 'Ada Lovelace');
  await type(fixture, '#contact-email', 'ada@example.com');
  await type(fixture, '#contact-message', 'Hello there');
}

function errorTextFor(host: HTMLElement, fieldId: string): string | null {
  const field = host.querySelector(`#${fieldId}`)?.closest('.field');
  return field?.querySelector('.field-error')?.textContent?.trim() ?? null;
}

/** The catch-all's text with template indentation collapsed, so the copy can be asserted whole. */
function bannerText(host: HTMLElement): string | null {
  const region = host.querySelector('.form-error');
  return region ? (region.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
}

/**
 * Pinned verbatim, because in this region the wording *is* the behaviour. Three earlier versions
 * were each accurate about the mechanism and wrong about the reader: one printed the backend's
 * field key, one said the site could not tell which part when the server had said exactly which
 * part, and one told the visitor to try again when a renamed field rejects every attempt alike.
 * None of that is reachable through a structural assertion -- only through the sentence.
 */
const CATCH_ALL_COPY =
  'Your message was not sent. The site refused it for a reason it cannot show you here, and ' +
  'nothing you change above will get past it — this is a fault on my side, not in what you ' +
  'wrote. Sending it again will most likely fail the same way.';

const FIELD_IDS = ['contact-name', 'contact-email', 'contact-message'];

describe('ContactFormComponent', () => {
  let submitContactMessage: ReturnType<typeof vi.fn>;

  function render(): Promise<ComponentFixture<ContactFormComponent>> {
    return renderComponent(ContactFormComponent);
  }

  beforeEach(async () => {
    submitContactMessage = vi.fn().mockReturnValue(of(ACK));

    await TestBed.configureTestingModule({
      imports: [ContactFormComponent],
      providers: [{ provide: ContactService, useValue: { submitContactMessage } }],
    }).compileComponents();
  });

  it('does not submit an invalid form', async () => {
    const fixture = await render();

    await send(fixture);

    expect(submitContactMessage).not.toHaveBeenCalled();
    expect(fixture.componentInstance['form'].touched).toBe(true);
  });

  it('submits a valid form and shows the confirmation message', async () => {
    const fixture = await render();
    await fillValidMessage(fixture);

    await send(fixture);

    expect(submitContactMessage).toHaveBeenCalledWith({
      contactMessageWriteRequest: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        message: 'Hello there',
      },
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Thanks for reaching out');
    expect(host.querySelector('form')).toBeNull();
  });

  describe('this form’s own validation messages', () => {
    it('names every empty field when a blank form is sent, and sends nothing', async () => {
      // The reported failure: the validators blocked submit() and the template rendered only
      // fieldErrors(), which holds server messages -- and an invalid form never reaches the server.
      // So Send did nothing, said nothing, and looked broken rather than invalid.
      const fixture = await render();

      await send(fixture);

      expect(submitContactMessage).not.toHaveBeenCalled();
      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-name')).toBe('Name is required');
      expect(errorTextFor(host, 'contact-email')).toBe('Email is required');
      expect(errorTextFor(host, 'contact-message')).toBe('Message is required');
      for (const id of FIELD_IDS) {
        const message = host.querySelector(`#${id}-error`);
        expect(message?.getAttribute('role')).toBe('alert');
        expect(message?.textContent?.trim()).toBeTruthy();
      }
    });

    it('says what is wrong with a malformed email', async () => {
      // The symptom in the report: a visitor types an address the server would reject, presses
      // Send, and nothing at all happens. Nobody arriving at this form has been told the rules, so
      // the message names the shape it wants rather than only calling the value wrong.
      const fixture = await render();
      await type(fixture, '#contact-name', 'Ada Lovelace');
      await type(fixture, '#contact-email', 'ada@');
      await type(fixture, '#contact-message', 'Hello there');

      await send(fixture);

      expect(submitContactMessage).not.toHaveBeenCalled();
      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-email')).toBe(
        'Enter a valid email address, like name@example.com',
      );
      // The other two are fine, so they stay quiet -- a wrong email must not scold the whole form.
      expect(errorTextFor(host, 'contact-name')).toBeNull();
      expect(errorTextFor(host, 'contact-message')).toBeNull();
    });

    it('reports a message over the contract limit', async () => {
      // maxLength(5000) mirrors ContactMessageWriteRequest in docs/openapi.yaml. Without a rendered
      // message this is the worst case of the bug: a visitor who wrote something long presses Send
      // and is told nothing, with no hint that shortening it is what is being asked for.
      const fixture = await render();
      await type(fixture, '#contact-name', 'Ada Lovelace');
      await type(fixture, '#contact-email', 'ada@example.com');
      await type(fixture, '#contact-message', 'x'.repeat(5001));

      await send(fixture);

      expect(submitContactMessage).not.toHaveBeenCalled();
      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-message')).toBe('Message cannot exceed 5000 characters');
    });

    it('says nothing about a field the visitor has not reached yet', async () => {
      // A form that opens covered in complaints is its own defect. The gate is per control, not
      // per form: typing a bad email must not also flag the two fields nobody has touched.
      const fixture = await render();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelectorAll('.field-error')).toHaveLength(0);
      for (const id of FIELD_IDS) {
        expect(host.querySelector(`#${id}`)?.getAttribute('aria-invalid')).toBeNull();
      }

      await type(fixture, '#contact-email', 'ada@');

      expect(errorTextFor(host, 'contact-email')).toBeTruthy();
      expect(errorTextFor(host, 'contact-name')).toBeNull();
      expect(errorTextFor(host, 'contact-message')).toBeNull();
      expect(host.querySelector('#contact-name')?.getAttribute('aria-invalid')).toBeNull();
      expect(host.querySelector('#contact-message')?.getAttribute('aria-invalid')).toBeNull();
    });

    it('points every invalid field at a message that resolves to real text', async () => {
      // aria-invalid alone tells a screen-reader user the field is wrong without saying why:
      // role="alert" fires once as the message appears and nothing re-announces it afterwards, so
      // the description is what carries the reason on every later visit. A dangling
      // aria-describedby id is announced as nothing at all, hence resolving each one -- and the id
      // has to be absent while there is no message, which is what hardcoding it would get wrong.
      const fixture = await render();
      const host = fixture.nativeElement as HTMLElement;

      for (const id of FIELD_IDS) {
        expect(host.querySelector(`#${id}`)?.getAttribute('aria-describedby')).toBeNull();
      }

      await send(fixture);

      for (const id of FIELD_IDS) {
        const field = host.querySelector(`#${id}`);
        expect(field?.getAttribute('aria-invalid')).toBe('true');
        const describedBy = field?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
        expect(describedBy.length).toBeGreaterThan(0);
        const described = describedBy.map((ref) =>
          host.querySelector(`#${ref}`)?.textContent?.trim(),
        );
        expect(described.every((text) => !!text)).toBe(true);
      }
    });

    it('clears a message once the visitor fixes the field', async () => {
      // The slot has to track the control both ways. A computed that reads only touched/dirty and
      // errors caches its first answer forever, because AbstractControl exposes those through
      // untracked() -- and a stale complaint on a field that is now correct is the same class of
      // lie as no complaint on one that is wrong.
      const fixture = await render();
      const host = fixture.nativeElement as HTMLElement;
      await send(fixture);

      expect(errorTextFor(host, 'contact-email')).toBe('Email is required');

      await type(fixture, '#contact-email', 'ada@example.com');

      expect(errorTextFor(host, 'contact-email')).toBeNull();
      expect(host.querySelector('#contact-email')?.getAttribute('aria-invalid')).toBeNull();
      expect(host.querySelector('#contact-email')?.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('server field errors', () => {
    it('shows a server field error for a value its own validators accept', async () => {
      // Client validators are a shortcut, not the authority. The two halves share one slot, so the
      // client message must not crowd out the server's.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('email', 'must be a well-formed email address')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-email')).toBe('must be a well-formed email address');
      expect(host.querySelector('#contact-email')?.getAttribute('aria-invalid')).toBe('true');
      // Claimed by a field slot means claimed for good -- it must not be repeated in the catch-all,
      // and Send has nothing to be described by.
      expect(host.querySelector('.form-error')).toBeNull();
      expect(host.querySelector('button[type="submit"]')?.getAttribute('aria-describedby')).toBeNull();
    });

    it('lets this form’s message take over from the server’s while the field is wrong', async () => {
      // A server verdict describes the value that was sent. Once the visitor edits the field it is
      // describing something that no longer exists, so the live client message is the true one --
      // and it has to win the moment the control goes into violation, not on the next send.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('email', 'this address bounced')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);
      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-email')).toBe('this address bounced');

      await type(fixture, '#contact-email', 'ada@');

      expect(errorTextFor(host, 'contact-email')).toBe(
        'Enter a valid email address, like name@example.com',
      );
    });

    it('surfaces a server key that no field slot claims', async () => {
      // errorInterceptor deliberately stays quiet for any 400 that carries field errors, so a key
      // this form does not enumerate is a message rejected in total silence -- and the person it
      // happens to is a visitor with no other way to find out. The backend owns the field names
      // and can rename one without this form changing, so the catch-all is the backstop.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('body', 'must not be blank')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.form-error[role="alert"]')).not.toBeNull();
      expect(bannerText(host)).toBe(CATCH_ALL_COPY);
      // No field slot may show it, or it would be painted on a control that is not at fault.
      for (const id of FIELD_IDS) {
        expect(errorTextFor(host, id)).toBeNull();
      }
      // role="alert" announces it once on insertion; the description carries the reason to anyone
      // who arrives at Send afterwards.
      const describedBy = host
        .querySelector('button[type="submit"]')
        ?.getAttribute('aria-describedby');
      expect(describedBy).toBe('contact-form-error');
      expect(host.querySelector(`#${describedBy}`)?.textContent?.trim()).toBeTruthy();
    });

    it('keeps the server’s field key and its wording off a public page', async () => {
      // This shipped: the catch-all rendered the raw key in monospace followed by the Bean
      // Validation default, so a bot tripping a honeypot showed a visitor "honeypot must not be
      // blank". Right on the admin form, where the reader knows what `links[0].label` means; here
      // it reads as a leaked stack trace to someone who has just lost what they wrote. Neither
      // half may reach the DOM -- stripping only the key leaves "must not be blank" about a field
      // they cannot see, which is no better.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('honeypot', 'must not be blank')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.form-error')).not.toBeNull();
      expect(host.textContent).not.toContain('honeypot');
      expect(host.textContent).not.toContain('must not be blank');
    });

    it('treats a server key named after a prototype member as unclaimed', async () => {
      // The reachable half of the prototype hazard, where the key does come off the wire: asking
      // `'toString' in scalarSlots` answers true, which would count the rejection as claimed by a
      // slot that then renders nothing for it -- the silent drop, back via Object.prototype.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('toString', 'must not be blank')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.form-error')?.textContent).toContain('Your message was not sent');
      for (const id of FIELD_IDS) {
        expect(errorTextFor(host, id)).toBeNull();
      }
    });

    it.each([null, undefined, '', '   '])(
      'surfaces an unclaimed key whose message is %p, identically to a real one',
      async (message) => {
        // Not the same assertion as the test above with a different fixture: what this pins is that
        // the banner does not depend on the message *value* at all. An implementation that asked
        // `!slotted.includes(key) && !!message` -- "only complain if the server actually said
        // something" -- passes the test above and fails every case here, and it is the shape this
        // codebase has already shipped twice under a different name. Same visible outcome as a
        // full message, asserted against the same constant, is the property.
        submitContactMessage.mockReturnValue(
          throwError(() => problemWith([{ field: 'body', message: message as unknown as string }])),
        );

        const fixture = await render();
        await fillValidMessage(fixture);

        await send(fixture);

        const host = fixture.nativeElement as HTMLElement;
        expect(bannerText(host)).toBe(CATCH_ALL_COPY);
        // And nothing stringifies its way onto the page. `{{ null }}` renders empty, but anything
        // that reached for String(message) or a template literal would put "null" in front of a
        // visitor.
        expect(host.textContent).not.toContain('null');
        expect(host.textContent).not.toContain('undefined');
      },
    );

    it('still says something when the server names a field but gives no message', async () => {
      // Not reachable from this backend today -- every field error comes from Bean Validation with
      // a message -- but this is the one path whose entire contract is that a rejection reaches a
      // destination. A blank message is falsy, so the slot would render nothing while the catch-all
      // had already counted the key as claimed and shown: a rejection with nowhere left to appear.
      // Asserted verbatim because the wording is the point: "Rejected by the server, which gave no
      // reason" is the admin form's line, and it was this one's too until it was noticed that a
      // visitor can do nothing with it.
      submitContactMessage.mockReturnValue(
        throwError(() => problemWith([{ field: 'email', message: '   ' }])),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-email')).toBe(
        'This was not accepted, but the site did not say why — try changing it.',
      );
      expect(host.querySelector('#contact-email')?.getAttribute('aria-invalid')).toBe('true');
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('shows both messages when the server names one field twice', async () => {
      // The API emits one entry per violation with no dedup, so one field can be named twice in one
      // response; folding that into a message per key kept the last and discarded the first before
      // the slot ran. Not reachable through this form today -- each control mirrors the server's
      // @Size with a client maxLength, so the double-violation combinations are blocked before the
      // round trip -- but that is a property of these three validators, not a promise about what
      // the server sends, and the same fold is what drops a message in the admin form.
      //
      // One exact string, not two toContain()s: a presence check cannot tell "both rendered" from
      // "one rendered", which is the vacuity this suite has been caught by before.
      submitContactMessage.mockReturnValue(
        throwError(() =>
          problemWith([
            { field: 'email', message: 'must be a well-formed email address' },
            { field: 'email', message: 'size must be between 0 and 320' },
          ]),
        ),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-email')).toBe(
        'must be a well-formed email address; size must be between 0 and 320',
      );
      expect(host.querySelector('#contact-email')?.getAttribute('aria-invalid')).toBe('true');
      // Claimed by a slot means claimed for good -- neither copy may reappear in the catch-all.
      expect(bannerText(host)).toBeNull();
    });

    it('still shows a single violation as exactly what the server said', async () => {
      // The list is per field, not a list rendered as one: one message must still arrive as itself,
      // with no separator, no bracket and no fallback wording anywhere near it.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('name', 'must not be blank')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);

      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-name')).toBe('must not be blank');
      expect(bannerText(host)).toBeNull();
    });

    it('takes down the previous rejection when the client blocks the resend', async () => {
      // submit() returned on form.invalid *before* clearing fieldErrors, so a rejection from a send
      // that is over stayed on screen beside the client message about a resend that never left.
      // The visitor reads both as the answer to the button they just pressed.
      //
      // The server's verdict is on `name` and the field broken afterwards is `email`: where they
      // are the same control the client message takes the slot regardless, so that version of this
      // test would pass with the stale verdict still in the map.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('name', 'that name is not accepted')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);
      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-name')).toBe('that name is not accepted');

      await type(fixture, '#contact-email', 'ada@');
      await send(fixture);

      // Blocked: nothing new can have been said about the name.
      expect(submitContactMessage).toHaveBeenCalledTimes(1);
      // The disappearance is the assertion. Checking only that the email now complains would pass
      // with the name's verdict still showing underneath it.
      expect(errorTextFor(host, 'contact-name')).toBeNull();
      expect(host.querySelector('#contact-name')?.getAttribute('aria-invalid')).toBeNull();
      expect(errorTextFor(host, 'contact-email')).toBe(
        'Enter a valid email address, like name@example.com',
      );
    });

    it('takes down the catch-all banner when the client blocks the resend', async () => {
      // The banner says nothing the visitor changes will get past it -- true of the send it came
      // from, and not a claim to keep making about a send that has not happened.
      submitContactMessage.mockReturnValue(
        throwError(() => validationProblem('honeypot', 'must be blank')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);
      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(bannerText(host)).toBe(CATCH_ALL_COPY);

      await type(fixture, '#contact-message', '');
      await send(fixture);

      expect(submitContactMessage).toHaveBeenCalledTimes(1);
      expect(bannerText(host)).toBeNull();
      expect(host.querySelector('button[type="submit"]')?.getAttribute('aria-describedby')).toBeNull();
      expect(errorTextFor(host, 'contact-message')).toBe('Message is required');
    });

    it('clears the previous rejection when the next send fails without field errors', async () => {
      // A 429 from the contact rate limiter carries no field errors, so nothing overwrites the map.
      // Without the reset in submit() the first rejection's messages stay on screen describing a
      // send that is over, next to a banner about a different failure entirely.
      submitContactMessage.mockReturnValueOnce(
        throwError(() => validationProblem('email', 'must be a well-formed email address')),
      );

      const fixture = await render();
      await fillValidMessage(fixture);
      await send(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(errorTextFor(host, 'contact-email')).toBe('must be a well-formed email address');

      submitContactMessage.mockReturnValue(
        throwError(() => ({
          status: 429,
          title: 'Too many requests',
          fieldErrors: [],
          rateLimited: true,
        })),
      );
      await send(fixture);

      expect(errorTextFor(host, 'contact-email')).toBeNull();
      expect(host.querySelector('.form-error')).toBeNull();
    });

    it('survives a rejection that is not an ApiProblem at all', () => {
      // errorInterceptor normalizes every HttpErrorResponse but rethrows anything else unchanged,
      // so this handler cannot assume the shape. Reading `.fieldErrors` off a bare Error does not
      // throw -- it is undefined; reading `.length` off that is what threw, which is why `?? []` is
      // the fix and an optional chain on `problem` is not. The throw escapes *inside* the
      // subscriber, where RxJS reports it out of band: vitest counts it under "Errors" while the
      // "Tests N passed" line stays green, and in a browser the visitor gets no field messages, no
      // toast (the interceptor passed a non-HttpErrorResponse along without one) and a Send that
      // appears to do nothing.
      //
      // One assertion on purpose. `submitting` is false here whether or not the fix is present,
      // because submitting.set(false) runs before the throw -- asserting it looked like coverage
      // and was worth nothing. The DOM is likewise identical either way. This flag makes the throw
      // propagate out of subscribe() so it can be seen at all, and is why this test calls submit()
      // directly instead of dispatching a submit event, which jsdom would swallow again.
      config.useDeprecatedSynchronousErrorHandling = true;

      try {
        submitContactMessage.mockReturnValue(throwError(() => new TypeError('boom')));

        const fixture = TestBed.createComponent(ContactFormComponent);
        fixture.componentInstance['form'].setValue({
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          message: 'Hello there',
        });

        expect(() => fixture.componentInstance['submit']()).not.toThrow();
      } finally {
        config.useDeprecatedSynchronousErrorHandling = false;
      }
    });
  });
});
