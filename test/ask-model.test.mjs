import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const M = require('../src/app/ask-model.js');
const dir = dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(readFileSync(join(dir, 'fixtures', n), 'utf-8')).scenarios;
const F18 = load('ask-frames-18.json');
const F19 = load('ask-frames-19.json');

const askCard = (extra = {}) => ({ kind: 'tool', tool: 'ask', status: 'running', _toolCallId: 'tc1', ...extra });
const other = { kind: 'assistant' };

describe('AskModel.findOtherRow', () => {
  it('finds the row, tolerating the \\r runtime variant and a disambiguation suffix', () => {
    assert.equal(M.findOtherRow(['A', 'Other (type your own)']), 'Other (type your own)');
    assert.equal(M.findOtherRow(['A', 'Other\r(type your own)']), 'Other\r(type your own)');
    assert.equal(M.findOtherRow(['A', 'Other (type your own) (2)']), 'Other (type your own) (2)');
  });
  it('returns null when absent', () => {
    assert.equal(M.findOtherRow(['A', 'B']), null);
    assert.equal(M.findOtherRow(undefined), null);
  });
});

describe('AskModel.normalizeTitle', () => {
  it('strips a leading "(N selected) " prefix (18.x)', () => {
    assert.equal(M.normalizeTitle('(2 selected) Pick features'), 'Pick features');
  });
  it('strips the prefix after the last blank line when form context precedes it (19.x)', () => {
    assert.equal(M.normalizeTitle('ctx line\n\n(1 selected) Pick features'), 'ctx line\n\nPick features');
  });
  it('round 1 and round 2 of a contextual 19.x title normalize equal', () => {
    assert.equal(
      M.normalizeTitle(F19.multiRounds.round1.title),
      M.normalizeTitle(F19.multiRounds.round2.title),
    );
  });
  it('strips an 18.x (i/n) progress suffix', () => {
    assert.equal(M.normalizeTitle('Which framework? (1/3)'), 'Which framework?');
  });
  it('leaves an ordinary title untouched', () => {
    assert.equal(M.normalizeTitle('Which framework?'), 'Which framework?');
  });
});

describe('AskModel.parseSelect', () => {
  it('18.x single select: otherRow split off, not multi, no authoritative checked', () => {
    const p = M.parseSelect(F18.singleSelect.frames[0]);
    assert.deepEqual(p.options, ['React', 'Vue']);
    assert.equal(p.otherRow, 'Other (type your own)');
    assert.equal(p.doneRow, null);
    assert.equal(p.multi, false);
    assert.equal(p.checkedAuthoritative, false);
  });
  it('18.x multi round 2: doneRow detected by text, multi true, otherRow last', () => {
    const p = M.parseSelect(F18.multiRounds.round2);
    assert.deepEqual(p.options, ['Auth', 'Billing', 'Search']);
    assert.equal(p.doneRow, '\uf00c Done selecting', 'live 18.4.3 glyph is the nerd-font check U+F00C');
    assert.equal(p.otherRow, 'Other (type your own)');
    assert.equal(p.multi, true);
    assert.equal(p.checkedAuthoritative, false);
  });
  it('19.x multi: checkedIndices resolved against RAW options (row order [opts, other, done])', () => {
    const p = M.parseSelect(F19.multiRounds.round2);
    assert.deepEqual(p.checked, ['Auth']);
    assert.equal(p.otherChecked, false);
    assert.equal(p.doneRow, '✔ Done selecting');
    assert.equal(p.checkedAuthoritative, true);
  });
  it('19.x multi: otherRow index in checkedIndices sets otherChecked and is not an option', () => {
    const p = M.parseSelect(F19.multiRounds.round3Other);
    assert.deepEqual(p.checked, ['Auth']);
    assert.equal(p.otherChecked, true);
    assert.deepEqual(p.options, ['Auth', 'Billing', 'Search']);
  });
  it('19.x round 1: checkbox marker makes it multi even with no doneRow', () => {
    const p = M.parseSelect(F19.multiRounds.round1);
    assert.equal(p.multi, true);
    assert.equal(p.doneRow, null);
    assert.deepEqual(p.checked, []);
    assert.equal(p.checkedAuthoritative, true);
  });
  it('19.x select without otherRow reports otherRow null', () => {
    assert.equal(M.parseSelect(F19.singleSelectNoOther.frames[0]).otherRow, null);
  });
  it('ignores indices at/after markableCount and out of range', () => {
    const p = M.parseSelect({
      options: ['A', 'B', 'Done selecting'], selectionMarker: 'checkbox',
      checkedIndices: [0, 2, 9, -1], markableCount: 2,
    });
    assert.deepEqual(p.checked, ['A']);
  });

  describe('multi without a Done row (18.x multi-question ask, real idea capture)', () => {
    const OTHER = 'Other (type your own)';
    const opts = ['定时关闭', '音量渐弱', OTHER];
    it('a "(N selected)" title decoration proves a multi-select', () => {
      const p = M.parseSelect({ title: '(1 selected) 哪些功能？ (4/5)', options: opts });
      assert.equal(p.multi, true);
      assert.equal(p.doneRow, null);
    });
    it('also after the form context of a 19.x title; never for a radio list or a plain title', () => {
      assert.equal(M.parseSelect({ title: 'ctx\n\n(2 selected) Q', options: opts }).multi, true);
      assert.equal(M.parseSelect({ title: '(1 selected) Q', options: opts, selectionMarker: 'radio' }).multi, false);
      assert.equal(M.parseSelect({ title: 'Which (1 selected) thing?', options: opts }).multi, false);
      assert.equal(M.parseSelect({ title: 'Q (4/5)', options: opts }).multi, false);
    });
    it('round 2 upgrades the bubble, seeds the first click, and round 3 (0 selected) stays multi', () => {
      const r1 = { ...M.buildFromSelect({ id: 'a', title: 'Q (4/5)', options: opts }, 't'), state: 'answered', answered: true, answer: '定时关闭' };
      const r2 = M.addBubble([r1], M.buildFromSelect({ id: 'b', title: '(1 selected) Q (4/5)', options: opts }, 't')).messages[0];
      assert.equal(r2.multi, true);
      assert.deepEqual(r2.checked, ['定时关闭']);
      const toggledOff = { ...r2, state: 'pending', checked: [], answer: '定时关闭' };
      const r3 = M.addBubble([toggledOff], M.buildFromSelect({ id: 'c', title: 'Q (4/5)', options: opts }, 't')).messages[0];
      assert.equal(r3.multi, true);
      assert.deepEqual(r3.checked, []);
    });
  });

  describe('Done row detection is anchored and layout-aware', () => {
    const OTHER = 'Other (type your own)';
    it('an ordinary option that merely contains the words stays an option', () => {
      const p = M.parseSelect({ options: ['I am Done selecting things', 'B', OTHER] });
      assert.equal(p.doneRow, null);
      assert.deepEqual(p.options, ['I am Done selecting things', 'B']);
      assert.equal(p.multi, false);
    });
    it('accepts every omp glyph: nerd-font U+F00C, ✔, [ok], none, and the (N) disambiguation suffix', () => {
      for (const label of ['\uf00c Done selecting', '✔ Done selecting', '[ok] Done selecting', 'Done selecting', '\uf00c Done selecting (2)']) {
        const p = M.parseSelect({ options: ['A', 'B', label, OTHER] });
        assert.equal(p.doneRow, label, `done row ${JSON.stringify(label)}`);
        assert.deepEqual(p.options, ['A', 'B']);
        assert.equal(p.multi, true);
      }
    });
    it('radio marker: a lookalike row is a plain option and the select is single', () => {
      const p = M.parseSelect({ options: ['A', 'Done selecting', OTHER], selectionMarker: 'radio' });
      assert.equal(p.doneRow, null);
      assert.deepEqual(p.options, ['A', 'Done selecting']);
      assert.equal(p.multi, false);
    });
    it('markableCount: only rows after the markable region can be the Done row', () => {
      const p = M.parseSelect({
        options: ['Done selecting', 'B', OTHER, '\uf00c Done selecting'],
        selectionMarker: 'checkbox', markableCount: 3, checkedIndices: [0],
      });
      assert.equal(p.doneRow, '\uf00c Done selecting');
      assert.deepEqual(p.options, ['Done selecting', 'B']);
      assert.deepEqual(p.checked, ['Done selecting']);
    });
    it('markableCount covering every row means there is no Done row', () => {
      const p = M.parseSelect({ options: ['A', 'Done selecting', OTHER], selectionMarker: 'checkbox', markableCount: 3 });
      assert.equal(p.doneRow, null);
      assert.deepEqual(p.options, ['A', 'Done selecting']);
    });
    it('without markableCount the LAST matching row wins (18.x row order)', () => {
      const p = M.parseSelect({ options: ['Done selecting', 'A', '\uf00c Done selecting', OTHER] });
      assert.equal(p.doneRow, '\uf00c Done selecting');
      assert.deepEqual(p.options, ['Done selecting', 'A']);
    });
    it('the Other row is searched in the markable region only (19.x)', () => {
      const p = M.parseSelect({
        options: ['A', OTHER, '\uf00c Done selecting'], selectionMarker: 'checkbox', markableCount: 2,
      });
      assert.equal(p.otherRow, OTHER);
      assert.equal(p.doneRow, '\uf00c Done selecting');
    });
  });
});

describe('AskModel builders', () => {
  it('buildFromSelect produces an open orphan select bubble', () => {
    const b = M.buildFromSelect(F19.singleSelect.frames[0], '10:00');
    assert.equal(b.kind, 'ask');
    assert.equal(b.mode, 'select');
    assert.equal(b.state, 'open');
    assert.equal(b.orphan, true);
    assert.equal(b.id, '19-s1');
  });
  it('buildFromInput carries secret + placeholder', () => {
    const b = M.buildFromInput(F19.text.secret, 't');
    assert.equal(b.mode, 'input');
    assert.equal(b.secret, true);
    assert.equal(M.buildFromInput(F19.text.input, 't').placeholder, 'my-app');
  });
  it('buildFromEditor carries prefill/promptStyle; textInputKind picks line vs area', () => {
    const area = M.buildFromEditor(F19.text.editorMultiline, 't');
    assert.equal(area.prefill, 'line1\nline2');
    assert.equal(M.textInputKind(area), 'area');
    assert.equal(M.textInputKind(M.buildFromEditor(F19.text.editorPromptStyle, 't')), 'line');
    assert.equal(M.textInputKind(M.buildFromInput(F19.text.input, 't')), 'line');
  });
});

describe('AskModel.addBubble — multi-round merging', () => {
  const answerIt = (b, extra = {}) => ({ ...b, state: 'answered', answered: true, answer: 'Auth', ...extra });

  it('same normalized title after an answered round reopens the bubble in place (19.x, context title)', () => {
    const r1 = M.buildFromSelect(F19.multiRounds.round1, 't');
    const first = M.addBubble([], r1).messages;
    const pending = [{ ...first[0], state: 'pending', checked: ['Auth'] }];
    const out = M.addBubble(pending, M.buildFromSelect(F19.multiRounds.round2, 't'));
    assert.equal(out.merged, true);
    assert.equal(out.messages.length, 1);
    const m = out.messages[0];
    assert.equal(m.id, '19-m2');
    assert.equal(m.state, 'open');
    assert.deepEqual(m.checked, ['Auth']);
    assert.equal(m.doneRow, '✔ Done selecting');
    assert.equal(m.round, 1);
  });

  it('different title appends a new bubble (next question of a form)', () => {
    const r1 = answerIt(M.buildFromSelect(F19.multiRounds.round1, 't'));
    const next = M.buildFromSelect({ ...F19.singleSelect.frames[0], title: 'Another question' }, 't');
    const out = M.addBubble([r1], next);
    assert.equal(out.merged, false);
    assert.equal(out.messages.length, 2);
  });

  it('does not merge into an open (unanswered) bubble', () => {
    const r1 = M.buildFromSelect(F19.multiRounds.round1, 't');
    const out = M.addBubble([r1], M.buildFromSelect(F19.multiRounds.round2, 't'));
    assert.equal(out.merged, false);
  });

  it('does not merge into a closed bubble of an earlier ask call', () => {
    const r1 = { ...answerIt(M.buildFromSelect(F19.multiRounds.round1, 't')), closed: true };
    const out = M.addBubble([r1], M.buildFromSelect(F19.multiRounds.round1, 't'));
    assert.equal(out.merged, false);
  });

  it('input/editor never merge, even with an identical title (validation re-ask appends)', () => {
    const a = { ...M.buildFromInput(F19.text.input, 't'), state: 'answered', answered: true };
    const out = M.addBubble([a], M.buildFromInput({ ...F19.text.input, id: 'x2' }, 't'));
    assert.equal(out.merged, false);
    assert.equal(out.messages.length, 2);
  });

  it('18.x: first click was recorded as a single answer; round 2 seeds it into checked', () => {
    const r1 = M.buildFromSelect(F18.multiRounds.round1, 't');
    assert.equal(r1.multi, false);
    const clicked = { ...r1, state: 'answered', answered: true, answer: 'Auth' };
    const out = M.addBubble([clicked], M.buildFromSelect(F18.multiRounds.round2, 't'));
    assert.equal(out.merged, true);
    const m = out.messages[0];
    assert.equal(m.multi, true);
    assert.deepEqual(m.checked, ['Auth']);
    assert.equal(m.checkedAuthoritative, false);
  });

  it('18.x: later rounds keep the locally toggled set (no re-seed once multi)', () => {
    const r2 = { ...M.buildFromSelect(F18.multiRounds.round2, 't'), state: 'pending', checked: ['Auth', 'Search'], answer: 'Search' };
    const out = M.addBubble([r2], M.buildFromSelect(F18.multiRounds.round3, 't'));
    assert.deepEqual(out.messages[0].checked, ['Auth', 'Search']);
  });

  it('18.x blank-Other retry: seed skips otherRow answers', () => {
    const r1 = { ...M.buildFromSelect(F18.singleSelect.frames[0], 't'), state: 'answered', answered: true, answer: 'Other (type your own)' };
    const again = M.buildFromSelect({ ...F18.singleSelect.frames[0], id: 'again' }, 't');
    const m = M.addBubble([r1], again).messages[0];
    assert.deepEqual(m.checked, []);
  });

  it('18.x: seeding needs a real option click — custom text spelled like an option or no longer offered is not a toggle', () => {
    const r1 = M.buildFromSelect(F18.multiRounds.round1, 't');
    const typedLikeOption = { ...r1, state: 'answered', answered: true, answer: 'Auth', otherText: 'Auth' };
    assert.deepEqual(M.addBubble([typedLikeOption], M.buildFromSelect(F18.multiRounds.round2, 't')).messages[0].checked, []);
    const notOffered = { ...r1, state: 'answered', answered: true, answer: 'Gone', otherText: null };
    assert.deepEqual(M.addBubble([notOffered], M.buildFromSelect(F18.multiRounds.round2, 't')).messages[0].checked, []);
  });

  it('19.x: server checkedIndices override local state and expose otherChecked', () => {
    const base = { ...M.buildFromSelect(F19.multiRounds.round2, 't'), state: 'pending', checked: ['Auth', 'Billing'], otherText: 'foo' };
    const m = M.addBubble([base], M.buildFromSelect(F19.multiRounds.round3Other, 't')).messages[0];
    assert.deepEqual(m.checked, ['Auth']);
    assert.equal(m.otherChecked, true);
    assert.equal(m.otherText, 'foo');
  });

  it('19.x: clearing Other drops otherText when the next frame reports it unchecked', () => {
    const base = { ...M.buildFromSelect(F19.multiRounds.round3Other, 't'), state: 'pending', otherText: null };
    const m = M.addBubble([base], M.buildFromSelect(F19.multiRounds.round4Cleared, 't')).messages[0];
    assert.equal(m.otherChecked, false);
    assert.equal(m.otherText, null);
  });
});

describe('AskModel.hoistToolCard', () => {
  const bubble = (id) => ({ kind: 'ask', id, orphan: true });

  it('moves an ask card in front of trailing orphan bubbles (select arrived first)', () => {
    const msgs = [other, bubble('a'), askCard()];
    const { messages, changed } = M.hoistToolCard(msgs, 2);
    assert.equal(changed, true);
    assert.deepEqual(messages.map(m => m.kind), ['assistant', 'tool', 'ask']);
    assert.equal(messages[2].orphan, false);
  });

  it('is a no-op when the card is already first (select arrived after tool start)', () => {
    const msgs = [other, askCard()];
    const { messages, changed } = M.hoistToolCard(msgs, 1);
    assert.equal(changed, false);
    assert.equal(messages, msgs);
  });

  it('only acts for ask cards — other tools never claim an orphan bubble', () => {
    const msgs = [bubble('a'), askCard({ tool: 'bash' })];
    const { messages, changed } = M.hoistToolCard(msgs, 1);
    assert.equal(changed, false);
    assert.equal(messages[0].orphan, true);
  });

  it('does not touch non-orphan (claimed) bubbles', () => {
    const msgs = [{ kind: 'ask', id: 'old', orphan: false }, bubble('new'), askCard()];
    const { messages } = M.hoistToolCard(msgs, 2);
    assert.deepEqual(messages.map(m => m.kind), ['ask', 'tool', 'ask']);
    assert.equal(messages[0].id, 'old');
    assert.equal(messages[2].id, 'new');
  });

  it('select-first and select-after orderings both end as [card, bubble]', () => {
    const first = M.hoistToolCard([bubble('a'), askCard()], 1).messages.map(m => m.kind);
    const after = M.hoistToolCard([askCard(), { kind: 'ask', id: 'a', orphan: false }], 0).messages.map(m => m.kind);
    assert.deepEqual(first, after);
  });
});

describe('AskModel.hasRunningAskCard', () => {
  it('detects a running ask card only', () => {
    assert.equal(M.hasRunningAskCard([askCard()]), true);
    assert.equal(M.hasRunningAskCard([askCard({ status: 'ok' })]), false);
    assert.equal(M.hasRunningAskCard([askCard({ tool: 'bash' })]), false);
  });
});

describe('AskModel lifecycle helpers', () => {
  const open = () => M.buildFromSelect(F19.singleSelect.frames[0], 't');

  it('patchOpen/findOpen only touch an open bubble with that id', () => {
    const b = open();
    assert.equal(M.findOpen([b], '19-s1'), b);
    assert.equal(M.findOpen([b], 'nope'), null);
    const patched = M.patchOpen([b], '19-s1', { state: 'answered' });
    assert.equal(patched[0].state, 'answered');
    assert.equal(M.findOpen(patched, '19-s1'), null);
    assert.equal(M.patchOpen(patched, '19-s1', { state: 'x' }), patched);
  });

  it('cancelById cancels live bubbles by current id only', () => {
    const b = open();
    assert.equal(M.cancelById([b], '19-s1')[0].state, 'cancelled');
    const msgs = [b];
    assert.equal(M.cancelById(msgs, 'old-id'), msgs);
  });

  it('finalize: open → cancelled, pending → answered, answered stays, all closed', () => {
    const o = open();
    const p = { ...open(), id: 'p', state: 'pending' };
    const a = { ...open(), id: 'a', state: 'answered', answered: true };
    const out = M.finalize([o, p, a]);
    assert.deepEqual(out.map(m => m.state), ['cancelled', 'answered', 'answered']);
    assert.equal(out[0].cancelled, true);
    assert.ok(out.every(m => m.closed));
  });

  it('finalize({aborted:true}): open AND pending both become cancelled (never "answered")', () => {
    const o = open();
    const p = { ...open(), id: 'p', state: 'pending' };
    const a = { ...open(), id: 'a', state: 'answered', answered: true };
    const out = M.finalize([o, p, a], { aborted: true });
    assert.deepEqual(out.map(m => m.state), ['cancelled', 'cancelled', 'answered']);
    assert.deepEqual(out.map(m => m.cancelled), [true, true, false]);
    assert.equal(out[1].answered, false);
    assert.ok(out.every(m => m.closed));
  });

  it('finalize({aborted:false}) is the default behaviour', () => {
    const p = { ...open(), id: 'p', state: 'pending' };
    assert.equal(M.finalize([p], { aborted: false })[0].state, 'answered');
    assert.equal(M.finalize([p])[0].state, 'answered');
  });

  it('finalize returns the same array when nothing is live', () => {
    const msgs = [other, { ...open(), closed: true }];
    assert.equal(M.finalize(msgs), msgs);
  });

  it('bubbleState tolerates legacy bubbles without state', () => {
    assert.equal(M.bubbleState({ answered: true }), 'answered');
    assert.equal(M.bubbleState({ cancelled: true }), 'cancelled');
    assert.equal(M.bubbleState({}), 'open');
  });
});
