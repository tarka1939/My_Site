import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/api/api/projects.service';
import { TagsService } from '../../../core/api/api/tags.service';
import { Project } from '../../../core/api/model/project';
import { Tag } from '../../../core/api/model/tag';
import { DescriptionExcerptPipe } from '../../../shared/description-excerpt/description-excerpt.pipe';
import { ProjectArtworkComponent } from '../../../shared/project-artwork/project-artwork.component';
import { ProjectPeriodComponent } from '../../../shared/project-period/project-period.component';

const PAGE_SIZE = 12;

@Component({
  selector: 'app-projects-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ProjectArtworkComponent, ProjectPeriodComponent, DescriptionExcerptPipe],
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

  /**
   * Image URLs whose <img> has told us, by firing `error`, that it did not arrive.
   *
   * `error` is the only signal used, and the alternatives are worse rather than merely different:
   * `naturalWidth === 0` polling and a load timeout both fire on an image that is *slow*, and would
   * throw away a picture that was about to appear on a bad connection. `error` fires on genuine
   * failure -- DNS, 404, 403, a rate-limited host, a blocked origin -- and never on a slow load.
   *
   * Keyed by URL, not by project id. The failure belongs to the URL: an admin who repairs a dead
   * link changes it, and the card then recovers on the next load without anything here having to
   * notice the edit. Two cards pointing at one dead URL are also genuinely both dead. Nothing
   * clears this on a re-fetch on purpose -- a URL that failed a moment ago has not been fixed by
   * a page change, and re-adding the <img> only to watch it fail again is a visible flicker.
   *
   * Two things bound how much that decision can cost, and neither was obvious enough to leave
   * unsaid. The set belongs to **this component instance, not to the session**: this route carries
   * no parameters, so the param-only navigation that Angular's default RouteReuseStrategy would
   * reuse a component across cannot occur here -- opening a project and coming back destroys this
   * component and builds a new one with an empty set. Nothing recorded here outlives a single
   * visit to the page, which is most of why holding a failure for the whole of it is safe.
   * And it does mean a **transient** failure is held for the whole of that visit: a 429 from a
   * rate-limited host, or a momentary blip, keeps its card on artwork until the visitor leaves the
   * page. Nothing here can tell a temporary failure from a permanent one, and of the two ways to
   * be wrong, retrying is the one the visitor watches happen.
   */
  private readonly failedImages = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Id of the first project on the page that actually has an image -- i.e. the owner of the first
   * <img> the grid renders, which is the LCP candidate that must not be lazy-loaded.
   *
   * Deliberately not `$first` in the template: that indexes over projects, not over projects that
   * have images. `images` is optional content with no upload pipeline, so one imageless project at
   * the top of a createdAt-DESC list would otherwise leave every image on the page lazy.
   *
   * Equally deliberately, this does *not* read `failedImages`, and the consequence of that is
   * larger than the in-place case it was first written for, so it is set out here in full rather
   * than in the flattering half.
   *
   * The easy case is an image that dies in place: promoting the next card would re-create that
   * card's <img> in the other branch of the template and re-request a picture already in flight.
   *
   * The case that is easy to miss is a rebuild. A tag toggle and a pagination step both destroy the
   * grid and build every <img> again from nothing, and this still returns the id of a project whose
   * image is known dead, because it asks only whether a project *has* an image. That card renders
   * artwork, so nothing matches the id, and **no image on the page carries `eager` or
   * `fetchpriority="high"` for the rest of this component's life.**
   *
   * That behaviour stays. It costs nothing it claims to protect: both paths that rebuild the grid
   * are clicks, and LCP stops taking candidates at the first user interaction, so by the time
   * either one runs there is no largest contentful paint left to win. What is given up after a
   * toggle is a priority hint on an image that can no longer be the thing the hint exists to serve.
   *
   * Where it does cost something is a dead image on the *first* paint -- the bet is placed on that
   * card, lost, and not re-placed, so whichever card inherits the top of the grid loads without
   * `fetchpriority="high"`. That is a lost priority hint and not a lost image: `loading="lazy"`
   * withholds nothing at or near the viewport. Buying it back means making this computed reactive
   * to failure, which tears down and re-creates a *healthy* card's <img> mid-page in order to
   * change one attribute on it. The hint is not worth the teardown.
   */
  protected readonly firstImageProjectId = computed(
    () => this.projects().find((project) => project.images.length > 0)?.id ?? null,
  );

  constructor() {
    this.tagsApi.listTags().subscribe({
      next: (tags) => this.allTags.set(tags),
    });
    this.loadProjects();
  }

  /**
   * What a card's media slot is showing, and why.
   *
   * This is both the template's branch condition and the value it publishes as `data-media`, so the
   * attribute cannot drift from what was actually rendered -- there is one decision, read twice.
   *
   * `'artwork'` and `'artwork-fallback'` draw the same picture and are still two values, because
   * "this project has no image" and "this project's image is broken" are different situations: the
   * first is ordinary and the second is something the owner would want to fix. It extends the
   * observability the artwork host already provides rather than adding a mechanism of another kind
   * -- `data-artwork="painted" | "plain"` says how the drawing went, `data-media` says why it was
   * asked for -- and it stays out of the accessibility tree, since neither is anything a visitor
   * needs told.
   */
  protected mediaKind(project: Project): 'image' | 'artwork' | 'artwork-fallback' {
    if (project.images.length === 0) {
      return 'artwork';
    }
    return this.failedImages().has(project.images[0]) ? 'artwork-fallback' : 'image';
  }

  /**
   * An <img> reported that its source did not load. Record the URL, which swaps that card -- and
   * only cards showing that URL -- over to generated artwork.
   *
   * Guarded so a repeat `error` for a URL already known bad does not replace the set and repaint
   * the whole grid. A browser can fire `error` more than once for one element.
   */
  protected onImageError(url: string): void {
    if (this.failedImages().has(url)) {
      return;
    }
    this.failedImages.update((failed) => new Set(failed).add(url));
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
