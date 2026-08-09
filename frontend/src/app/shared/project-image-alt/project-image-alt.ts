/**
 * Alt text for a project image -- issue #87.
 *
 * The detail gallery used to build `"<title> screenshot <n>"`. That states something about the
 * image that the app has no way of knowing, and that is already false for drafted content: the
 * System Equalizer entry's two images are architecture diagrams (docs/CONTENT_DRAFT.md, branch
 * `phase6/content-draft`), so a screen reader announced "System Equalizer screenshot 1" for a block
 * diagram. Confidently wrong is worse than generic -- the user cannot tell it is wrong, and it is
 * exactly what the Phase 3 accessibility pass (#30) existed to prevent.
 *
 * **The honest constraint: there is no per-image alt text to use.** `images` is a bare array of
 * URLs in the contract and the data model, with no label, caption or ordering metadata, so nothing
 * the frontend can reach describes what any given image contains. This function therefore asserts
 * only the two things that are actually known -- which project the image belongs to, and where it
 * sits in the set -- and nothing about its content or type.
 *
 * **Why not `alt=""`.** Empty alt is the correct marking for a decorative image, and W3C/WAI's
 * decorative-images guidance turns on whether the image adds information the surrounding text
 * already carries. These do add information: the gallery is the only place a project's visual
 * material appears, and the description never describes it. Marking them decorative would remove
 * them from the accessibility tree entirely, so a screen-reader user would not learn the project
 * *has* diagrams or screenshots and could not go look for them. Withholding the fact that an image
 * exists is a different failure from mislabelling it, not a safer one.
 *
 * The list-card thumbnail is the opposite case and is marked `alt=""` in that template: it sits
 * inside a link whose visible text is already the project title, so a non-empty alt there is
 * redundant with adjacent text -- the WAI case where empty alt is right.
 *
 * **Why not derive something from the URL.** A filename ("dsp_execution_pipeline.svg") is a path
 * component, not a description written for a reader; it can equally well be "IMG_20240513.png".
 * Guessing from it would swap one unfounded claim for another, less predictable one.
 *
 * A correct fix needs per-image alt text in the model and the contract, which is a change to the
 * 2026-07-24 images ADR and is deliberately out of scope here -- see the report on this branch.
 * Until then this is the most that can truthfully be said.
 */
export function projectImageAlt(title: string, index: number, total: number): string {
  // "image N of M" gives orientation within the gallery -- how many there are, and which one this
  // is. With a single image there is nothing to orient against, so "image 1 of 1" would just be
  // noise ahead of the screen reader's own "graphic" announcement.
  const position = total > 1 ? `image ${index + 1} of ${total}` : 'image';

  // `title` is required and non-empty per the contract; if it ever arrives blank, drop the naming
  // clause rather than emitting a leading comma.
  const name = title?.trim();
  return name ? `${name}, ${position}` : position;
}
