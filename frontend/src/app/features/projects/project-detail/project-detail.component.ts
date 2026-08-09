import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { Project } from '../../../core/api/model/project';
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
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }
}
