import { Routes } from '@angular/router';
import { AboutPageComponent } from './about-page.component';

/** Mounted at '' (full match) in app.routes.ts: the About page is the site's landing page. */
export const ABOUT_ROUTES: Routes = [
  {
    // Imported statically, not via loadComponent, on purpose. This file is already behind a lazy
    // loadChildren and '' is the site's landing route, so a nested dynamic import here would make
    // every first visit wait on three sequential requests (main -> this file -> the component)
    // instead of two. It is also the file's only route, so a lazy import could not spare a visitor
    // anything -- the component is the sole thing this file can render.
    path: '',
    component: AboutPageComponent,
    title: 'Krzysztof Tarka - About',
    data: {
      // The description that applies on navigation. The component replaces it with the first
      // paragraph of the actual body once that has loaded, so this is what a crawler that does
      // not wait for the request sees, and what an empty page keeps. As the landing page's, it is
      // what a search result for the site root shows, so it stands on its own rather than
      // referring back to a projects list the reader has not seen.
      description:
        'Krzysztof Tarka: background and interests, the software and audio/DSP projects in this portfolio, and how to get in touch.',
    },
  },
];
