import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { Project } from '../../../core/api/model/project';
import { ProjectWriteRequest } from '../../../core/api/model/projectWriteRequest';
import { ApiProblem } from '../../../core/http/api-problem';

const PAGE_SIZE = 20;

/**
 * The body that flips one project's publication and changes nothing else.
 *
 * There is no PATCH in the contract: PUT /projects/{id} takes a ProjectWriteRequest and is a
 * **full replacement**, so a body carrying only `published` would clear the title, description,
 * tags, links, images and both dates. Every curated field is therefore copied back out of the row
 * the list is already holding -- that is what makes this a publication change rather than issue
 * #92's blank-form PUT arriving through a different button.
 *
 * `repoFullName` is the one field deliberately *not* sent. Omitted means "leave it as it is" (see
 * ProjectWriteRequest in docs/openapi.yaml), which is exactly right here: publishing is not a
 * statement about which repository a project tracks, and re-sending a value the list happens to
 * hold is one more thing that can be stale. The GitHub-authoritative fields -- `lastPushedAt`,
 * `defaultBranch`, `archived` -- are not on the write request at all, so a PUT cannot touch them.
 *
 * The staleness that remains: this copies the row as the last list load saw it, so a project
 * edited elsewhere between that load and this click would have the older copy written back. One
 * admin in one session is the assumption; a second tab is what would break it.
 */
function publicationChange(project: Project, published: boolean): ProjectWriteRequest {
  return {
    title: project.title,
    description: project.description,
    tags: project.tags.map((tag) => tag.name),
    links: project.links,
    images: project.images,
    // Explicit null rather than an omitted key, matching the form: for these two, omitted *clears*,
    // so saying "this project has no start date" out loud beats relying on an absent field.
    startedOn: project.startedOn,
    completedOn: project.completedOn,
    published,
  };
}

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
  protected readonly publishingId = signal<string | null>(null);
  /**
   * Set when a publish/unpublish was rejected with *field* errors, which is the one failure nobody
   * else reports: errorInterceptor deliberately stays quiet for a 400 that carries them, on the
   * assumption that a form renders them inline -- and this page has no form. Without this the
   * button would go back to its old label and nothing anywhere would say why.
   *
   * Reachable rather than defensive: an auto-created draft is written by the webhook rather than by
   * this UI, so nothing guarantees its stored fields satisfy the write request's constraints.
   */
  protected readonly publishError = signal<string | null>(null);

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

  /**
   * Publish a draft, or take a live project down without deleting it.
   *
   * Deleting is not the way to unpublish: a project the GitHub sync knows about is recreated as a
   * draft by the next push to its repository, so a delete meant as "hide this" comes back.
   */
  protected setPublished(project: Project, published: boolean): void {
    // The button is disabled while its own request is in flight; this is the guarantee behind that
    // UX, on the model of the project form's row handlers. A second PUT for the same project would
    // race the first, and the loser's response is what would end up rendered.
    if (this.publishingId() === project.id) {
      return;
    }

    this.publishError.set(null);
    this.publishingId.set(project.id);

    this.projectsApi
      .updateProject({ id: project.id, projectWriteRequest: publicationChange(project, published) })
      // finalize(), not a set() in each handler: a stream that completed without emitting or
      // erroring would leave this row's button disabled for good with nothing said about why.
      .pipe(finalize(() => this.publishingId.set(null)))
      .subscribe({
        // The response is the project as stored, so the row is replaced with it rather than patched
        // with what was asked for -- what is on screen then describes what the server did. No
        // reload: it would throw away the page position and re-fetch twenty rows to change one.
        next: (updated) =>
          this.projects.update((projects) =>
            projects.map((existing) => (existing.id === updated.id ? updated : existing)),
          ),
        error: (problem: ApiProblem) => {
          // Optional-chained like both forms' handlers: errorInterceptor normalizes every
          // HttpErrorResponse into an ApiProblem but rethrows anything that is not one unchanged.
          const fieldErrors = problem?.fieldErrors ?? [];
          if (fieldErrors.length > 0) {
            const verb = published ? 'publish' : 'unpublish';
            const reasons = fieldErrors
              .map(({ field, message }) => `${field}: ${message}`)
              .join('; ');
            this.publishError.set(
              `Could not ${verb} "${project.title}". The server rejected it -- ${reasons}. Edit the project to fix it.`,
            );
          }
          // Everything else has already been toasted by errorInterceptor.
        },
      });
  }

  /**
   * The verb on this project's publish button, and -- joined with the title -- its accessible name.
   *
   * One source for both, so the visible label can never drift out of the accessible one (WCAG
   * 2.5.3). It reads publishingId(), so the row repaints when a request starts and finishes;
   * `project.published` is still the pre-request value while one is in flight, which is what makes
   * "Publishing..." the right word for a draft rather than "Unpublishing...".
   */
  protected publishAction(project: Project): string {
    if (this.publishingId() === project.id) {
      return project.published ? 'Unpublishing…' : 'Publishing…';
    }
    return project.published ? 'Unpublish' : 'Publish';
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

  /**
   * listAllProjects (GET /admin/projects), not listProjects.
   *
   * The public listing filters to `published = true` unconditionally -- no parameter, header or
   * credential widens it -- so this page was structurally incapable of showing a draft, never mind
   * publishing one. The admin operation returns the same schema with drafts included.
   */
  private loadProjects(): void {
    this.loading.set(true);
    this.publishError.set(null);
    this.projectsApi.listAllProjects({ page: this.page(), size: PAGE_SIZE }).subscribe({
      next: (response) => {
        this.projects.set(response.content);
        this.totalPages.set(response.totalPages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
