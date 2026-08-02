import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../../core/api/api/contact.service';
import { ApiProblem } from '../../../core/http/api-problem';

@Component({
  selector: 'app-contact-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './contact-form.component.html',
  styleUrl: './contact-form.component.scss',
})
export class ContactFormComponent {
  private readonly contactApi = inject(ContactService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    message: ['', [Validators.required, Validators.maxLength(5000)]],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.fieldErrors.set({});

    this.contactApi.submitContactMessage({ contactMessageWriteRequest: this.form.getRawValue() }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
        this.form.reset();
      },
      error: (problem: ApiProblem) => {
        this.submitting.set(false);
        if (problem.fieldErrors.length > 0) {
          this.fieldErrors.set(Object.fromEntries(problem.fieldErrors.map((e) => [e.field, e.message])));
        }
        // Non-field errors (rate limiting, server errors) are surfaced globally by errorInterceptor.
      },
    });
  }
}
