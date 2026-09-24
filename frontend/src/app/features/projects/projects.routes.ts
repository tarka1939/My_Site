import { Routes } from '@angular/router';
import { ProjectsListComponent } from './projects-list/projects-list.component';

/** Mounted under `projects` in app.routes.ts: `/projects` is the list, `/projects/:id` a project. */
export const PROJECTS_ROUTES: Routes = [
  {
    // Imported statically, not via loadComponent. This whole routes file is already behind a lazy
    // loadChildren, and the list is what the nav's "Projects" link opens -- a second dynamic import
    // here would make a cold visit to /projects wait on three sequential requests (main -> this
    // file -> the component) instead of two. The detail route below stays lazy, since most visits
    // to the list never open it. (This was first written when the list was the site's landing
    // route. That role now belongs to the About page, which about.routes.ts imports statically for
    // the same reason.)
    //
    // pathMatch: 'full' so /projects/<id> is not first tried against this childless '' route and
    // then backtracked out of; it goes straight to ':id'.
    path: '',
    pathMatch: 'full',
    component: ProjectsListComponent,
    title: 'Krzysztof Tarka - Projects',
    data: {
      description:
        'Every project in the portfolio, filterable by tag — software, audio and signal-processing work, each with links, images and the period it was built.',
    },
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./project-detail/project-detail.component').then((m) => m.ProjectDetailComponent),
    title: 'Krzysztof Tarka - Project',
    // Placeholders, both of them. The real title and description are the project's own, and the
    // project is not loaded until after this navigation completes -- ProjectDetailComponent
    // replaces both once the API responds. These are what a crawler sees if that request fails,
    // and what shows for the moment before it resolves.
    data: { description: 'A project from the portfolio: what it does and how it was built.' },
  },
];
