import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService as AuthApiService } from '../../../core/api/api/auth.service';
import { AuthService } from '../../../core/auth/auth.service';

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
        this.router.navigateByUrl(this.resolveReturnUrl());
      },
      error: () => {
        // Surfaced globally by errorInterceptor (invalid credentials -> 401, no field errors).
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
