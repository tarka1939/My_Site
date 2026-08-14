import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { Project } from '../../../core/api/model/project';
import { SeoService } from '../../../core/seo/seo.service';
import { NOINDEX, siteTitle } from '../../../core/seo/site-meta';
import { projectImageAlt } from '../../../shared/project-image-alt/project-image-alt';
import { ProjectPeriodComponent } from '../../../shared/project-period/project-period.component';

@Component({
  selector: 'app-project-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ProjectPeriodComponent],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.scss',
})
export class ProjectDetailComponent {
  private readonly projectsApi = inject(ProjectsService);
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  protected readonly project = signal<Project | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.loadProject(id);
      }
    });
  }

  /**
   * Alt text for gallery image `index` -- see shared/project-image-alt/project-image-alt.ts, which
   * holds the reasoning for what this may and may not assert about an image it cannot see.
   */
  protected imageAlt(project: Project, index: number): string {
    return projectImageAlt(project.title, index, project.images.length);
  }

  private loadProject(id: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.projectsApi.getProject({ id }).subscribe({
      next: (project) => {
        this.project.set(project);
        this.loading.set(false);
        this.describe(project);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
        // A project that does not exist is still served as HTTP 200 with the app shell (Netlify
        // rewrites everything to index.html), so without this a deleted project's URL stays
        // indexable, advertising the route's generic placeholder description forever.
        this.seo.setRobots(NOINDEX);
      },
    });
  }

  /**
   * Replaces the route's placeholder title and description with the project's own.
   *
   * This has to happen here rather than in the route config: the project is not known until the API
   * answers, which is after the navigation that applied the route's `data`. Nothing needs undoing
   * on the way out -- SeoTitleStrategy runs on every navigation and overwrites both, including when
   * moving from one project straight to another.
   *
   * `SeoService` does the truncating and the escaping; `description` is passed in raw.
   */
  private describe(project: Project): void {
    this.seo.setTitle(siteTitle(project.title));
    this.seo.setDescription(project.description);
    // No setRobots(undefined) here: /projects/missing -> /projects/real is a navigation, and the
    // strategy already removes the tag on any navigation whose route declares no robots.
  }
}
