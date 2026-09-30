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

  /**
   * Whether the held session is still inside its lifetime, by the clock as it reads *now*.
   *
   * A method, deliberately not a computed() (#151). A computed memoizes, and re-runs only when a
   * signal it read has changed -- the clock is not a signal. So once this had answered true, which
   * the header asks for straight after login, it went on answering true after the hour ran out:
   * authGuard let an expired admin into the admin area, and authInterceptor kept sending the dead
   * token onto public reads, which the backend answers 401 even on a permitAll endpoint. The
   * comment that stood here called it "pull-based: this only re-evaluates when read", and that was
   * the mistake -- a computed does not re-evaluate on read unless an input moved.
   *
   * Reading the two signals still gives a template or computed that calls this a dependency on
   * them, so the header re-renders on login and logout. What nothing does is re-render on expiry by
   * itself: an idle admin past expiresAt stays visually "logged in" until the next navigation or
   * API call asks. Acceptable for a single-admin, no-refresh-flow site (see docs/DECISIONS.md) --
   * revisit with a timer only if that idle state becomes an actual problem.
   */
  isLoggedIn(): boolean {
    const token = this.tokenSignal();
    const expiresAt = this.expiresAtSignal();
    return token !== null && expiresAt !== null && Date.parse(expiresAt) > Date.now();
  }

  /**
   * Whether this tab is holding a token at all, expired or not.
   *
   * Deliberately not a synonym for isLoggedIn(), and never a basis for deciding what to render or
   * who to let onto a route -- that is isLoggedIn()'s job and only isLoggedIn()'s job. The two
   * answer different questions and are *meant* to disagree, in exactly one window: after expiresAt
   * has passed but before anything has cleared the session (the idle-admin state the comment above
   * describes). In that window "may this person use the admin area" is no, while "did we hold a
   * credential the server could have just rejected" is yes.
   *
   * The second question is the one errorInterceptor needs, and asking isLoggedIn() instead got it
   * the wrong answer for the most common way a session ends: an ordinary wall-clock expiry produced
   * a generic "Request failed (401)." toast with no logout and no redirect (issue #108). Naming the
   * predicate here rather than writing `auth.token() !== null` at the call site keeps both
   * definitions in one file, so a reader comparing them cannot miss that the difference is meant.
   */
  readonly hasToken = computed(() => this.tokenSignal() !== null);

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

  /**
   * Drop the session if, and only if, it has already expired (#151). A live session is never
   * touched, and there is nothing to do when no token is held.
   *
   * Exists so authGuard can clean up on its way to the login page without inheriting the problem
   * #151 raised about guards: they can re-run, resolve concurrently and be cancelled, so a guard
   * that called logout() could end a session for a navigation that never happened. This cannot,
   * because what it removes is dead whatever the navigation does -- the outcome is the same
   * whether it runs once, twice, or for a navigation that is later cancelled.
   */
  clearExpiredSession(): void {
    if (this.hasToken() && !this.isLoggedIn()) {
      this.logout();
    }
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
