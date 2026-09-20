import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AboutService } from '../../core/api/api/about.service';
import { SeoService } from '../../core/seo/seo.service';
import { markdownToSummaryText, renderMarkdown } from '../../shared/markdown/markdown';

/**
 * The public About page (#213). One GET, one Markdown body, rendered through exactly the path a
 * project description takes -- `renderMarkdown` at `html: false`, then `[innerHTML]` and Angular's
 * sanitizer. No second renderer and no `bypassSecurityTrustHtml`; see shared/markdown/markdown.ts.
 *
 * There is no "not found" state. The contract guarantees the row exists (the migration creates it),
 * so the only shapes this page has are loading, failed, empty and written. An empty body is the
 * unwritten page and gets a calm notice, not a blank -- and not a 404, which would tell a search
 * engine that a page in the sitemap does not exist.
 */
@Component({
  selector: 'app-about-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about-page.component.html',
  styleUrl: './about-page.component.scss',
})
export class AboutPageComponent {
  private readonly aboutApi = inject(AboutService);
  private readonly seo = inject(SeoService);

  protected readonly body = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly bodyHtml = computed(() => renderMarkdown(this.body()));
  protected readonly isEmpty = computed(() => (this.body() ?? '').trim().length === 0);

  constructor() {
    this.aboutApi
      .getAboutPage()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (page) => {
          this.body.set(page.body);
          this.loading.set(false);
          // The route's static description is what applies on navigation (seo-title.strategy);
          // once the body is here, the first real paragraph is a better meta description than a
          // sentence written before the page had content. The summary flattener, not the faithful
          // one, for the reason project-detail gives: a body opening with a heading would otherwise
          // make that heading the whole tag. An empty body keeps the route's description.
          const summary = markdownToSummaryText(page.body);
          if (summary) {
            this.seo.setDescription(summary);
          }
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set('The page could not be loaded. Please try again later.');
        },
      });
  }
}
