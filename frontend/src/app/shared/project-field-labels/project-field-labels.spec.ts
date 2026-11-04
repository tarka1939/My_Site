import { PROJECT_ROW_INPUT_LABELS, projectFieldName } from './project-field-labels';

/**
 * The expected names are written out rather than read back from PROJECT_FIELD_LABELS: what is
 * pinned here is what the admin reads, and an assertion that agreed with whatever the constant said
 * would pass a wording change nobody meant. The form's own spec checks that it renders the same
 * constants, which is the other half of the two not drifting apart.
 */
describe('projectFieldName', () => {
  it.each([
    ['title', 'Title'],
    ['description', 'Description'],
    ['tags', 'Tags'],
    ['published', 'Published'],
    ['featured', 'Featured'],
    ['startedOn', 'Start date'],
    ['completedOn', 'Completion date'],
    ['links', 'Links'],
    ['images', 'Image URLs'],
  ])('names %s by its label on the form', (key, name) => {
    expect(projectFieldName(key)).toBe(name);
  });

  it.each([
    ['tags[0]', 'Tag 1'],
    ['tags[4]', 'Tag 5'],
    ['images[0]', "Image 1's URL"],
    ['images[19]', "Image 20's URL"],
  ])('counts an indexed key from 1, as the form counts its rows: %s', (key, name) => {
    // The API's index is 0-based; the form's "Remove link 1" is not, and neither is an admin.
    expect(projectFieldName(key)).toBe(name);
  });

  it.each([
    ['links[0].label', "Link 1's label"],
    ['links[0].url', "Link 1's URL"],
    ['links[3].label', "Link 4's label"],
    ['links[9].url', "Link 10's URL"],
  ])('names a property of one link by its row and its input: %s', (key, name) => {
    expect(projectFieldName(key)).toBe(name);
  });

  it.each([
    // Not on the form, and never sent by the list -- see PROJECT_FIELD_LABELS.
    'repoFullName',
    // Not a field at all.
    'slug',
    '',
    // Indexed shapes the write request does not have.
    'links[0]',
    'links[0].colour',
    'links[x].url',
    'images[0].url',
    'tags[0].name',
    'tags[-1]',
    // Close to a mapped key, but not one: the API's keys are exact.
    'Tags',
    'title ',
    'links[0].url.extra',
    // Names that live on Object.prototype, which a plain `in` lookup would find, at the top level
    // and as a link's part.
    'constructor',
    'toString',
    '__proto__',
    'links[0].constructor',
  ])('maps nothing for %j, so the caller shows the message alone', (key) => {
    expect(projectFieldName(key)).toBeNull();
  });
});

describe('PROJECT_ROW_INPUT_LABELS', () => {
  it('labels each row input "<row> <part>", the same words the indexed names are built from', () => {
    expect(PROJECT_ROW_INPUT_LABELS).toEqual({
      linkLabel: 'Link label',
      linkUrl: 'Link URL',
      imageUrl: 'Image URL',
    });
  });
});
