import { Injectable, computed, signal } from '@angular/core';
import { LoginResponse } from '../api';

interface StoredSession {
  token: string;
  expiresAt: string;
}

const STORAGE_KEY = 'mysite.admin.session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly stored = readStoredSession();

  private readonly tokenSignal = signal<string | null>(this.stored?.token ?? null);
  private readonly expiresAtSignal = signal<string | null>(this.stored?.expiresAt ?? null);

  readonly token = this.tokenSignal.asReadonly();
  readonly expiresAt = this.expiresAtSignal.asReadonly();

  readonly isLoggedIn = computed(() => {
    const token = this.tokenSignal();
    const expiresAt = this.expiresAtSignal();
    return token !== null && expiresAt !== null && Date.parse(expiresAt) > Date.now();
  });

  setSession(response: LoginResponse): void {
    this.tokenSignal.set(response.token);
    this.expiresAtSignal.set(response.expiresAt);
    writeStoredSession({ token: response.token, expiresAt: response.expiresAt });
  }

  logout(): void {
    this.tokenSignal.set(null);
    this.expiresAtSignal.set(null);
    clearStoredSession();
  }
}

function readStoredSession(): StoredSession | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      clearStoredSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
