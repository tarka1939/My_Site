import { Routes } from '@angular/router';
import { ContactFormComponent } from './contact-form/contact-form.component';

export const CONTACT_ROUTES: Routes = [
  {
    // Imported statically, not via loadComponent -- see the note in projects.routes.ts. This file
    // is already behind a lazy loadChildren and has exactly one route, so a nested dynamic import
    // only buys an extra sequential request on the way to the sole thing it can render.
    path: '',
    component: ContactFormComponent,
    title: 'My Site - Contact',
  },
];
