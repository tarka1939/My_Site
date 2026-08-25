import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService } from './notification.service';

@Component({
  selector: 'app-notification-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notification-region">
      @for (notification of notifications.notifications(); track notification.id) {
        <div
          class="notification"
          [class.notification--error]="notification.level === 'error'"
          role="alert"
        >
          <p>{{ notification.message }}</p>
          <button type="button" (click)="notifications.dismiss(notification.id)" aria-label="Dismiss notification">
            &times;
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .notification-region {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-width: 24rem;
    }

    .notification {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 0.375rem;
      background: var(--color-surface-notice);
      color: var(--color-on-notice);
      box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
    }

    .notification--error {
      background: var(--color-surface-danger);
      color: var(--color-on-danger);
    }

    .notification p {
      margin: 0;
      font-size: var(--text-sm);
    }

    .notification button {
      background: transparent;
      border: none;
      color: inherit;
      font-size: var(--text-md);
      line-height: 1;
      cursor: pointer;
      padding: 0;
    }
  `,
})
export class NotificationBannerComponent {
  protected readonly notifications = inject(NotificationService);
}
