import { Pipe, PipeTransform } from '@angular/core';
import { toCardExcerpt } from './description-excerpt';

/**
 * `{{ project.description | descriptionExcerpt }}` -- the list-card summary, see
 * ./description-excerpt.ts for what it does and why the CSS clamp alone is not enough.
 *
 * A pure pipe rather than a template method call, so the excerpt is recomputed only when the
 * description itself changes rather than on every change-detection pass over the grid.
 */
@Pipe({ name: 'descriptionExcerpt' })
export class DescriptionExcerptPipe implements PipeTransform {
  transform(description: string | null | undefined): string {
    return toCardExcerpt(description);
  }
}
