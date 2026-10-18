import { Routes } from '@angular/router';
import { AnalyticsPage } from '../../core/api/model/analyticsPage';
import { PrivacyPageComponent } from './privacy-page.component';

export const PRIVACY_ROUTES: Routes = [
  {
    // Imported statically, not via loadComponent -- see the note in projects.routes.ts. This file
    // is already behind a lazy loadChildren and has exactly one route.
    path: '',
    component: PrivacyPageComponent,
    title: 'Krzysztof Tarka - Privacy',
    data: {
      // Claims only what the page itself says: counting without cookies or a third party, and a
      // list of what is not collected.
      description:
        'How this site counts its own visits without cookies or a third-party service, and what it does not collect.',
      // Counted as a page view (core/analytics/analytics-tracker.ts), as the page itself says.
      analyticsPage: AnalyticsPage.Privacy,
    },
  },
];
