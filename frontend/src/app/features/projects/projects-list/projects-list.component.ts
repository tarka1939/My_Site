import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { TagsService } from '../../../core/api/api/tags.service';
import { Project } from '../../../core/api/model/project';
import { Tag } from '../../../core/api/model/tag';

const PAGE_SIZE = 12;

@Component({
  selector: 'app-projects-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './projects-list.component.html',
  styleUrl: './projects-list.component.scss',
})
export class ProjectsListComponent {
  private readonly projectsApi = inject(ProjectsService);
  private readonly tagsApi = inject(TagsService);

  protected readonly projects = signal<Project[]>([]);
  protected readonly allTags = signal<Tag[]>([]);
  protected readonly selectedTags = signal<string[]>([]);
  protected readonly page = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly totalElements = signal(0);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    this.tagsApi.listTags().subscribe({
      next: (tags) => this.allTags.set(tags),
    });
    this.loadProjects();
  }

  protected toggleTag(tagName: string): void {
    const current = this.selectedTags();
    this.selectedTags.set(
      current.includes(tagName) ? current.filter((t) => t !== tagName) : [...current, tagName],
    );
    this.page.set(0);
    this.loadProjects();
  }

  protected goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) {
      return;
    }
    this.page.set(page);
    this.loadProjects();
  }

  private loadProjects(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.projectsApi
      .listProjects({
        page: this.page(),
        size: PAGE_SIZE,
        tag: this.selectedTags().length > 0 ? this.selectedTags() : undefined,
      })
      .subscribe({
        next: (response) => {
          this.projects.set(response.content);
          this.totalPages.set(response.totalPages);
          this.totalElements.set(response.totalElements);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set('Could not load projects. Please try again.');
          this.loading.set(false);
        },
      });
  }
}
