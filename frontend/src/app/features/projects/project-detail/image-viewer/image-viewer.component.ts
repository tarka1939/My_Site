import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { projectImageAlt } from '../../../../shared/project-image-alt/project-image-alt';

/**
 * A full-screen viewer for one project's gallery images, opened by the detail page.
 *
 * Built on the native `<dialog>` opened with `showModal()` rather than a positioned `<div>`,
 * because the modal dialog is what gets the hard parts right without any code here: the rest of the
 * page becomes inert (a real focus trap, and screen readers cannot wander out of it), the dialog
 * sits in the top layer above every stacking context, and it has a `::backdrop`. No dependency --
 * a CDK overlay would be a new package for what the platform already does.
 *
 * Two platform behaviours are nonetheless also done explicitly, on purpose:
 *
 * - **Focus on open and on close.** `showModal()` focuses the `autofocus` Close button and a
 *   browser returns focus to the previously focused element on close. Both are re-done here
 *   (`focus()` after opening, the opener's `focus()` in `onClosed`), because the opener is known
 *   exactly here and a browser's "previously focused element" is not guaranteed to be it -- and
 *   because jsdom implements neither, so without the explicit calls the specs could only ever be
 *   testing their own stub.
 * - **Escape.** A browser closes a modal dialog on Escape by itself (via `cancel`). The keydown
 *   handler closes it too, which is harmless -- `close()` on a closed dialog is a no-op -- and is
 *   what keeps Escape working where a browser declines the `cancel` (Chrome ignores a second
 *   Escape without intervening user activation).
 *
 * Previous/Next **wrap** rather than disabling at the ends. A disabled button cannot hold focus, so
 * pressing Next until it disabled would drop keyboard focus onto the dialog's body mid-gallery; a
 * project has two or three images, so wrapping is also never disorienting.
 */
@Component({
  selector: 'app-image-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-viewer.component.html',
  styleUrl: './image-viewer.component.scss',
})
export class ImageViewerComponent {
  /** The project's image URLs, in gallery order. */
  readonly images = input.required<readonly string[]>();
  /** The project title, which the alt text is built from -- the same helper the gallery uses. */
  readonly title = input.required<string>();

  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  /** The image being shown, or null while the viewer is closed. */
  protected readonly index = signal<number | null>(null);
  protected readonly count = computed(() => this.images().length);
  protected readonly current = computed(() => {
    const index = this.index();
    return index === null ? null : (this.images()[index] ?? null);
  });
  /** Same text as the gallery image it was opened from, so the viewer asserts nothing more (#87). */
  protected readonly alt = computed(() => {
    const index = this.index();
    return index === null ? '' : projectImageAlt(this.title(), index, this.count());
  });

  private opener: HTMLElement | null = null;
  /** The root's inline `overflow` before the viewer locked scrolling; null while nothing is locked. */
  private savedOverflow: string | null = null;

  constructor() {
    // The detail page can be torn down under an open viewer -- the browser's Back button is not
    // blocked by a modal dialog -- and a lock left on <html> would freeze scrolling on every page
    // after it. The dialog itself goes with the component, so the lock is all that needs undoing.
    inject(DestroyRef).onDestroy(() => this.unlockScroll());
  }

  /** Shows image `index`. `opener` gets focus back when the viewer closes. */
  open(index: number, opener: HTMLElement | null): void {
    const dialog = this.dialog().nativeElement;
    this.index.set(index);
    if (dialog.open) {
      return;
    }
    this.opener = opener;
    this.lockScroll();
    dialog.showModal();
    this.closeButton().nativeElement.focus();
  }

  protected close(): void {
    // Cleanup lives in onClosed, not here: Escape via the browser's own `cancel`, and any other
    // path that closes the dialog, all arrive through the `close` event and must clean up too.
    this.dialog().nativeElement.close();
  }

  protected onClosed(): void {
    this.index.set(null);
    this.unlockScroll();
    this.opener?.focus();
    this.opener = null;
  }

  protected step(delta: number): void {
    const index = this.index();
    const count = this.count();
    if (index === null || count < 2) {
      return;
    }
    this.index.set((index + delta + count) % count);
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowLeft':
        if (this.count() > 1) {
          event.preventDefault();
          this.step(-1);
        }
        break;
      case 'ArrowRight':
        if (this.count() > 1) {
          event.preventDefault();
          this.step(1);
        }
        break;
    }
  }

  /**
   * Closes on a click that lands outside the picture: on the dialog itself (which is where a click
   * on `::backdrop` is delivered), on the empty stage around the image, or on the letterbox the
   * image's own box paints around it. The control bars are not "outside" -- a near miss on a
   * button must not throw the viewer away.
   */
  protected onClick(event: MouseEvent): void {
    const target = event.target;
    if (target === this.dialog().nativeElement || target === this.stage().nativeElement) {
      this.close();
    } else if (
      target instanceof HTMLImageElement &&
      isOutsidePaintedImage(target, event.clientX, event.clientY)
    ) {
      this.close();
    }
  }

  private lockScroll(): void {
    const root = this.document.documentElement;
    this.savedOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }

  private unlockScroll(): void {
    if (this.savedOverflow === null) {
      return;
    }
    this.document.documentElement.style.overflow = this.savedOverflow;
    this.savedOverflow = null;
  }
}

/**
 * Whether a click at (`x`, `y`) misses the picture an `object-fit: contain` image actually paints.
 *
 * The viewer's `<img>` fills the whole stage so the picture can scale up to it, which means its
 * *box* covers the letterbox bars too -- and a click on a bar is, to the person making it, a click
 * beside the image. Assumes the default `object-position` (centred). An image whose intrinsic size
 * is not known yet (still loading, or failed) reports "inside" throughout: better to leave the
 * viewer open on an ambiguous click than to close it under someone.
 */
export function isOutsidePaintedImage(image: HTMLImageElement, x: number, y: number): boolean {
  const { naturalWidth, naturalHeight } = image;
  if (!naturalWidth || !naturalHeight) {
    return false;
  }
  const box = image.getBoundingClientRect();
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const left = box.left + (box.width - width) / 2;
  const top = box.top + (box.height - height) / 2;
  return x < left || x > left + width || y < top || y > top + height;
}
