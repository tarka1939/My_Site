import { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./admin-login/admin-login.component').then((m) => m.AdminLoginComponent),
    title: 'My Site - Admin login',
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent),
    title: 'My Site - Forgot password',
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
