import { Routes } from '@angular/router';
import { NOINDEX } from './core/seo/site-meta';

export const routes: Routes = [
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
    // Deliberately declared last but one, *after* every named route rather than first. Its path is
    // '' with the default pathMatch: 'prefix', which prefix-matches every URL -- so while it sat
    // first the router had to fetch this chunk and inspect its children before it could rule the
    // branch out and backtrack, on every cold entry to /contact, /admin/*, /reset-password and any
    // 404. That cost was ~314 bytes until projects.routes.ts started importing the list component
    // statically; it is now 5.73 kB raw of never-rendered code on those routes.
    //
    // pathMatch: 'full' would also stop the over-matching, but it cannot be used here: a full-match
    // parent consumes the entire URL, which makes its 'projects/:id' child unreachable -- verified,
    // /projects/abc then falls through to the wildcard and renders "not found". Ordering is the fix
    // that keeps deep links working. Only genuine 404s still pay the backtrack.
    path: '',
    loadChildren: () => import('./features/projects/projects.routes').then((m) => m.PROJECTS_ROUTES),
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
