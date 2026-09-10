import { Pipe, PipeTransform } from '@angular/core';
import { markdownToSummaryText } from '../markdown/markdown';
import { toCardExcerpt } from './description-excerpt';

/**
 * `{{ project.description | descriptionExcerpt }}` -- the list-card summary, see
 * ./description-excerpt.ts for what it does and why the CSS clamp alone is not enough.
 *
 * A pure pipe rather than a template method call, so the excerpt is recomputed only when the
 * description itself changes rather than on every change-detection pass over the grid.
 *
 * <h2>Why the Markdown flattening lives here and not in toCardExcerpt</h2>
 *
 * `description` is Markdown since #206, so a card would otherwise show `**bold**`. The obvious
 * place to strip that is inside `toCardExcerpt`, and it is the wrong one: `core/seo/site-meta.ts`
 * imports that function and sits in the **eager** graph, so a renderer import there pulls all of
 * markdown-it into the initial bundle -- measured at 409.5 kB against a 400 kB error budget, +105
 * kB on first paint for a parser the landing page needs only after its data arrives.
 *
 * This pipe is reached only from `projects-list`, which is lazy, so the cost stays in the chunk
 * that uses it. "Every route is lazy" was not enough to conclude the budget was safe -- a shared
 * util imported by one eager file is all it takes, and only the build output says so.
 *
 * <h2>Flatten first, then split</h2>
 *
 * The marks would otherwise reach the card verbatim, which is the whole reason. An earlier version
 * of this comment gave a second reason and had it exactly backwards -- it claimed splitting the
 * source first would "cut a bulleted opener after its first bullet". It is the other way round:
 * the source has no blank line between bullets, so splitting first keeps the list whole, and it
 * was *flattening* first that cut after bullet one, because `</li>` was closing to a blank line.
 * That is fixed in `stripToText`, where list items now close to a single newline; the comment is
 * corrected here rather than deleted because the claim was wrong in a direction that would have
 * made someone re-introduce the bug while "restoring" the stated behaviour.
 *
 * `markdownToSummaryText`, not `markdownToPlainText`: the summary variant drops heading blocks, so
 * a description opening with `## What it does` -- the natural way to write one -- summarises to the
 * prose underneath rather than to the heading. See that function for how this was found.
 */
@Pipe({ name: 'descriptionExcerpt' })
export class DescriptionExcerptPipe implements PipeTransform {
  transform(description: string | null | undefined): string {
    return toCardExcerpt(markdownToSummaryText(description));
  }
}
