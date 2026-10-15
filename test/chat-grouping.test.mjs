/**
 * test/chat-grouping.test.mjs
 *
 * Unit tests for src/app/chat-grouping.js — folding runs of tool messages.
 *
 * Run: node --test test/chat-grouping.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChatGrouping } from './helpers/shim.mjs';

const { groupToolRuns, summarizeRun, findGroupKeyForIdx } = ChatGrouping;

const tool = (id, name = 'read', status = 'ok', duration = 10) =>
  ({ kind: 'tool', _id: id, tool: name, status, duration });
const user = (id) => ({ kind: 'user', _id: id, text: 'hi' });
const asst = (id) => ({ kind: 'assistant', _id: id, text: 'ok' });
const ask = (id) => ({ kind: 'ask', _id: id });

describe('groupToolRuns — thresholds', () => {
  it('does not group a run shorter than minRun (2 tools)', () => {
    const out = groupToolRuns([user('u'), tool('a'), tool('b'), asst('x')]);
    assert.deepEqual(out.map((e) => e.type), ['msg', 'msg', 'msg', 'msg']);
  });

  it('groups a run of exactly 3 tools', () => {
    const out = groupToolRuns([user('u'), tool('a'), tool('b'), tool('c'), asst('x')]);
    assert.deepEqual(out.map((e) => e.type), ['msg', 'group', 'msg']);
    const g = out[1];
    assert.equal(g.key, 'a');
    assert.equal(g.startIdx, 1);
    assert.equal(g.endIdx, 3);
    assert.equal(g.items.length, 3);
  });

  it('honours a custom minRun', () => {
    const msgs = [tool('a'), tool('b'), tool('c'), tool('d')];
    assert.equal(groupToolRuns(msgs, { minRun: 5 }).every((e) => e.type === 'msg'), true);
    assert.equal(groupToolRuns(msgs, { minRun: 4 })[0].type, 'group');
  });

  it('returns only plain messages when disabled', () => {
    const out = groupToolRuns([tool('a'), tool('b'), tool('c')], { enabled: false });
    assert.deepEqual(out.map((e) => e.type), ['msg', 'msg', 'msg']);
  });
});

describe('groupToolRuns — run boundaries', () => {
  it('splits into two groups when an assistant message interrupts', () => {
    const msgs = [tool('a'), tool('b'), tool('c'), asst('x'), tool('d'), tool('e'), tool('f')];
    const out = groupToolRuns(msgs);
    assert.deepEqual(out.map((e) => e.type), ['group', 'msg', 'group']);
    assert.equal(out[2].startIdx, 4);
  });

  it('an ask message interrupts a run', () => {
    const msgs = [tool('a'), tool('b'), ask('q'), tool('c'), tool('d')];
    const out = groupToolRuns(msgs);
    assert.equal(out.every((e) => e.type === 'msg'), true);
  });

  it('keeps original indices on every entry', () => {
    const msgs = [user('u'), tool('a'), tool('b'), tool('c'), asst('x')];
    const out = groupToolRuns(msgs);
    assert.equal(out[0].idx, 0);
    assert.deepEqual(out[1].items.map((i) => i.idx), [1, 2, 3]);
    assert.equal(out[2].idx, 4);
  });
});

describe('groupToolRuns — running tail', () => {
  it('leaves the running tool outside the group', () => {
    const msgs = [tool('a'), tool('b'), tool('c'), tool('d', 'bash', 'running')];
    const out = groupToolRuns(msgs);
    assert.deepEqual(out.map((e) => e.type), ['group', 'msg']);
    assert.equal(out[0].items.length, 3);
    assert.equal(out[1].msg._id, 'd');
  });

  it('does not group when fewer than minRun tools finished before the running one', () => {
    const msgs = [tool('a'), tool('b'), tool('c', 'bash', 'running')];
    const out = groupToolRuns(msgs);
    assert.equal(out.every((e) => e.type === 'msg'), true);
  });

  it('keeps the group key stable as the finished head grows', () => {
    const base = [tool('a'), tool('b'), tool('c'), tool('d', 'bash', 'running')];
    const before = groupToolRuns(base)[0].key;
    const grown = [tool('a'), tool('b'), tool('c'), tool('d'), tool('e', 'bash', 'running')];
    const after = groupToolRuns(grown)[0];
    assert.equal(after.key, before);
    assert.equal(after.items.length, 4);
  });

  it('a finished tool after a running one stays outside the group', () => {
    const msgs = [tool('a'), tool('b'), tool('c'), tool('d', 'bash', 'running'), tool('e')];
    const out = groupToolRuns(msgs);
    assert.deepEqual(out.map((e) => e.type), ['group', 'msg', 'msg']);
  });
});

describe('summarizeRun / stats', () => {
  it('counts tools by type in first-appearance order and sums durations', () => {
    const items = [
      { idx: 0, msg: tool('a', 'read', 'ok', 5) },
      { idx: 1, msg: tool('b', 'bash', 'ok', 7) },
      { idx: 2, msg: tool('c', 'read', 'ok', 3) },
    ];
    const s = summarizeRun(items);
    assert.deepEqual(Object.keys(s.byTool), ['read', 'bash']);
    assert.equal(s.byTool.read, 2);
    assert.equal(s.byTool.bash, 1);
    assert.equal(s.total, 3);
    assert.equal(s.durationMs, 15);
  });

  it('counts failed and aborted separately', () => {
    const items = [
      { idx: 0, msg: tool('a', 'bash', 'error') },
      { idx: 1, msg: tool('b', 'bash', 'failed') },
      { idx: 2, msg: tool('c', 'edit', 'aborted') },
      { idx: 3, msg: tool('d', 'edit', 'ok') },
    ];
    const s = summarizeRun(items);
    assert.equal(s.failed, 2);
    assert.equal(s.aborted, 1);
  });

  it('ignores non-numeric durations', () => {
    const items = [{ idx: 0, msg: { kind: 'tool', tool: 'read', status: 'ok', duration: null } }];
    assert.equal(summarizeRun(items).durationMs, 0);
  });

  it('group entries carry stats', () => {
    const out = groupToolRuns([tool('a', 'read'), tool('b', 'read'), tool('c', 'edit', 'aborted')]);
    assert.equal(out[0].stats.byTool.read, 2);
    assert.equal(out[0].stats.aborted, 1);
  });
});

describe('findGroupKeyForIdx', () => {
  const out = groupToolRuns([user('u'), tool('a'), tool('b'), tool('c'), asst('x')]);

  it('returns the key for an index inside a group', () => {
    assert.equal(findGroupKeyForIdx(out, 2), 'a');
  });

  it('returns null for indices outside any group', () => {
    assert.equal(findGroupKeyForIdx(out, 0), null);
    assert.equal(findGroupKeyForIdx(out, 4), null);
  });
});
