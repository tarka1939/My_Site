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
 * only what is actually known -- which project the image belongs to, and, in a gallery of more
 * than one, where it sits in the set -- and nothing about its content or type. It also says no
 * more than that: no "image"/"photo of" role word, which W3C/WAI's alt decision tree rules out
 * because assistive tech announces the role itself.
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
  // `title` is required and non-empty per the contract; if it ever arrives blank, drop the naming
  // clause rather than emitting a leading comma.
  const name = title?.trim();

  // "image N of M" gives orientation within the gallery -- how many there are, and which one this
  // is. That position is information the user cannot get any other way, and it is worth the
  // redundancy of the word "image" sitting in front of the screen reader's own "graphic".
  if (total > 1) {
    const position = `image ${index + 1} of ${total}`;
    return name ? `${name}, ${position}` : position;
  }

  // A lone image has nothing to orient against, so there is no position to give -- and a bare
  // "image" is the "image of"/"photo of" prefix that W3C/WAI's alt decision tree exists to talk
  // people out of: assistive tech announces the role itself, so the word only adds "graphic,
  // image, graphic". The title alone is everything that is both known and worth saying. The blank
  // fallback stays "image" rather than "" on purpose -- an empty alt marks the image decorative,
  // which is the one claim the paragraph above rules out.
  return name || 'image';
}
