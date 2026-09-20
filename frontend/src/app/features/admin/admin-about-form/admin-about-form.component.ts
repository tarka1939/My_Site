import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AboutService } from '../../../core/api/api/about.service';
import { ApiProblem } from '../../../core/http/api-problem';
import { NotificationService } from '../../../core/notifications/notification.service';
import { joinMessages } from '../../../shared/form-errors/form-errors';
import { renderMarkdown } from '../../../shared/markdown/markdown';

/**
 * The contract's limit, mirrored client-side so the admin sees it before a round trip. The server
 * stays the authority: its 400 lands in the same slot via serverError().
 */
export const ABOUT_BODY_MAX_CHARS = 20000;

/**
 * The admin editor for the About page (#213). One textarea, the same live preview the project
 * form has, one Save. No create mode -- the page always exists (see the contract) -- so this loads
 * the current body and PUTs a replacement.
 *
 * The preview calls the same renderMarkdown() the public page does, bound through [innerHTML].
 * That is the whole point of a preview: it agrees with the page by construction because it *is*
 * the page's rendering. Never `bypassSecurityTrustHtml` here; see shared/markdown/markdown.ts.
 */
@Component({
  selector: 'app-admin-about-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './admin-about-form.component.html',
  styleUrl: './admin-about-form.component.scss',
})
export class AdminAboutFormComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly aboutApi = inject(AboutService);
  private readonly notifications = inject(NotificationService);

  protected readonly form = this.formBuilder.nonNullable.group({
    // No `required`: an empty body is a valid write and is how the page is cleared.
    body: ['', [Validators.maxLength(ABOUT_BODY_MAX_CHARS)]],
  });

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  /** The server's verdict on `body`, if it rejected the last save. Cleared on the next edit. */
  private readonly serverBodyError = signal<string | null>(null);

  private readonly bodyValue = toSignal(this.form.controls.body.valueChanges, {
    initialValue: this.form.controls.body.value,
  });
  protected readonly preview = computed(() => renderMarkdown(this.bodyValue()));
  protected readonly remaining = computed(() => ABOUT_BODY_MAX_CHARS - this.bodyValue().length);

  protected readonly bodyError = computed(() => {
    // Client-side verdict first while the text is over the limit, else whatever the server said.
    // Derived from the value signal rather than from `control.hasError('maxlength')`: a control's
    // validity is not a signal, so a computed that read it would never re-run when it changed --
    // which is exactly what happened in the first version of this, and the spec caught. The
    // shared `clientErrorSignal()` in form-errors.ts solves the same problem by subscribing to
    // control events, and the project form uses it; this form counts directly because it has one
    // field with one rule, and because showing a limit violation *before* the field is touched is
    // the better behaviour for a paste that overshoots. The Validators.maxLength on the control
    // still stands and is what `save()` gates on; both read ABOUT_BODY_MAX_CHARS, so they agree.
    if (this.bodyValue().length > ABOUT_BODY_MAX_CHARS) {
      return `Keep it under ${ABOUT_BODY_MAX_CHARS.toLocaleString()} characters.`;
    }
    return this.serverBodyError();
  });

  constructor() {
    this.aboutApi
      .getAboutPage()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (page) => {
          this.form.controls.body.setValue(page.body);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set('The current page could not be loaded, so saving is disabled.');
        },
      });

    this.form.controls.body.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.serverBodyError.set(null));
  }

  protected save(): void {
    if (this.submitting() || this.loadError() || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.aboutApi
      .updateAboutPage({ aboutPageWriteRequest: { body: this.form.controls.body.value } })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (page) => {
          // Stay on the page rather than navigating away: there is nowhere more sensible to go,
          // and an author usually wants to keep editing. Re-seed the control from the response so
          // the form reflects exactly what was stored, not what was sent.
          this.form.controls.body.setValue(page.body);
          this.form.markAsPristine();
          this.notifications.info('About page saved.');
        },
        error: (problem: ApiProblem) => {
          // Same defensive read as the project form: errorInterceptor normalizes every
          // HttpErrorResponse into an ApiProblem but rethrows anything that is not one, so the
          // shape is only almost guaranteed. Non-field errors are toasted globally by the
          // interceptor; only a verdict on `body` is shown here.
          const fieldErrors = problem?.fieldErrors ?? [];
          const bodyMessages = fieldErrors
            .filter((error) => error.field === 'body')
            .map((error) => error.message);
          if (bodyMessages.length > 0) {
            this.serverBodyError.set(joinMessages(bodyMessages, 'The server rejected the text.'));
          }
        },
      });
  }
}
