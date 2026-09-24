import { Routes } from '@angular/router';
import { NOINDEX } from './core/seo/site-meta';

export const routes: Routes = [
  {
    // The landing page is About (owner request, 2026-09-24). pathMatch: 'full' is what lets this
    // sit first. A '' route with the default 'prefix' match prefix-matches *every* URL, so the
    // router would have to fetch this chunk and inspect its children before it could rule the
    // branch out and backtrack -- on every cold entry to every other page. (That cost was real while
    // the projects list lived at '' as a prefix route, declared last but one to limit it to 404s.)
    // A full match fails on any non-empty URL without loading anything. It is safe here, unlike on
    // that old projects route, because ABOUT_ROUTES holds exactly one route and it is '': there is
    // no deeper child for a full-match parent, which consumes the whole URL, to strand.
    path: '',
    pathMatch: 'full',
    loadChildren: () => import('./features/about/about.routes').then((m) => m.ABOUT_ROUTES),
  },
  {
    // The About page's old URL. One canonical URL per page, so this is a redirect rather than a
    // second route to the same component (two indexable 200s with identical content), and every
    // link or bookmark made before the move keeps working.
    path: 'about',
    pathMatch: 'full',
    redirectTo: '',
  },
  {
    // A named prefix, so it matches only /projects and /projects/... and is never fetched just to
    // be backtracked out of. The list and the detail page share one route table; see
    // projects.routes.ts for why the list's component is imported statically there.
    path: 'projects',
    loadChildren: () => import('./features/projects/projects.routes').then((m) => m.PROJECTS_ROUTES),
  },
  {
    path: 'contact',
    loadChildren: () => import('./features/contact/contact.routes').then((m) => m.CONTACT_ROUTES),
  },
  {
    // Matches the link the backend emails via PasswordResetService (app.frontend-url + this path,
    // see backend/src/main/resources/application.yml) -- keep in sync if that path ever changes.
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password-confirm/reset-password-confirm.component').then(
        (m) => m.ResetPasswordConfirmComponent,
      ),
    title: 'Krzysztof Tarka - Reset password',
    // Reached only from a single-use emailed link. Nothing should index it, and there is nothing
    // worth describing to a crawler either.
    data: { description: 'Set a new password for the Krzysztof Tarka admin account.', robots: NOINDEX },
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/auth/admin.routes').then((m) => m.ADMIN_ROUTES),
    // Applies to the whole /admin subtree, login included -- SeoTitleStrategy walks the activated
    // chain and a parent's value covers every descendant that does not override it.
    data: { description: 'Administration for Krzysztof Tarka.', robots: NOINDEX },
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
    title: 'Krzysztof Tarka - Not found',
    // Netlify rewrites every unmatched path to index.html with a 200 (public/_redirects), so this
    // view is served with a success status and would otherwise be indexable like a real page.
    data: { description: 'This page does not exist.', robots: NOINDEX },
  },
];
