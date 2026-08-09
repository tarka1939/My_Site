import { projectImageAlt } from './project-image-alt';

describe('projectImageAlt', () => {
  it('names the project and the position within the gallery', () => {
    expect(projectImageAlt('System Equalizer', 0, 2)).toBe('System Equalizer, image 1 of 2');
    expect(projectImageAlt('System Equalizer', 1, 2)).toBe('System Equalizer, image 2 of 2');
  });

  it('claims nothing about what an image contains or what type it is', () => {
    // The regression this guards, issue #87: alt text was built as "<title> screenshot <n>", which
    // is a false statement for the two architecture diagrams on the drafted System Equalizer entry.
    // Nothing reachable from the frontend knows an image's type, so nothing may assert one.
    for (const alt of [0, 1].map((i) => projectImageAlt('System Equalizer', i, 2))) {
      expect(alt).not.toMatch(/screenshot|diagram|photo|logo|chart/i);
    }
  });

  it('names a single image with just the title, adding no role word', () => {
    // With one image there is no position to give, and "image" on its own is the "image of"
    // prefix WAI's alt decision tree rules out -- a screen reader announces the role already, so
    // "Animal Vision, image" comes out as "Animal Vision, image, graphic".
    expect(projectImageAlt('Animal Vision', 0, 1)).toBe('Animal Vision');
    expect(projectImageAlt('Animal Vision', 0, 1)).not.toMatch(/\bimage\b/);
  });

  it('falls back to the bare position when a title is missing or blank', () => {
    // Unreachable via the contract (`title` is required, minLength 1) -- handled so a blank one
    // cannot produce a leading comma in the alt text.
    expect(projectImageAlt('   ', 0, 3)).toBe('image 1 of 3');
    expect(projectImageAlt('', 0, 1)).toBe('image');
  });

  it('trims a padded title rather than embedding the padding in the alt text', () => {
    expect(projectImageAlt('  Counter App  ', 2, 3)).toBe('Counter App, image 3 of 3');
  });
});
