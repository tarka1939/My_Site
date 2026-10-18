import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService as AuthApiService } from '../../../core/api/api/auth.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notifications/notification.service';

@Component({
  selector: 'app-admin-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './admin-login.component.html',
  styleUrl: './admin-login.component.scss',
})
export class AdminLoginComponent {
  private readonly authApi = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);

    this.authApi.login({ loginRequest: this.form.getRawValue() }).subscribe({
      next: (response) => {
        this.auth.setSession(response);
        this.submitting.set(false);
        // Any error toast still on screen is about signing in, which has now worked (#313): an
        // earlier attempt's 401, 429, 5xx or network failure, or the session-expiry notice that
        // sent the admin here. Nothing else on this page raises an error. Taken down before
        // navigating, so the admin pages never open under it. An info toast is not about signing
        // in, so it stays.
        this.notifications.dismissAll('error');
        this.router.navigateByUrl(this.resolveReturnUrl());
      },
      error: () => {
        // Surfaced globally by errorInterceptor (invalid credentials -> 401, no field errors). The
        // toast stays while the admin retries, and the success branch above takes it down.
        this.submitting.set(false);
      },
    });
  }

  /**
   * authGuard only ever writes a same-app router URL into returnUrl, but it arrives back here as
   * an ordinary query param, so a crafted login link could set it to anything. navigateByUrl
   * can't actually leave the app with it (Angular's UrlSerializer + the History API's same-origin
   * pushState restriction rule that out), but rejecting anything that isn't a plain same-app path
   * (single leading `/`, not the protocol-relative `//host/...`) is a cheap, direct guarantee
   * rather than relying on those other layers to keep holding.
   */
  private resolveReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const isSameAppPath = returnUrl !== null && returnUrl.startsWith('/') && !returnUrl.startsWith('//');
    return isSameAppPath ? returnUrl : '/admin';
  }
}
