import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
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
    title: 'My Site - Reset password',
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/auth/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
    title: 'My Site - Not found',
  },
];
