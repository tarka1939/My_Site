import { Link } from '../../core/api/model/link';
import { ProjectWriteRequest } from '../../core/api/model/projectWriteRequest';

/**
 * What the admin project form calls each field of a ProjectWriteRequest, and the one place those
 * words live (#308).
 *
 * Two readers need them. The form labels its inputs with them, and the projects list names a field
 * with them when it reports a rejected Publish. The form never shows a server key -- each message
 * goes on the input it is about -- but the list has no inputs, and it used to print the key itself
 * (`tags: At least one tag is required to publish`). The banner links to the form, so the word it
 * uses has to be the word the admin then finds there. The form's template reads its labels from
 * here rather than holding them as literals, so the two cannot be edited apart.
 */

/**
 * The label of every write-request field the form has an input for, keyed by the field name the
 * API reports a violation under.
 *
 * `satisfies` against the generated model is what keeps the API side honest: a field added to
 * ProjectWriteRequest in docs/openapi.yaml fails the build here until it is given a label or added
 * to the exclusion, and a key spelled differently from the model's is an excess property.
 *
 * `repoFullName` is the one field excluded. The form does not edit it and the list never sends it,
 * so neither can be rejected over it, and with no input on the form there is no label to borrow --
 * a rejection that named it anyway would get the message alone, like any key not mapped here.
 */
export const PROJECT_FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  // The form adds "(comma-separated)" after this. That is how to fill the box in, not what the
  // field is called, so it is left out of the name.
  tags: 'Tags',
  published: 'Published',
  startedOn: 'Start date',
  completedOn: 'Completion date',
  links: 'Links',
  images: 'Image URLs',
} as const satisfies Record<Exclude<keyof ProjectWriteRequest, 'repoFullName'>, string>;

/**
 * One input in a link or image row: what the row is called, and what the input holds. The form
 * labels the input "<row> <part>" ("Link URL"); the list names one row's input "<row> <n>'s <part>"
 * ("Link 1's URL"). Two shapes of one pair of words, so the pair is what is stored.
 */
interface RowInput {
  readonly row: string;
  readonly part: string;
}

const LINK_LABEL: RowInput = { row: 'Link', part: 'label' };
const LINK_URL: RowInput = { row: 'Link', part: 'URL' };
const IMAGE_URL: RowInput = { row: 'Image', part: 'URL' };

/** Keyed by the Link property the API reports after `links[n].`, checked against the model. */
const LINK_PARTS: Record<keyof Link, RowInput> = { label: LINK_LABEL, url: LINK_URL };

function inputLabel(input: RowInput): string {
  return `${input.row} ${input.part}`;
}

/** The labels of the row inputs, as the form shows them (visually hidden) and words its errors. */
export const PROJECT_ROW_INPUT_LABELS = {
  linkLabel: inputLabel(LINK_LABEL),
  linkUrl: inputLabel(LINK_URL),
  imageUrl: inputLabel(IMAGE_URL),
} as const;

/**
 * The form has one comma-separated box for every tag, so there is no per-tag label to borrow. A
 * `tags[2]` complaint is still about one tag, and "Tag 3" says which.
 */
const TAG = 'Tag';

const TAG_KEY = /^tags\[(\d+)\]$/;
const IMAGE_KEY = /^images\[(\d+)\]$/;
const LINK_KEY = /^links\[(\d+)\]\.([A-Za-z]+)$/;

/**
 * 1-based, the way the form counts its rows to the admin ("Remove link 1"). The API's index is the
 * position in the list it was sent, which is the order the form and the list both show.
 */
function position(index: string): number {
  return Number(index) + 1;
}

/** One row's input, named for a reader with no row in front of them: "Link 1's URL". */
function elementName(input: RowInput, index: string): string {
  return `${input.row} ${position(index)}'s ${input.part}`;
}

/**
 * The name to show the admin for the field a server key names, or null when nothing here covers
 * it -- in which case the caller shows the message alone. A key is never the fallback: it is the
 * wire's word, and showing it raw is the defect this exists to end.
 *
 * Object.hasOwn rather than `key in`, because the keys come off the wire: `constructor` or
 * `toString` would otherwise find a name on Object.prototype and render a function.
 */
export function projectFieldName(key: string): string | null {
  if (Object.hasOwn(PROJECT_FIELD_LABELS, key)) {
    return PROJECT_FIELD_LABELS[key as keyof typeof PROJECT_FIELD_LABELS];
  }

  const tag = TAG_KEY.exec(key);
  if (tag) {
    return `${TAG} ${position(tag[1])}`;
  }

  const image = IMAGE_KEY.exec(key);
  if (image) {
    return elementName(IMAGE_URL, image[1]);
  }

  const link = LINK_KEY.exec(key);
  if (link && Object.hasOwn(LINK_PARTS, link[2])) {
    return elementName(LINK_PARTS[link[2] as keyof Link], link[1]);
  }

  return null;
}
