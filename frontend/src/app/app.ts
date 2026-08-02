import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { NotificationBannerComponent } from './core/notifications/notification-banner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  protected readonly currentYear = new Date().getFullYear();

  constructor() {
    // Move focus to the main landmark on every route change -- without this, SPA navigation
    // leaves focus wherever the triggering link was, so screen reader users get no cue that the
    // page changed (unlike a full page load, which resets focus to <body> by default).
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.document.getElementById('main-content')?.focus();
      });
  }

  protected logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/admin/login');
  }
}
