import { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard';

/**
 * Every route here inherits `description` and `robots: NOINDEX` from the parent `admin` route in
 * `app.routes.ts` -- SeoTitleStrategy resolves route data by walking the activated chain, so the
 * subtree is covered by that one declaration.
 *
 * The two unauthenticated pages below say what they are, since they are the only ones a crawler or
 * a person can actually reach without a token. The guarded pages beneath keep the subtree's generic
 * description: they sit behind `authGuard`, so nothing that reads meta tags ever renders them, and
 * writing five descriptions no client will ever see is noise, not thoroughness.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./admin-login/admin-login.component').then((m) => m.AdminLoginComponent),
    title: 'My Site - Admin login',
    data: { description: 'Sign in to manage projects and messages on My Site.' },
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent),
    title: 'My Site - Forgot password',
    data: { description: 'Request a password reset link for the My Site admin account.' },
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'projects' },
      {
        path: 'projects',
        loadComponent: () =>
          import('../admin/admin-projects-list/admin-projects-list.component').then(
            (m) => m.AdminProjectsListComponent,
          ),
        title: 'My Site - Admin - Projects',
      },
      {
        path: 'projects/new',
        loadComponent: () =>
          import('../admin/admin-project-form/admin-project-form.component').then(
            (m) => m.AdminProjectFormComponent,
          ),
        title: 'My Site - Admin - New project',
      },
      {
        path: 'projects/:id/edit',
        loadComponent: () =>
          import('../admin/admin-project-form/admin-project-form.component').then(
            (m) => m.AdminProjectFormComponent,
          ),
        title: 'My Site - Admin - Edit project',
      },
      {
        path: 'messages',
        loadComponent: () =>
          import('../admin/admin-messages-list/admin-messages-list.component').then(
            (m) => m.AdminMessagesListComponent,
          ),
        title: 'My Site - Admin - Messages',
      },
      {
        path: 'messages/:id',
        loadComponent: () =>
          import('../admin/admin-message-detail/admin-message-detail.component').then(
            (m) => m.AdminMessageDetailComponent,
          ),
        title: 'My Site - Admin - Message',
      },
    ],
  },
];
