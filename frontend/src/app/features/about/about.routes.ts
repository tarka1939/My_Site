import { Routes } from '@angular/router';
import { AboutPageComponent } from './about-page.component';

export const ABOUT_ROUTES: Routes = [
  {
    // Imported statically, as contact.routes.ts does and for the same reason: this file is
    // already behind a lazy loadChildren and has exactly one route, so a nested dynamic import
    // only adds a sequential request on the way to the sole thing it can render.
    path: '',
    component: AboutPageComponent,
    title: 'Krzysztof Tarka - About',
    data: {
      // The description that applies on navigation. The component replaces it with the first
      // paragraph of the actual body once that has loaded, so this is what a crawler that does
      // not wait for the request sees, and what an empty page keeps.
      description: 'Who is behind these projects: background, interests, and how to get in touch.',
    },
  },
];
