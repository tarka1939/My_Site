import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Login, the two password-reset steps and the reset-token check. None of them takes a token:
 * docs/openapi.yaml gives each `security: []`, and SecurityConfig permits `/api/v1/auth/**`
 * without one. That is what makes a prefix safe here. An authenticated endpoint added under it
 * would lose its token and log the admin out on every call, so auth.interceptor.spec.ts reads the
 * generated client and fails if one appears. The trailing slash keeps a sibling such as `/authors`
 * out.
 */
const AUTH_PREFIX = `${environment.apiBaseUrl}/auth/`;

/**
 * Attaches the admin bearer token to requests aimed at our own API. The generated client's
 * built-in `Configuration.credentials.bearerAuth` is deliberately left unconfigured (see
 * app.config.ts) so this interceptor is the single place that decides whether a token is sent.
 *
 * Only a token isLoggedIn() still vouches for (#151). This used to attach on presence alone, and
 * the backend answers an invalid bearer with 401 even on a public endpoint -- measured: `GET
 * /projects` is 200 with no token and 401 with a bad one. So an admin whose hour had run out and
 * who then opened the public project list was treated as a failed admin request: logged out and
 * sent to the login page from a page that needs no login. A public read now goes out anonymous,
 * as it should. An admin write still reaches errorInterceptor as a 401 while hasToken() is true,
 * so session expiry is reported exactly as before.
 *
 * And never to {@link AUTH_PREFIX} (#246), for the same backend behaviour. The browser can hold a
 * token it believes is valid and the server no longer accepts -- a rotated signing secret, say.
 * Sent with a login request, that token was refused before the credentials were read, with an
 * empty 401 for the right password as well as a wrong one. errorInterceptor deliberately keeps the
 * session on a login 401, so nothing cleared the token, and the admin could not log in again until
 * it expired.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.isLoggedIn() ? auth.token() : null;

  if (!token || !req.url.startsWith(environment.apiBaseUrl) || req.url.startsWith(AUTH_PREFIX)) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};
