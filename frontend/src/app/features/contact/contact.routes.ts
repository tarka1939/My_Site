import { Routes } from '@angular/router';
import { AnalyticsPage } from '../../core/api/model/analyticsPage';
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
      // Says nothing about what happens to a message after it is sent. The contact endpoint stores
      // it for the admin view, and since #186 the backend can also email the owner a notice - but
      // only when a notification address is configured, and best-effort even then, so "goes
      // straight to my inbox" would promise more than the system guarantees.
      description: 'Get in touch - questions about a project, work enquiries, or anything else.',
      // Counted as a page view (core/analytics/analytics-tracker.ts).
      analyticsPage: AnalyticsPage.Contact,
    },
  },
];
