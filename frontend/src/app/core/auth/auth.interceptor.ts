import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

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
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.isLoggedIn() ? auth.token() : null;

  if (!token || !req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};
