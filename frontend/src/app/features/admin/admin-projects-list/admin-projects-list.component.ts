import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { Project } from '../../../core/api/model/project';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-projects-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './admin-projects-list.component.html',
  styleUrl: './admin-projects-list.component.scss',
})
export class AdminProjectsListComponent {
  private readonly projectsApi = inject(ProjectsService);

  protected readonly projects = signal<Project[]>([]);
  protected readonly page = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly loading = signal(false);
  protected readonly deletingId = signal<string | null>(null);

  constructor() {
    this.loadProjects();
  }

  protected goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) {
      return;
    }
    this.page.set(page);
    this.loadProjects();
  }

  protected deleteProject(project: Project): void {
    if (!confirm(`Delete "${project.title}"? This cannot be undone.`)) {
      return;
    }

    this.deletingId.set(project.id);
    this.projectsApi.deleteProject({ id: project.id }).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.loadProjects();
      },
      error: () => this.deletingId.set(null),
    });
  }

  private loadProjects(): void {
    this.loading.set(true);
    this.projectsApi.listProjects({ page: this.page(), size: PAGE_SIZE }).subscribe({
      next: (response) => {
        this.projects.set(response.content);
        this.totalPages.set(response.totalPages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
