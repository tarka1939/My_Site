import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  artworkSeed,
  artworkSpec,
  drawProjectArtwork,
} from './project-artwork';

/**
 * A project's generated card artwork -- see ./project-artwork.ts for what is drawn and why.
 *
 * Three things about this component are requirements rather than choices (docs/DECISIONS.md,
 * 2026-08-22), so each is called out where it is implemented:
 *
 * 1. **It must not run for a card that has an image.** Enforced at the call site by not rendering
 *    it: projects-list only reaches this component in the `@else` of "does the project have an
 *    image", so on a card with one nothing here is constructed, no seed is hashed and no drawing
 *    context is requested. That is a stronger guarantee than an input flag, which would still cost
 *    the work before deciding not to show it, and it is what the spec asserts -- that `getContext`
 *    is never called at all.
 *
 * 2. **It must degrade to a plain surface, never a hole.** The canvas is transparent and paints
 *    nothing of its own; the plate underneath belongs to the card's media slot. So the failure
 *    path is *doing nothing*: no context, no drawing, and the slot still reads as the same plate
 *    every other card has. `data-artwork` reports which happened, so the degraded state is
 *    observable instead of merely invisible.
 *
 * 3. **It carries nothing a screen reader needs.** `aria-hidden="true"` on the host, chosen over
 *    the two alternatives: a bare `<canvas>` has no accessible name but is still an element in the
 *    tree, and `role="presentation"` removes this element's own semantics while leaving its
 *    subtree in place. `aria-hidden` removes the element *and* everything under it, which is
 *    exactly the claim being made. It is a static attribute, so it cannot be forgotten by whoever
 *    renders the component next, and it is what keeps `textContent` on the surrounding card link
 *    equal to the text a visitor actually hears.
 */
@Component({
  selector: 'app-project-artwork',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[attr.data-artwork]': 'state()',
  },
  template: '<canvas #surface></canvas>',
  styles: `
    :host {
      display: block;
      // Deliberately no background. The card's media slot owns the plate, and painting one here
      // too would composite two layers of the semi-transparent --color-surface-muted, leaving
      // artwork cards on a visibly different ground from image cards -- which is the exact
      // inconsistency this treatment exists to remove.
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class ProjectArtworkComponent implements AfterViewInit, OnChanges {
  readonly projectTitle = input.required<string>();

  /**
   * Structurally typed rather than importing the generated `Tag`: this draws a picture from names
   * and has no business depending on the API contract. Pass `project.tags` straight in -- the
   * array reference is what the seed is memoised on, so a stable reference means one paint.
   */
  readonly tags = input<readonly { name: string }[]>([]);

  private readonly surface = viewChild.required<ElementRef<HTMLCanvasElement>>('surface');

  /** 'plain' until something has actually been drawn. See point 2 in the class comment. */
  protected readonly state = signal<'plain' | 'painted'>('plain');

  private readonly spec = computed(() =>
    artworkSpec(
      artworkSeed(
        this.projectTitle(),
        this.tags().map((tag) => tag.name),
      ),
    ),
  );

  /**
   * Two plain lifecycle hooks rather than `afterRenderEffect`, which is the idiomatic way to write
   * to the DOM from signal state and was what this used first. It was changed on a measurement:
   * against the same tree, the initial bundle came out at 303.17 kB on these hooks, 305.64 kB on
   * `afterNextRender` and 307.01 kB on `afterRenderEffect` -- so the reactive render effect costs
   * 3.84 kB of a budget with 18 kB of headroom left, to schedule a paint that `ngAfterViewInit`
   * can do directly. The canvas is in the DOM by then, which is the only thing the timing has to
   * guarantee, and nothing here reads layout.
   *
   * `ngOnChanges` is what the effect was really buying, and it is free: a card is tracked by
   * project id, so this instance survives a change to the title it draws from and would otherwise
   * go on showing the old project's picture. It costs a flag because it fires before the view
   * exists on the first pass, and `viewChild.required` would throw there.
   */
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.paint();
  }

  ngOnChanges(): void {
    if (this.viewReady) {
      this.paint();
    }
  }

  private paint(): void {
    const canvas = this.surface().nativeElement;

    // Sized in device pixels and drawn in logical ones, so the curve is crisp on a HiDPI screen
    // without the artwork itself depending on the screen. Capped at 2: beyond that the memory
    // (twelve of these on a full page) buys nothing visible on a soft gradient.
    const ratio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 2);
    canvas.width = Math.round(ARTWORK_WIDTH * ratio);
    canvas.height = Math.round(ARTWORK_HEIGHT * ratio);

    let context: CanvasRenderingContext2D | null = null;
    try {
      // One `try` covering both shapes of "no canvas here": a context that comes back null, and a
      // `getContext` that is missing or throws. Neither is an error worth reporting -- the card
      // has a working appearance without it -- so this stays silent and leaves `state` at 'plain'.
      context = canvas.getContext('2d');
    } catch {
      context = null;
    }
    if (!context) {
      return;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawProjectArtwork(context, this.spec());
    this.state.set('painted');
  }
}
