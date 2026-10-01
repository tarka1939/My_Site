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
   * A message already on screen replaces its earlier copy rather than stacking beside it (#236).
   * One page load can make several requests, and when the backend is down each failure toasts on
   * its own: /projects showed the same sentence twice, and nothing here dismisses on a timer, so a
   * stack would stay until closed one by one.
   *
   * Replaced, not ignored. The banner renders each toast as role="alert", which is announced when
   * its element is inserted; the new id makes `track notification.id` insert a fresh one. Ignoring
   * the repeat would leave a second wrong password, or a retried form, with no announcement and no
   * visible change, so nobody could tell the retry had been answered.
   */
  private push(level: NotificationLevel, message: string): void {
    this.notificationsSignal.update((current) => [
      ...current.filter((n) => !(n.level === level && n.message === message)),
      { id: nextId++, level, message },
    ]);
  }
}
