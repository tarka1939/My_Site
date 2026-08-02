import { Routes } from '@angular/router';

export const CONTACT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./contact-form/contact-form.component').then((m) => m.ContactFormComponent),
    title: 'My Site - Contact',
  },
];
