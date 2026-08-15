import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, Observable, catchError, filter, map, switchMap, tap } from 'rxjs';
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
    // Both operators exist for the same reason, and neither is optional now that the callbacks
    // below write into `document.head` -- global state that outlives this component.
    //
    // `switchMap` rather than a nested `subscribe`: /projects/a -> /projects/b reuses this
    // component instance, so without it the request for `a` stays in flight and its response
    // writes a's title and description onto b's page whenever it lands second.
    //
    // `takeUntilDestroyed` covers the other exit: navigating off the route entirely. Without it a
    // request for a project that then 404s calls `setRobots(NOINDEX)` from a destroyed component,
    // leaving `noindex, nofollow` on whatever public page the user has since landed on.
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => !!id),
        switchMap((id) => this.loadProject(id)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /**
   * Alt text for gallery image `index` -- see shared/project-image-alt/project-image-alt.ts, which
   * holds the reasoning for what this may and may not assert about an image it cannot see.
   */
  protected imageAlt(project: Project, index: number): string {
    return projectImageAlt(project.title, index, project.images.length);
  }

  /**
   * Requests one project and applies it. Returns the request rather than subscribing to it, so the
   * caller's `switchMap`/`takeUntilDestroyed` own its lifetime -- see the constructor.
   */
  private loadProject(id: string): Observable<Project> {
    this.loading.set(true);
    this.notFound.set(false);
    return this.projectsApi.getProject({ id }).pipe(
      tap((project) => {
        this.project.set(project);
        this.loading.set(false);
        this.describe(project);
      }),
      catchError(() => {
        this.notFound.set(true);
        this.loading.set(false);
        // A project that does not exist is still served as HTTP 200 with the app shell (Netlify
        // rewrites everything to index.html), so without this a deleted project's URL stays
        // indexable, advertising the route's generic placeholder description forever.
        this.seo.setRobots(NOINDEX);
        // EMPTY, not a rethrow: the failure is fully handled here, and letting it propagate would
        // kill the outer paramMap subscription, so the next project would never load.
        return EMPTY;
      }),
    );
  }

  /**
   * Replaces the route's placeholder title and description with the project's own.
   *
   * This has to happen here rather than in the route config: the project is not known until the API
   * answers, which is after the navigation that applied the route's `data`.
   *
   * Nothing needs undoing on the way out -- but *not* because SeoTitleStrategy overwrites whatever
   * this wrote. The strategy only runs during a navigation, and an HTTP callback is by definition a
   * write that can land after one has finished, so on its own it guarantees nothing here. What
   * makes this safe is that the callback can never run late at all: the request is cancelled by
   * `switchMap` when the id changes and by `takeUntilDestroyed` when the route is left, so a
   * response for a page the user has moved off is discarded rather than applied to the new one.
   *
   * `SeoService` does the truncating and the escaping; `description` is passed in raw.
   */
  private describe(project: Project): void {
    this.seo.setTitle(siteTitle(project.title));
    this.seo.setDescription(project.description);
    // No setRobots(undefined) here: /projects/missing -> /projects/real is a navigation, and the
    // strategy removes the tag on any navigation whose route declares no robots. That removal
    // reliably lands *before* this callback, which is what makes relying on it sound: the
    // navigation completes first, and a request still in flight for the previous id is cancelled
    // at that point rather than left to resolve over the new page.
  }
}
