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
    title: 'My Site - Projects',
  },
  {
    path: 'projects/:id',
    loadComponent: () =>
      import('./project-detail/project-detail.component').then((m) => m.ProjectDetailComponent),
    title: 'My Site - Project',
  },
];
