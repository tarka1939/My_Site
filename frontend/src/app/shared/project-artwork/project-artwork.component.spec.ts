import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CanvasMode, CanvasRecording, recordCanvas } from '../../../testing/canvas';
import { ProjectArtworkComponent } from './project-artwork.component';

/**
 * What is asserted here is the *contract*, not the picture: that the drawing is a pure function of
 * the project, that it is unaffected by the one thing about a project that genuinely varies
 * between requests (tag order), and that the no-canvas path leaves a plain surface rather than a
 * hole. Whether the result looks like a frequency response is not something a test can see -- see
 * CLAUDE.md, "A test cannot see appearance".
 */
describe('ProjectArtworkComponent', () => {
  let canvas: CanvasRecording;

  afterEach(() => canvas?.restore());

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectArtworkComponent],
    }).compileComponents();
  });

  /**
   * Required inputs have to be set before the first change detection, so this cannot use
   * `renderComponent` from testing/zoneless.ts. It keeps that file's convention where it matters:
   * the paint is a *reaction* to the view existing, so it is awaited rather than forced.
   */
  async function render(
    title: string,
    tags: { name: string }[] = [],
  ): Promise<ComponentFixture<ProjectArtworkComponent>> {
    const fixture = TestBed.createComponent(ProjectArtworkComponent);
    fixture.componentRef.setInput('projectTitle', title);
    fixture.componentRef.setInput('tags', tags);
    await fixture.whenStable();
    return fixture;
  }

  function opsOf(fixture: ComponentFixture<ProjectArtworkComponent>): readonly string[] {
    return canvas.opsFor((fixture.nativeElement as HTMLElement).querySelector('canvas')!);
  }

  function host(fixture: ComponentFixture<ProjectArtworkComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  describe('with a canvas available', () => {
    beforeEach(() => (canvas = recordCanvas()));

    it('draws on a 2D context once the canvas is in the DOM', async () => {
      const fixture = await render('Equalizer', [{ name: 'dsp' }]);

      expect(canvas.requests.map((request) => request.contextId)).toEqual(['2d']);
      expect(opsOf(fixture).length).toBeGreaterThan(0);
      expect(host(fixture).getAttribute('data-artwork')).toBe('painted');
    });

    it('draws the same artwork for the same project every time', async () => {
      // Two independent renders, not one render read twice: "deterministic" is a claim about
      // repeated construction, and a memoised computed would satisfy the weaker version of it.
      const first = await render('Equalizer', [{ name: 'dsp' }, { name: 'cpp' }]);
      const second = await render('Equalizer', [{ name: 'dsp' }, { name: 'cpp' }]);

      expect(opsOf(second)).toEqual(opsOf(first));
      expect(opsOf(first).length).toBeGreaterThan(0);
    });

    it('draws the same artwork whatever order the tags arrive in', async () => {
      // Not a hypothetical: the backend holds tags in a HashSet handed to Set.copyOf, whose
      // iteration order is randomised per JVM run -- e2e/tests/projects.spec.ts refuses to assert
      // tag order for that reason. Seeding on arrival order would repaint every card after a
      // backend restart, which is precisely what "stable across reloads" rules out.
      const forwards = await render('Equalizer', [{ name: 'dsp' }, { name: 'cpp' }]);
      const backwards = await render('Equalizer', [{ name: 'cpp' }, { name: 'dsp' }]);

      expect(opsOf(backwards)).toEqual(opsOf(forwards));
    });

    it('draws different artwork for a different project', async () => {
      const equalizer = await render('Equalizer', [{ name: 'dsp' }]);
      const reverb = await render('Reverb', [{ name: 'dsp' }]);

      expect(opsOf(reverb)).not.toEqual(opsOf(equalizer));
    });

    it('draws different artwork for the same title under different tags', async () => {
      const dsp = await render('Equalizer', [{ name: 'dsp' }]);
      const colour = await render('Equalizer', [{ name: 'colour-science' }]);

      expect(opsOf(colour)).not.toEqual(opsOf(dsp));
    });

    it('repaints when the project it is drawing changes', async () => {
      // A card is tracked by project id, so this instance survives an edit to the title it is
      // drawing from. Without a render *effect* -- a one-shot afterNextRender, say -- it would go
      // on showing the old project's picture until a full reload.
      const fixture = await render('Equalizer', [{ name: 'dsp' }]);
      const before = [...opsOf(fixture)];
      expect(canvas.requests.length).toBe(1);

      fixture.componentRef.setInput('projectTitle', 'Equalizer II');
      await fixture.whenStable();

      // A second paint, of a different picture. `opsFor` reports the latest paint rather than a
      // running total -- each paint takes a fresh context -- so this is the whole drawing, not a
      // tail of it.
      expect(canvas.requests.length).toBe(2);
      expect(opsOf(fixture)).not.toEqual(before);
      expect(opsOf(fixture).length).toBeGreaterThan(0);
    });

    it('keeps the artwork out of the accessibility tree', async () => {
      const fixture = await render('Equalizer', [{ name: 'dsp' }]);

      expect(host(fixture).getAttribute('aria-hidden')).toBe('true');
      // Nothing textual to leak into a surrounding link's accessible name either: `textContent`
      // concatenates hidden siblings, so an empty one is the check that matches how names are
      // actually computed.
      expect(host(fixture).textContent).toBe('');
    });
  });

  describe.each<CanvasMode>(['null', 'throw'])('with no canvas (getContext %s)', (mode) => {
    beforeEach(() => (canvas = recordCanvas(mode)));

    it('leaves the slot as a plain surface instead of failing', async () => {
      const fixture = await render('Equalizer', [{ name: 'dsp' }]);

      expect(canvas.requests.length).toBe(1);
      expect(opsOf(fixture)).toEqual([]);
      // Still an element, still sized by the slot, still nothing announced -- just unpainted, so
      // what shows through is the card's own plate rather than a gap in the grid.
      expect(host(fixture).querySelector('canvas')).not.toBeNull();
      expect(host(fixture).getAttribute('data-artwork')).toBe('plain');
      expect(host(fixture).getAttribute('aria-hidden')).toBe('true');
    });
  });
});
