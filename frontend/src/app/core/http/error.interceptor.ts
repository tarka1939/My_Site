import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notification.service';
import { ApiFieldError, ApiProblem } from './api-problem';

/**
 * The one endpoint in docs/openapi.yaml where 401 does not mean "your token was not accepted".
 * Its 401 is documented as "Invalid credentials" -- a mistyped password, not a session ending.
 *
 * Matched exactly rather than by suffix or prefix so that this exclusion cannot quietly grow to
 * cover an endpoint whose 401 *does* mean the session is over; silently declining to log someone
 * out is the failure mode worth guarding against here, not the other way round. Built from
 * environment.apiBaseUrl because that is what app.config.ts hands provideApi(), so the generated
 * client's `${basePath}/auth/login` is this string.
 */
const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;

/**
 * Normalizes every failed API response into an ApiProblem and rethrows that instead of the raw
 * HttpErrorResponse, so callers can branch on fieldErrors/rateLimited without re-parsing the
 * RFC 7807 body themselves. Also owns the two cross-cutting reactions that don't belong in
 * individual components: logging out on an expired/invalid token, and toasting non-field errors.
 *
 * This is the only place the wire is read, so it is the only place that gets to be unsure about
 * what came back. Everything downstream -- groupFieldErrors(), each form's slot lookup and
 * catch-all -- is entitled to treat an ApiProblem as exactly what api-problem.ts declares.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const notifications = inject(NotificationService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      const { problem, discardedFieldErrors } = normalizeFailure(error);

      // hasToken(), not isLoggedIn(). isLoggedIn() is already false once the token has expired by
      // wall clock, which is the most common way a session ends -- so gating on it meant ordinary
      // expiry fell through to the generic toast below ("Request failed (401).") with no logout and
      // no redirect, and only the rare server-side rejection of a still-believed-valid token (clock
      // skew, rotated signing secret, revocation) ever took this path. Both mean the same thing to
      // the admin: log in again. See issue #108 and hasToken()'s comment in auth.service.ts.
      //
      // The two other conjuncts are what keep this from firing on unrelated 401s, and both are
      // load-bearing:
      //
      //   hasToken() -- someone who never authenticated must not be bounced to a login page they
      //   never asked for. The public contact form is the case that matters: an anonymous visitor
      //   holds no token, so a 401 there (undocumented, but reachable once Phase 5 puts a proxy in
      //   front of the backend) leaves them where they are with a plain toast.
      //
      //   not the login endpoint -- a wrong password answers 401 too, and this branch would then
      //   report it as an expired session and navigate to /admin/login with returnUrl set to the
      //   login page itself, destroying the returnUrl authGuard had just put there. That is not
      //   hypothetical: authGuard redirects on expiry *without* calling logout(), so an admin
      //   arriving at the login page after an expiry still has the stale token in this signal, and
      //   one typo would strand them. A login 401 falls through to the generic toast, which is
      //   where AdminLoginComponent already expects invalid credentials to be surfaced.
      if (error.status === 401 && auth.hasToken() && req.url !== LOGIN_URL) {
        auth.logout();
        notifications.error('Your admin session has expired. Please log in again.');
        router.navigate(['/admin/login'], { queryParams: { returnUrl: router.url } });
      } else if (problem.rateLimited) {
        notifications.error(problem.detail || 'Too many requests -- please wait a moment and try again.');
      } else if (problem.fieldErrors.length === 0 || discardedFieldErrors) {
        // The second clause is the one that is not obvious. A body whose `errors` was unusable in
        // full arrives here as [], so the length check already toasts it; a body where *some*
        // entries were unusable does not -- the survivors render inline, the form looks fully
        // explained, and the violations that were thrown away have nowhere left to appear. The
        // admin then fixes what is shown, resubmits, and is rejected again for a reason no part of
        // the UI has ever named. So the toast fires alongside the inline messages whenever anything
        // was dropped: mildly redundant beats a rejection with no destination, which is the failure
        // mode this whole path exists to prevent.
        notifications.error(problem.detail || problem.title);
      }

      return throwError(() => problem);
    }),
  );
};

interface NormalizedFailure {
  problem: ApiProblem;
  /**
   * True when the body carried an `errors` field that could not be read as ApiFieldError[] in
   * full -- either it was not an array at all, or at least one entry was dropped. Deliberately not
   * on ApiProblem: it is the interceptor's own business (it decides whether to toast), and adding
   * it to the shape components consume would invite them to be unsure again, which is what
   * validating here is meant to end.
   */
  discardedFieldErrors: boolean;
}

function normalizeFailure(error: HttpErrorResponse): NormalizedFailure {
  const body = isJsonObject(error.error) ? error.error : undefined;
  const { fieldErrors, discarded } = readFieldErrors(body?.['errors']);

  return {
    problem: {
      status: error.status,
      title: readString(body?.['title']) ?? defaultTitleFor(error.status),
      detail: readString(body?.['detail']),
      fieldErrors,
      rateLimited: error.status === 429,
    },
    discardedFieldErrors: discarded,
  };
}

/**
 * Read `errors` as the ApiFieldError[] that ValidationProblemDetail promises, keeping only the
 * entries that actually are one, and say whether anything was lost.
 *
 * Not reachable from this backend: docs/openapi.yaml types ValidationProblemDetail.errors as an
 * array and Spring's ProblemDetail serialisation produces one. It becomes reachable the moment
 * anything else answers on the API origin -- a reverse proxy error page, a CDN interstitial, a
 * gateway with its own JSON -- which is exactly what Phase 5 puts in front of the backend.
 *
 * The shape that made this worth checking is `errors` as an object rather than an array: nothing
 * throws, but `fieldErrors.length` is undefined, so the interceptor's own `=== 0` fail-safe is
 * false and every form's `> 0` is false too. The rejection reaches nothing at all. `errors` as a
 * string is the same silence by a different route: `.length` is truthy, so no toast, and the form
 * reaches .map() and throws inside the subscriber, where RxJS reports it out of band.
 *
 * Entries are rebuilt rather than passed through so that what leaves here is the declared shape and
 * nothing else, and an entry missing either half is dropped rather than patched: a `message` that
 * is not a string has no text to show, and a `field` that is not a string names no destination to
 * show it in. Dropping is safe only because discarding is reported back -- see the toast branch.
 */
function readFieldErrors(errors: unknown): { fieldErrors: ApiFieldError[]; discarded: boolean } {
  if (errors === undefined || errors === null) {
    return { fieldErrors: [], discarded: false };
  }

  if (!Array.isArray(errors)) {
    return { fieldErrors: [], discarded: true };
  }

  const fieldErrors: ApiFieldError[] = [];
  let discarded = false;

  for (const entry of errors) {
    if (isJsonObject(entry) && typeof entry['field'] === 'string' && typeof entry['message'] === 'string') {
      fieldErrors.push({ field: entry['field'], message: entry['message'] });
    } else {
      discarded = true;
    }
  }

  return { fieldErrors, discarded };
}

/**
 * An object to read named properties off, and nothing more -- the properties stay `unknown` and are
 * each checked where they are read. The predicate this replaced was called isProblemDetailBody and
 * declared the body as a ProblemDetail with a typed `errors` array while testing only that it was
 * a non-null object, so every read after it was a cast wearing a guard's name. That is how the
 * unchecked `errors` survived review of the file it lives in.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `title` and `detail` are rendered straight into a toast, so a non-string is a "[object Object]" on screen. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function defaultTitleFor(status: number): string {
  if (status === 0) {
    return 'Network error -- could not reach the server.';
  }
  return `Request failed (${status}).`;
}
