import { Injectable, signal } from '@angular/core';

export type NotificationLevel = 'error' | 'info';

export interface Notification {
  id: number;
  level: NotificationLevel;
  message: string;
}

let nextId = 1;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly notificationsSignal = signal<Notification[]>([]);
  readonly notifications = this.notificationsSignal.asReadonly();

  error(message: string): void {
    this.push('error', message);
  }

  info(message: string): void {
    this.push('info', message);
  }

  dismiss(id: number): void {
    this.notificationsSignal.update((current) => current.filter((n) => n.id !== id));
  }

  /**
   * A message already on screen is not shown again (#236). One page load can make several
   * requests, and when the backend is down each failure toasts on its own: /projects showed the
   * same sentence twice. The repeat tells the visitor nothing, and nothing here dismisses on a
   * timer, so a stack would stay until closed one by one. Once dismissed, the same message can
   * appear again, because by then it is news.
   */
  private push(level: NotificationLevel, message: string): void {
    this.notificationsSignal.update((current) =>
      current.some((n) => n.level === level && n.message === message)
        ? current
        : [...current, { id: nextId++, level, message }],
    );
  }
}
