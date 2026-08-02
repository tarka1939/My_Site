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

  private push(level: NotificationLevel, message: string): void {
    const notification: Notification = { id: nextId++, level, message };
    this.notificationsSignal.update((current) => [...current, notification]);
  }
}
