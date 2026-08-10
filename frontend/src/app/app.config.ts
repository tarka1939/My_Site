import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TitleStrategy, provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideApi } from './core/api';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/http/error.interceptor';
import { SeoTitleStrategy } from './core/seo/seo-title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    provideApi(environment.apiBaseUrl),
    // Replaces the router's DefaultTitleStrategy, which sets `title` and nothing else. Same hook,
    // same per-navigation timing, now also applying each route's description/robots meta tags --
    // see core/seo/seo-title.strategy.ts.
    { provide: TitleStrategy, useClass: SeoTitleStrategy },
  ],
};
