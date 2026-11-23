import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CompactionEvents as CE } from './helpers/shim.mjs';

const ownPending = { kind: 'compact', status: 'pending', id: 'cmpct-1', tokensBefore: 900 };
const result = { shortSummary: 'short', summary: 'long', tokensBefore: 26200 };

describe('CompactionEvents.onStart', () => {
  it('adds an external pending card carrying the current context tokens', () => {
    const msgs = [{ kind: 'user', text: 'hi' }];
    const r = CE.onStart(msgs, { id: 'ext-1', time: '10:00', contextTokens: 26200 });
    assert.equal(r.changed, true);
    assert.equal(r.messages.length, 2);
    assert.deepEqual(r.messages[1], {
      kind: 'compact', status: 'pending', external: true, id: 'ext-1', time: '10:00', tokensBefore: 26200,
    });
    assert.equal(msgs.length, 1, 'input is not mutated');
  });

  it('tokensBefore is null when usage is unknown', () => {
    const r = CE.onStart([], { id: 'ext-2', contextTokens: null });
    assert.equal(r.messages[0].tokensBefore, null);
  });

  it('is a no-op while PiDesk\'s own compact card is pending', () => {
    const msgs = [ownPending];
    const r = CE.onStart(msgs, { id: 'ext-3', contextTokens: 1 });
    assert.equal(r.changed, false);
    assert.equal(r.messages, msgs);
  });
});

describe('CompactionEvents.onEnd', () => {
  const ext = { kind: 'compact', status: 'pending', external: true, id: 'ext-1', tokensBefore: 26200 };

  it('commits: done card + completedId for the get_state back-fill', () => {
    const r = CE.onEnd([ext], { result, aborted: false });
    assert.equal(r.completedId, 'ext-1');
    assert.equal(r.messages[0].status, 'done');
    assert.equal(r.messages[0].shortSummary, 'short');
    assert.equal(r.messages[0].summary, 'long');
    assert.equal(r.messages[0].tokensBefore, 26200);
  });

  it('aborted without errorMessage uses the provided (localized) text', () => {
    const r = CE.onEnd([ext], { aborted: true }, { abortedText: '已中止' });
    assert.equal(r.completedId, null);
    assert.equal(r.messages[0].status, 'error');
    assert.equal(r.messages[0].errorReason, '已中止');
  });

  it('errorMessage wins and is shown as the reason', () => {
    const r = CE.onEnd([ext], { aborted: false, errorMessage: 'model refused' });
    assert.equal(r.messages[0].status, 'error');
    assert.equal(r.messages[0].errorReason, 'model refused');
    assert.equal(r.completedId, null);
  });

  it('skipped removes the card (nothing to compact)', () => {
    const r = CE.onEnd([{ kind: 'user' }, ext], { skipped: true, errorMessage: 'nothing to compact' });
    assert.equal(r.changed, true);
    assert.deepEqual(r.messages, [{ kind: 'user' }]);
    assert.equal(r.completedId, null);
  });

  it('never touches PiDesk\'s own pending card (the RPC response owns it)', () => {
    const msgs = [ownPending];
    const r = CE.onEnd(msgs, { result, aborted: false });
    assert.equal(r.changed, false);
    assert.equal(r.messages, msgs);
    assert.equal(r.completedId, null);
  });

  it('ignores an end with no pending external card', () => {
    const done = { ...ext, status: 'done' };
    assert.equal(CE.onEnd([done], { result }).changed, false);
    assert.equal(CE.onEnd(undefined, { result }).changed, false);
  });
});
