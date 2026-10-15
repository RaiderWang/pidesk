import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/shim.mjs';

const require = createRequire(import.meta.url);
const MessageMerge = require('../src/app/message-merge.js');

const u = (text, extra = {}) => ({ kind: 'user', text, ...extra });
const a = (text, extra = {}) => ({ kind: 'assistant', blocks: [{ type: 'text', text }], ...extra });
const tool = (toolCallId) => ({ kind: 'tool', toolCallId });
const label = (m) => m.text ?? m.blocks?.[0]?.text ?? m.kind;

function turns(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(u(`q${i}`), a(`ans${i}`));
  return out;
}

describe('MessageMerge.findShift', () => {
  const keys = (msgs) => msgs.map(MessageMerge.messageKey);

  it('is 0 when nothing was trimmed', () => {
    assert.equal(MessageMerge.findShift(keys(turns(1, 2)), keys(turns(1, 2))), 0);
  });

  it('finds the head-trim offset', () => {
    assert.equal(MessageMerge.findShift(keys(turns(3, 4)), keys(turns(1, 4))), 4);
  });

  it('finds the offset when turns were appended while away', () => {
    assert.equal(MessageMerge.findShift(keys(turns(2, 3)), keys(turns(1, 4))), 2);
  });

  it('is negative when persisted history is a suffix of local (compaction)', () => {
    assert.equal(MessageMerge.findShift(keys(turns(1, 4)), keys(turns(3, 4))), -4);
  });

  it('is null when the lists are unrelated or only partly overlap', () => {
    assert.equal(MessageMerge.findShift(keys([u('x'), a('y')]), keys(turns(1, 2))), null);
    assert.equal(MessageMerge.findShift(keys(turns(1, 4)), keys([u('q3'), a('other')])), null);
  });

  it('prefers the newest window for repeated texts', () => {
    const rep = [u('go'), a('ok'), u('go'), a('ok')];
    assert.equal(MessageMerge.findShift(keys([u('go'), a('ok')]), keys(rep)), 2);
  });

  it('ignores whitespace differences and tells thought-only turns apart', () => {
    assert.equal(
      MessageMerge.messageKey(a('a b\nc')),
      MessageMerge.messageKey(a('abc')),
    );
    assert.notEqual(
      MessageMerge.messageKey({ kind: 'assistant', blocks: [], thought: 'hmm' }),
      MessageMerge.messageKey({ kind: 'assistant', blocks: [], thought: 'other' }),
    );
  });
});

describe('MessageMerge.merge', () => {
  it('returns the persisted list when nothing is shown yet', () => {
    const comp = turns(1, 1);
    assert.deepEqual(MessageMerge.merge([], comp), comp);
  });

  it('keeps a head-trimmed list as-is — no duplicated tail', () => {
    const full = turns(1, 20);
    const trimmed = full.slice(26); // turns 14..20
    const out = MessageMerge.merge(trimmed, full);
    assert.deepEqual(out.map(label), trimmed.map(label));
  });

  it('appends only the turns that finished while away', () => {
    const out = MessageMerge.merge(turns(3, 4), turns(1, 6));
    assert.deepEqual(out.map(label), turns(3, 6).map(label));
  });

  it('keeps ephemeral cards in place', () => {
    const cur = [u('q1'), a('ans1'), tool('t1'), u('q2'), a('ans2')];
    const out = MessageMerge.merge(cur, turns(1, 2));
    assert.deepEqual(out.map(label), ['q1', 'ans1', 'tool', 'q2', 'ans2']);
    assert.equal(out[2].toolCallId, 't1');
  });

  it('keeps local-only older bubbles when omp compacted them away', () => {
    const out = MessageMerge.merge(turns(1, 4), turns(3, 4));
    assert.deepEqual(out.map(label), turns(1, 4).map(label));
  });

  it('replaces matched bubbles with the persisted copy but keeps their _id', () => {
    const cur = [u('q1', { _id: 7 }), a('ans1', { _id: 8 })];
    const persisted = [u('q1', { time: 'T' }), a('ans1', { tokens: 5 })];
    const out = MessageMerge.merge(cur, persisted);
    assert.equal(out[0]._id, 7);
    assert.equal(out[0].time, 'T');
    assert.equal(out[1]._id, 8);
    assert.equal(out[1].tokens, 5);
  });

  it('drops streaming bubbles (the caller re-attaches them)', () => {
    const cur = [u('q1'), a('ans1'), a('partial', { streaming: true })];
    const out = MessageMerge.merge(cur, turns(1, 1));
    assert.deepEqual(out.map(label), ['q1', 'ans1']);
  });

  it('ignores empty tool-only assistant bubbles when aligning and drops them', () => {
    const empty = { kind: 'assistant', blocks: [{ type: 'text', text: '' }], thought: null };
    const cur = [u('q1'), empty, a('ans1'), empty, u('q2'), a('ans2')];
    const out = MessageMerge.merge(cur, turns(1, 2));
    assert.deepEqual(out.map(label), ['q1', 'ans1', 'q2', 'ans2']);
  });

  it('puts cards after the history when only cards are shown', () => {
    const out = MessageMerge.merge([tool('t1')], turns(1, 1));
    assert.deepEqual(out.map(label), ['q1', 'ans1', 'tool']);
  });

  it('falls back to the persisted list (cards last) when disconnected', () => {
    const out = MessageMerge.merge([u('stale'), tool('pending')], turns(1, 1));
    assert.deepEqual(out.map(label), ['q1', 'ans1', 'tool']);
  });

  it('stays fast on a long history', () => {
    const full = turns(1, 1500);
    const trimmed = full.slice(-168);
    const t0 = process.hrtime.bigint();
    const out = MessageMerge.merge(trimmed, full);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(out.length, 168);
    assert.ok(ms < 500, `merge took ${ms}ms`);
  });
});
