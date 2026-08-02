import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ContactService } from '../../../core/api/api/contact.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { ContactFormComponent } from './contact-form.component';

describe('ContactFormComponent', () => {
  let submitContactMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    submitContactMessage = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ContactFormComponent],
      providers: [{ provide: ContactService, useValue: { submitContactMessage } }],
    }).compileComponents();
  });

  it('does not submit an invalid form', () => {
    const fixture = TestBed.createComponent(ContactFormComponent);
    fixture.componentInstance['submit']();

    expect(submitContactMessage).not.toHaveBeenCalled();
    expect(fixture.componentInstance['form'].touched).toBe(true);
  });

  it('submits a valid form and shows the confirmation message', () => {
    submitContactMessage.mockReturnValue(of({ id: '1', createdAt: new Date().toISOString() }));

    const fixture = TestBed.createComponent(ContactFormComponent);
    fixture.componentInstance['form'].setValue({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      message: 'Hello there',
    });

    fixture.componentInstance['submit']();

    expect(submitContactMessage).toHaveBeenCalledWith({
      contactMessageWriteRequest: { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello there' },
    });
    expect(fixture.componentInstance['submitted']()).toBe(true);
  });

  it('shows field-level validation errors returned by the API', () => {
    const problem: ApiProblem = {
      status: 400,
      title: 'Bad Request',
      fieldErrors: [{ field: 'email', message: 'must be a well-formed email address' }],
      rateLimited: false,
    };
    submitContactMessage.mockReturnValue(throwError(() => problem));

    // Client-side validators pass (well-formed email); the server rejects it anyway (e.g. a
    // business rule the client doesn't replicate) -- this exercises how that gets displayed.
    const fixture = TestBed.createComponent(ContactFormComponent);
    fixture.componentInstance['form'].setValue({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      message: 'Hello there',
    });

    fixture.componentInstance['submit']();

    expect(fixture.componentInstance['fieldErrors']()).toEqual({
      email: 'must be a well-formed email address',
    });
  });
});
