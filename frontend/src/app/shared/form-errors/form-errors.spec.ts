import { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { clientErrorSignal, groupFieldErrors, joinMessages } from './form-errors';

/**
 * Two forms depend on this module's contract and neither one covers all of it: the admin form never
 * reaches the whitespace cases, the contact form has no multi-key slot, and joinMessages became
 * total in the round that made `fallback` a required argument. Both had only ever been exercised
 * through a component.
 *
 * The wording constants here are deliberately arbitrary -- each form pins its own copy in its own
 * spec. What is being pinned here is which of the two arguments comes out.
 */
const FALLBACK = 'FALLBACK-SENTINEL';

describe('joinMessages', () => {
  it('returns the one message it was given', () => {
    expect(joinMessages(['must not be blank'], FALLBACK)).toBe('must not be blank');
  });

  it('joins several, because each one is a separate violation', () => {
    // The API emits one entry per violation with no dedup, and a form with one control for a whole
    // collection has nowhere to put the second. Repetition is the only surviving trace of the count.
    expect(joinMessages(['first tag is too long', 'second tag is too long'], FALLBACK)).toBe(
      'first tag is too long; second tag is too long',
    );
    expect(joinMessages(['same', 'same'], FALLBACK)).toBe('same; same');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('falls back when the only message is %s', (_label, message) => {
    // Types say these are strings; the wire does not. Every one of these is falsy or blank once
    // rendered, so without the fallback the caller's slot claims the key and then shows nothing --
    // a rejection subtracted from a catch-all as handled and never displayed.
    expect(joinMessages([message as unknown as string], FALLBACK)).toBe(FALLBACK);
  });

  it('drops blank entries without leaking a separator', () => {
    // `[null, 'the real complaint'].join('; ')` is '; the real complaint'.
    expect(joinMessages([null as unknown as string, 'the real complaint'], FALLBACK)).toBe(
      'the real complaint',
    );
    expect(joinMessages(['the real complaint', '' as string], FALLBACK)).toBe('the real complaint');
  });

  it('falls back when every entry is blank, however many there are', () => {
    expect(joinMessages(['', '   ', null as unknown as string], FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on an empty list rather than returning null', () => {
    // The documented contract, and what makes the return type `string`: callers answer "did the
    // server name this field at all" with the lookup they already have, then ask this what to say.
    // A null here would have to be handled at three call sites that cannot reach it.
    expect(joinMessages([], FALLBACK)).toBe(FALLBACK);
  });

  it('does not treat a non-string entry as text', () => {
    // Same reasoning as the null case: this is a JSON body. `{}` would render as [object Object].
    expect(joinMessages([{} as unknown as string], FALLBACK)).toBe(FALLBACK);
    expect(joinMessages([42 as unknown as string], FALLBACK)).toBe(FALLBACK);
  });
});

describe('groupFieldErrors', () => {
  it('keeps every violation of one field, in the order the server sent them', () => {
    // The defect this function exists for: the API sends one entry per violation with no dedup, so
    // a blank-but-over-long link label arrives as @NotBlank and @Size under one key. Folding to a
    // single message per key discarded one of them before any rendering path could see it.
    expect(
      groupFieldErrors([
        { field: 'links[0].label', message: 'must not be blank' },
        { field: 'links[0].label', message: 'size must be between 0 and 50' },
      ]),
    ).toEqual({ 'links[0].label': ['must not be blank', 'size must be between 0 and 50'] });
  });

  it('keeps identical messages apart, because each one is a separate violation', () => {
    expect(groupFieldErrors([
      { field: 'tags', message: 'too long' },
      { field: 'tags', message: 'too long' },
    ])).toEqual({ tags: ['too long', 'too long'] });
  });

  it('gives each field its own list', () => {
    expect(
      groupFieldErrors([
        { field: 'title', message: 'must not be blank' },
        { field: 'links[0].url', message: 'must be a valid URL' },
        { field: 'title', message: 'size must be between 0 and 200' },
      ]),
    ).toEqual({
      title: ['must not be blank', 'size must be between 0 and 200'],
      'links[0].url': ['must be a valid URL'],
    });
  });

  it('produces an empty map for no violations', () => {
    expect(groupFieldErrors([])).toEqual({});
  });

  it('stores a field named after a prototype member as an own key', () => {
    // The keys come off the wire. `result[field] = messages` would run Object.prototype's __proto__
    // setter and swap the prototype instead of storing anything, so the rejection would disappear
    // -- and both callers look these up with Object.hasOwn/Object.keys, which would not find it.
    const grouped = groupFieldErrors([{ field: '__proto__', message: 'must not be blank' }]);

    expect(Object.hasOwn(grouped, '__proto__')).toBe(true);
    expect(Object.keys(grouped)).toEqual(['__proto__']);
    expect(grouped['__proto__']).toEqual(['must not be blank']);
    expect(Object.getPrototypeOf(grouped)).toBe(Object.prototype);
  });

  it('keeps a blank message rather than dropping it, leaving the fallback to joinMessages', () => {
    // Presence and content are separate questions: a key that arrived must stay a key, so the
    // caller's slot can claim it, and joinMessages then decides what that slot actually says.
    const grouped = groupFieldErrors([{ field: 'title', message: null as unknown as string }]);

    expect(Object.hasOwn(grouped, 'title')).toBe(true);
    expect(joinMessages(grouped['title'], FALLBACK)).toBe(FALLBACK);
  });
});

describe('clientErrorSignal', () => {
  const MESSAGES = {
    required: 'Required message',
    maxlength: 'Too long message',
  };

  /** toSignal() needs an injection context, so the factory runs inside one. */
  function slotFor(control: FormControl): Signal<string | null> {
    return TestBed.runInInjectionContext(() => clientErrorSignal(control, MESSAGES));
  }

  it('says nothing about a control nobody has reached', () => {
    const control = new FormControl('', Validators.required);

    expect(slotFor(control)()).toBeNull();
  });

  it('speaks up once the control is touched', () => {
    const control = new FormControl('', Validators.required);
    const slot = slotFor(control);

    control.markAsTouched();

    expect(slot()).toBe('Required message');
  });

  it('speaks up once the control is dirty, without being touched', () => {
    const control = new FormControl('', Validators.required);
    const slot = slotFor(control);

    control.markAsDirty();

    expect(slot()).toBe('Required message');
  });

  it('recomputes as the control changes, rather than caching its first answer', () => {
    // The reason this function exists rather than being inlined per form. Verified against
    // @angular/forms@21.2.19: `touched` returns untracked(this.touchedReactive), `dirty` is
    // !pristine which does the same, and `errors` is a plain instance field with no signal at all.
    // A computed reading only those registers no dependency and answers its first question forever.
    // Reading the signal here, before anything moves, is what makes that failure reachable: it
    // caches null, and every later assertion would see null too.
    const control = new FormControl('', [Validators.required, Validators.maxLength(3)]);
    const slot = slotFor(control);

    expect(slot()).toBeNull();

    control.markAsTouched();
    expect(slot()).toBe('Required message');

    control.setValue('abcd');
    expect(slot()).toBe('Too long message');

    control.setValue('ok');
    expect(slot()).toBeNull();
  });

  it('says nothing about a violation it has no wording for', () => {
    // A form is allowed to leave a validator unworded -- the admin form's startedOn slot has no
    // client validators at all and exists only to hold a server message. What must not happen is a
    // rendered empty string, which would light up aria-invalid with nothing to describe it.
    const control = new FormControl('nope', Validators.pattern(/^yes$/));
    const slot = slotFor(control);

    control.markAsTouched();

    expect(control.invalid).toBe(true);
    expect(slot()).toBeNull();
  });

  it('takes the first error it has wording for, in the control’s own error order', () => {
    // A hand-written validator, because the two built-ins cannot co-occur: required only fires on
    // an empty value and maxLength only on a long one, so [required, maxLength(3)] can never
    // produce both keys at once and a test using it asserts nothing about order. It read as an
    // order test and was a second copy of the one above.
    const control = new FormControl('', () => ({ required: true, maxlength: true }));
    const slot = slotFor(control);

    control.markAsTouched();

    expect(slot()).toBe('Required message');
  });

  it('skips an unworded error to reach one it can word', () => {
    // Order alone is not the rule -- it is first *worded* match. A control failing an unworded
    // validator first must still say the thing it can say, rather than falling silent at the
    // unworded key.
    const control = new FormControl('', () => ({ pattern: true, maxlength: true }));
    const slot = slotFor(control);

    control.markAsTouched();

    expect(slot()).toBe('Too long message');
  });

  it('keeps two controls independent', () => {
    // One shared events() subscription per call, not per module: an earlier draft that hoisted it
    // would have made the second control's slot answer the first control's question.
    const first = new FormControl('', Validators.required);
    const second = new FormControl('', Validators.required);
    const firstSlot = slotFor(first);
    const secondSlot = slotFor(second);

    first.markAsTouched();

    expect(firstSlot()).toBe('Required message');
    expect(secondSlot()).toBeNull();
  });

  it('is not confused by a control whose messages record is empty', () => {
    const control = new FormControl('', Validators.required);
    const slot = TestBed.runInInjectionContext(() => clientErrorSignal(control, {}));

    control.markAsTouched();

    expect(slot()).toBeNull();
  });

  // Deliberately no "an unrelated signal does not disturb it" test. It was written and then
  // removed: nothing an implementation of this function could do would make it fail, since the
  // function is never handed the other signal. It asserted a tautology and read as coverage.
});
