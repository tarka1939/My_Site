import { Routes } from '@angular/router';
import { ContactFormComponent } from './contact-form/contact-form.component';

export const CONTACT_ROUTES: Routes = [
  {
    // Imported statically, not via loadComponent -- see the note in projects.routes.ts. This file
    // is already behind a lazy loadChildren and has exactly one route, so a nested dynamic import
    // only buys an extra sequential request on the way to the sole thing it can render.
    path: '',
    component: ContactFormComponent,
    title: 'Krzysztof Tarka - Contact',
    data: {
      // Says nothing about what happens to a message after it is sent: the contact endpoint stores
      // it for the admin view, and nothing emails or forwards it, so "goes straight to my inbox"
      // would be a claim the system does not implement.
      description: 'Get in touch — questions about a project, work enquiries, or anything else.',
    },
  },
];
