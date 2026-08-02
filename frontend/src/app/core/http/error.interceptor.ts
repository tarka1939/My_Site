import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notification.service';
import { ApiProblem } from './api-problem';

/**
 * Normalizes every failed API response into an ApiProblem and rethrows that instead of the raw
 * HttpErrorResponse, so callers can branch on fieldErrors/rateLimited without re-parsing the
 * RFC 7807 body themselves. Also owns the two cross-cutting reactions that don't belong in
 * individual components: logging out on an expired/invalid token, and toasting non-field errors.
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

      const problem = toApiProblem(error);

      if (error.status === 401 && auth.isLoggedIn()) {
        auth.logout();
        notifications.error('Your admin session has expired. Please log in again.');
        router.navigate(['/admin/login'], { queryParams: { returnUrl: router.url } });
      } else if (problem.rateLimited) {
        notifications.error(problem.detail || 'Too many requests -- please wait a moment and try again.');
      } else if (problem.fieldErrors.length === 0) {
        notifications.error(problem.detail || problem.title);
      }

      return throwError(() => problem);
    }),
  );
};

function toApiProblem(error: HttpErrorResponse): ApiProblem {
  const body = isProblemDetailBody(error.error) ? error.error : undefined;

  return {
    status: error.status,
    title: body?.title ?? defaultTitleFor(error.status),
    detail: body?.detail,
    fieldErrors: body?.errors ?? [],
    rateLimited: error.status === 429,
  };
}

function isProblemDetailBody(
  body: unknown,
): body is { title?: string; detail?: string; errors?: { field: string; message: string }[] } {
  return typeof body === 'object' && body !== null;
}

function defaultTitleFor(status: number): string {
  if (status === 0) {
    return 'Network error -- could not reach the server.';
  }
  return `Request failed (${status}).`;
}
