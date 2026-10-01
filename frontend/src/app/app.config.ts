import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { TitleStrategy, provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideApi } from './core/api';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/http/error.interceptor';
import { SeoTitleStrategy } from './core/seo/seo-title.strategy';

/**
 * In this order on purpose. authInterceptor runs first, so errorInterceptor sees the request as it
 * was sent, Authorization header included, and #237's check that a 401 came back on a request
 * carrying a token depends on that. Reversed, the header is not there yet when errorInterceptor
 * looks, and the second 401 of an ended session toasts again. Exported so the order is tested as
 * the app uses it (error.interceptor.spec.ts) rather than as a spec happens to repeat it.
 */
export const httpInterceptors: HttpInterceptorFn[] = [authInterceptor, errorInterceptor];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors(httpInterceptors)),
    provideApi(environment.apiBaseUrl),
    // Replaces the router's DefaultTitleStrategy, which sets `title` and nothing else. Same hook,
    // same per-navigation timing, now also applying each route's description/robots meta tags --
    // see core/seo/seo-title.strategy.ts.
    { provide: TitleStrategy, useClass: SeoTitleStrategy },
  ],
};
