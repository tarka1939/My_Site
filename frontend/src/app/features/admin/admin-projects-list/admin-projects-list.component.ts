import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { Project } from '../../../core/api/model/project';
import { ProjectWriteRequest } from '../../../core/api/model/projectWriteRequest';
import { ApiProblem } from '../../../core/http/api-problem';

const PAGE_SIZE = 20;

/**
 * What a tagless draft's row offers in place of Publish (#148). One constant for the visible text
 * and the start of the accessible name, so the two cannot drift apart (WCAG 2.5.3).
 */
const ADD_TAG_TO_PUBLISH = 'Add a tag to publish';

/** A publish or unpublish the server refused, and the project it was for. */
interface PublishFailure {
  /** Which project, so the message can link straight to its edit form. */
  projectId: string;
  title: string;
  message: string;
}

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
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  /** Every "Add a tag to publish" link, which an Unpublish can hand focus to: keepFocusInRow(). */
  private readonly addTagLinks = viewChildren<ElementRef<HTMLAnchorElement>>('addTagLink');

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
   * Reachable rather than defensive. The commonest case, a draft with no tags (#148), is no longer
   * offered a Publish button at all -- see needsTagToPublish() -- but two others remain. An
   * auto-created draft is written by the webhook rather than by this UI, so nothing guarantees its
   * other stored fields satisfy the write request's constraints. And the body is rebuilt from the
   * row as the last load saw it, so a project edited in another tab is judged on a stale copy.
   *
   * Carries the project as well as the sentence, so the message can link to the one place the
   * admin can fix it: a full list away from the row it is about, "edit the project" is a search.
   */
  protected readonly publishError = signal<PublishFailure | null>(null);

  protected readonly addTagToPublish = ADD_TAG_TO_PUBLISH;

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
   *
   * `toggle` is the button that was pressed, so its row can keep focus if the answer replaces it
   * (see keepFocusInRow()).
   */
  protected setPublished(project: Project, published: boolean, toggle?: HTMLElement): void {
    // The button is disabled while its own request is in flight; this is the guarantee behind that
    // UX, on the model of the project form's row handlers. A second PUT for the same project would
    // race the first, and the loser's response is what would end up rendered.
    if (this.publishingId() === project.id) {
      return;
    }

    // Asked now, not when the answer arrives: the button is about to be disabled for the request,
    // and a browser may take focus off a disabled control, so by then the question has no answer.
    // A keyboard user is always on it; a mouse click focuses a button in some browsers and not in
    // others (Safari), and where it does not, there is no place to keep.
    const focusedToggle =
      toggle !== undefined && this.document.activeElement === toggle ? toggle : null;

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
        next: (updated) => {
          this.projects.update((projects) =>
            projects.map((existing) => (existing.id === updated.id ? updated : existing)),
          );
          // Only when the answer swaps the button for the link. Otherwise the same button stays put
          // under the same @if branch, so there is no new control to move to.
          if (focusedToggle && this.needsTagToPublish(updated)) {
            this.keepFocusInRow(updated.id, focusedToggle);
          }
        },
        error: (problem: ApiProblem) => {
          // Optional-chained like both forms' handlers: errorInterceptor normalizes every
          // HttpErrorResponse into an ApiProblem but rethrows anything that is not one unchanged.
          const fieldErrors = problem?.fieldErrors ?? [];
          if (fieldErrors.length > 0) {
            const verb = published ? 'publish' : 'unpublish';
            const reasons = fieldErrors
              .map(({ field, message }) => `${field}: ${message}`)
              .join('; ');
            this.publishError.set({
              projectId: project.id,
              title: project.title,
              message: `Could not ${verb} "${project.title}". The server rejected it -- ${reasons}.`,
            });
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

  /**
   * A draft with no tags, which the API refuses to publish (#148) -- so its row offers the way to a
   * tag instead of a Publish button that is known to fail.
   *
   * Not offered and explained, rather than disabled and explained: a disabled button cannot take
   * focus, so a keyboard or screen reader user moving control to control never reaches it or its
   * reason, and a tooltip reaches only a mouse. The link stands where the button would and says
   * the reason in its own words, so the reason is the control. It goes to the edit form because
   * that is where a tag can be added; the row cannot.
   *
   * A live project with no tags still gets Unpublish -- a draft may be tagless, so taking it down is
   * allowed -- and the server's answer then puts this state on its row, taking focus along to the
   * link if it was on the button (keepFocusInRow()). setPublished() does not refuse a tagless
   * publish itself: the server is the authority on the rule, and a request that reaches it anyway
   * is refused with a 400 that publishError renders.
   */
  protected needsTagToPublish(project: Project): boolean {
    return !project.published && project.tags.length === 0;
  }

  /**
   * After an Unpublish turns a tagless project's button into "Add a tag to publish", put focus on
   * that link: it is the control now standing where the one the admin pressed was.
   *
   * Without this, the pressed button is destroyed and focus is left on the page, not in the row.
   * Where a keyboard user's next Tab goes then depends on the browser -- some restart from the top
   * of the page -- and a screen reader is left with nothing to announce. With it, the link's name -- "Add a tag to publish <title>" -- is what is
   * read next, which also says what just happened to the row.
   *
   * Only when focus has not moved on since. setPublished() has already established that focus was
   * on the pressed button; this checks that it is still there, or on nothing (where a disabled or
   * destroyed control leaves it). A user who has moved to another control while the request ran is
   * left where they are. A click on blank page also leaves focus on nothing, so that case is
   * treated as staying -- it cannot be told apart from a browser dropping focus off the disabled
   * button.
   *
   * After the next render, because that is when the link exists: the row repaints only once the
   * new project is set. The link is found by its project id rather than by position, because
   * several rows can show one.
   */
  private keepFocusInRow(projectId: string, pressed: HTMLElement): void {
    afterNextRender(
      {
        write: () => {
          const active = this.document.activeElement;
          if (active !== null && active !== this.document.body && active !== pressed) {
            return;
          }
          this.addTagLinks()
            .find((link) => link.nativeElement.dataset['projectId'] === projectId)
            ?.nativeElement.focus();
        },
      },
      { injector: this.injector },
    );
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
