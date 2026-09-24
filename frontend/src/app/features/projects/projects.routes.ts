import { Routes } from '@angular/router';
import { ProjectsListComponent } from './projects-list/projects-list.component';

export const PROJECTS_ROUTES: Routes = [
  {
    // Imported statically, not via loadComponent, on purpose. This whole routes file is already
    // behind a lazy loadChildren, and '' is the site's landing route -- a second dynamic import
    // here would make every first visit wait on three sequential requests (main -> this file ->
    // the component) instead of two. The detail route below stays lazy, since most visits to the
    // landing page never open it.
    path: '',
    component: ProjectsListComponent,
    title: 'Krzysztof Tarka - Projects',
    data: {
      description:
        'Every project in the portfolio, filterable by tag — software, audio and signal-processing work, each with links, images and the period it was built.',
    },
  },
  {
    path: 'projects/:id',
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
