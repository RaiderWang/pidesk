import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const M = require('../src/app/ask-model.js');
const A = require('../src/app/ask-answer.js');
const dir = dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(readFileSync(join(dir, 'fixtures', n), 'utf-8')).scenarios;
const F18 = load('ask-frames-18.json');
const F19 = load('ask-frames-19.json');

const OTHER = 'Other (type your own)';
const sel = (ev) => M.buildFromSelect(ev, 't');

describe('AskAnswer.planAnswer — single select', () => {
  it('a listed option sends the value and marks the bubble answered', () => {
    const r = A.planAnswer(sel(F19.singleSelect.frames[0]), { value: 'Vue' });
    assert.deepEqual(r.frames, [{ value: 'Vue' }]);
    assert.equal(r.patch.state, 'answered');
    assert.equal(r.patch.answer, 'Vue');
    assert.equal(r.handshake, null);
  });

  it('refuses a value the server never offered (would abort the turn on 19.x)', () => {
    assert.equal(A.planAnswer(sel(F19.singleSelect.frames[0]), { value: 'Svelte' }), null);
  });

  it('refuses the raw otherRow as a plain value', () => {
    assert.equal(A.planAnswer(sel(F19.singleSelect.frames[0]), { value: OTHER }), null);
  });

  it('free text: sends otherRow first and arms the handshake with the typed text', () => {
    const b = sel(F19.singleOther.frames[0]);
    const r = A.planAnswer(b, { custom: '  Svelte ' });
    assert.deepEqual(r.frames, [{ value: OTHER }]);
    assert.deepEqual(r.handshake, { askId: b.id, text: 'Svelte' });
    assert.equal(r.patch.answer, 'Svelte');
    assert.equal(r.patch.state, 'answered');
  });

  it('free text is refused when the frame has no otherRow', () => {
    assert.equal(A.planAnswer(sel(F19.singleSelectNoOther.frames[0]), { custom: 'x' }), null);
  });

  it('blank free text is refused', () => {
    assert.equal(A.planAnswer(sel(F19.singleSelect.frames[0]), { custom: '   ' }), null);
  });

  it('only an open bubble can be answered (double click guard)', () => {
    const b = { ...sel(F19.singleSelect.frames[0]), state: 'pending' };
    assert.equal(A.planAnswer(b, { value: 'Vue' }), null);
    assert.equal(A.planAnswer({ ...b, state: 'answered' }, { value: 'Vue' }), null);
    assert.equal(A.planAnswer({ ...b, state: 'cancelled' }, { value: 'Vue' }), null);
  });
});

describe('AskAnswer.resolveHandshake', () => {
  const hs = { askId: 'x', text: 'Svelte' };
  it('answers 18.x editor follow-up', () => {
    assert.deepEqual(A.resolveHandshake(hs, F18.singleOther.frames[1]), { value: 'Svelte' });
  });
  it('answers 19.x input follow-up', () => {
    assert.deepEqual(A.resolveHandshake(hs, F19.singleOther.frames[1]), { value: 'Svelte' });
  });
  it('ignores select/other methods and a missing handshake', () => {
    assert.equal(A.resolveHandshake(hs, F19.singleSelect.frames[0]), null);
    assert.equal(A.resolveHandshake(null, F19.singleOther.frames[1]), null);
    assert.equal(A.resolveHandshake(hs, { method: 'confirm' }), null);
  });
});

describe('AskAnswer.planAnswer — multi select', () => {
  const round2 = () => sel(F19.multiRounds.round2); // checked: Auth, doneRow present

  it('each click is its own response, locks the bubble (pending) and toggles optimistically', () => {
    const r = A.planAnswer(round2(), { value: 'Billing' });
    assert.deepEqual(r.frames, [{ value: 'Billing' }]);
    assert.equal(r.patch.state, 'pending');
    assert.deepEqual(r.patch.checked, ['Auth', 'Billing']);
    assert.equal(r.patch.answered, undefined);
  });

  it('clicking a checked option unchecks it', () => {
    const r = A.planAnswer(round2(), { value: 'Auth' });
    assert.deepEqual(r.patch.checked, []);
  });

  it('after a click the bubble is pending, so a second click is refused', () => {
    const b = round2();
    const r = A.planAnswer(b, { value: 'Billing' });
    assert.equal(A.planAnswer({ ...b, ...r.patch }, { value: 'Search' }), null);
  });

  it('Done sends the ORIGINAL doneRow string and finishes the bubble, keeping checked', () => {
    const b = round2();
    const r = A.planAnswer(b, { value: b.doneRow });
    assert.deepEqual(r.frames, [{ value: '✔ Done selecting' }]);
    assert.equal(r.patch.state, 'answered');
    assert.equal(r.patch.checked, undefined);
  });

  it('Done is refused when the frame has no doneRow (19.x required + nothing checked)', () => {
    const b = sel(F19.multiRequiredEmpty.frames[0]);
    assert.equal(A.planAnswer(b, { value: 'Done selecting' }), null);
  });

  it('18.x multi round 2 toggles locally (no checkedIndices from server)', () => {
    const b = { ...sel(F18.multiRounds.round2), checked: ['Auth'] };
    const r = A.planAnswer(b, { value: 'Search' });
    assert.deepEqual(r.patch.checked, ['Auth', 'Search']);
  });

  it('custom text uses the two-step handshake and marks otherChecked optimistically', () => {
    const b = round2();
    const r = A.planAnswer(b, { custom: 'foo' });
    assert.deepEqual(r.frames, [{ value: OTHER }]);
    assert.deepEqual(r.handshake, { askId: b.id, text: 'foo' });
    assert.equal(r.patch.state, 'pending');
    assert.equal(r.patch.otherChecked, true);
    assert.equal(r.patch.otherText, 'foo');
  });

  it('clearOther sends only otherRow and sets NO handshake (server unchecks without an input)', () => {
    const b = sel(F19.multiRounds.round3Other);
    const r = A.planAnswer(b, { clearOther: true });
    assert.deepEqual(r.frames, [{ value: OTHER }]);
    assert.equal(r.handshake, null);
    assert.equal(r.patch.otherChecked, false);
    assert.equal(r.patch.otherText, null);
  });

  it('clearOther is refused unless Other is currently checked', () => {
    assert.equal(A.planAnswer(round2(), { clearOther: true }), null);
  });

  it('handshake-leak regression: re-submitting Other while checked must not be expressible as custom text', () => {
    // UI shows chip+clear when otherChecked; clearOther yields no handshake, so a later
    // `input` for the NEXT form field can never be auto-answered with stale text.
    const b = sel(F19.multiRounds.round3Other);
    const r = A.planAnswer(b, { clearOther: true });
    assert.equal(A.resolveHandshake(r.handshake, F19.text.input), null);
    // …and the path that WOULD leak is closed: a repeated otherRow while checked only unchecks
    // it server-side (no input request), so a custom text there would linger as a stale handshake.
    assert.equal(b.otherChecked, true);
    assert.equal(A.planAnswer(b, { custom: 'bar' }), null);
  });
});

describe('AskAnswer.planAnswer — input / editor', () => {
  it('sends the typed text; empty string is allowed (skip optional field)', () => {
    const b = M.buildFromInput(F19.text.input, 't');
    assert.deepEqual(A.planAnswer(b, { text: 'proj' }).frames, [{ value: 'proj' }]);
    const empty = A.planAnswer(b, { text: '' });
    assert.deepEqual(empty.frames, [{ value: '' }]);
    assert.equal(empty.patch.state, 'answered');
  });

  it('secret answers are not echoed into the bubble', () => {
    const b = M.buildFromInput(F19.text.secret, 't');
    const r = A.planAnswer(b, { text: 's3cret' });
    assert.deepEqual(r.frames, [{ value: 's3cret' }]);
    assert.equal(r.patch.answer, null);
    assert.equal(r.patch.answerMasked, true);
  });

  it('editor keeps multi-line text verbatim', () => {
    const b = M.buildFromEditor(F19.text.editorMultiline, 't');
    assert.deepEqual(A.planAnswer(b, { text: 'a\nb' }).frames, [{ value: 'a\nb' }]);
  });

  it('cancel sends { cancelled: true } and cancels the bubble', () => {
    const b = M.buildFromEditor(F19.text.editorMultiline, 't');
    const r = A.planAnswer(b, { cancelled: true });
    assert.deepEqual(r.frames, [{ cancelled: true }]);
    assert.equal(r.patch.state, 'cancelled');
  });

  it('select payloads are ignored for text bubbles and vice versa', () => {
    const t = M.buildFromInput(F19.text.input, 't');
    assert.equal(A.planAnswer(t, { value: 'x' }), null);
    assert.equal(A.planAnswer(sel(F19.singleSelect.frames[0]), { text: 'x' }), null);
  });

  it('returns null for missing bubble/payload', () => {
    assert.equal(A.planAnswer(null, { value: 'x' }), null);
    assert.equal(A.planAnswer(sel(F19.singleSelect.frames[0]), null), null);
  });
});
