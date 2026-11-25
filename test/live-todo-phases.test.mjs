/**
 * test/live-todo-phases.test.mjs
 *
 * live/todo-phases.js: one helper for every todo-phase source (history,
 * custom events, tool start/end, get_state). Covers the per-site fallback
 * contract and the inline-plan injection that get_state must skip.
 *
 * Run: node --test test/live-todo-phases.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
// eslint-disable-next-line no-new-func
new Function(readFileSync(join(SRC, 'live/todo-phases.js'), 'utf-8'))();

const { TodoPhases } = globalThis._Live;

const RAW = [{ name: 'Build', tasks: [
  { content: 'compile', status: 'completed' },
  { content: 'test', status: 'in_progress' },
  { content: 'ship', status: 'abandoned' },
] }];

let state, rt, todo;
beforeEach(() => {
  state = {
    messages: [
      { kind: 'assistant', blocks: [{ type: 'text', text: 'old' }] },
      { kind: 'assistant', notice: true, blocks: [] },
    ],
    kanban: [], planMeta: {}, rpcState: null,
  };
  rt = { session: { streamingBubble: null } };
  todo = TodoPhases.create({ state, rt });
});

describe('TodoPhases.apply', () => {
  it('returns true and fills kanban/planMeta when phases exist', () => {
    assert.equal(todo.apply(RAW), true);
    assert.ok(state.kanban.length > 0);
    assert.ok(state.planMeta && typeof state.planMeta === 'object');
  });

  it('returns false and leaves state untouched for empty/garbage payloads', () => {
    const before = { kanban: state.kanban, planMeta: state.planMeta };
    assert.equal(todo.apply([]), false);
    assert.equal(todo.apply(null), false);
    assert.equal(todo.apply(undefined), false);
    assert.equal(state.kanban, before.kanban);
    assert.equal(state.planMeta, before.planMeta);
  });

  it('injects the plan into the latest real assistant bubble (skipping notices)', () => {
    todo.apply(RAW);
    const plan = state.messages[0].blocks.find(b => b.type === 'plan');
    assert.ok(plan, 'plan block on the real assistant bubble');
    assert.ok(!state.messages[1].blocks.some(b => b.type === 'plan'), 'notice untouched');
    assert.equal(plan.phases[0].id, 'Build');
    assert.deepEqual(plan.phases[0].tasks.map(t => t.status), ['done', 'in_progress', 'done']);
    assert.ok(state.messages[0].blocks.some(b => b.type === 'text'), 'text blocks kept');
  });

  it('inject:false (get_state) does not touch chat', () => {
    const before = state.messages;
    assert.equal(todo.apply(RAW, { inject: false }), true);
    assert.equal(state.messages, before);
    assert.ok(state.kanban.length > 0);
  });

  it('re-applying replaces the previous plan block instead of stacking', () => {
    todo.apply(RAW);
    todo.apply(RAW);
    assert.equal(state.messages[0].blocks.filter(b => b.type === 'plan').length, 1);
  });

  it('also updates the in-flight streaming bubble so the next update keeps the plan', () => {
    const sb = { kind: 'assistant', streaming: true, blocks: [{ type: 'text', text: 'x' }] };
    rt.session.streamingBubble = sb;
    state.messages = [...state.messages, sb];
    todo.apply(RAW);
    assert.ok(sb.blocks.some(b => b.type === 'plan'));
  });

  it('no assistant bubble: phases still apply, injection is a no-op', () => {
    state.messages = [{ kind: 'user', text: 'hi' }];
    assert.equal(todo.apply(RAW), true);
    assert.equal(state.messages.length, 1);
    assert.ok(!state.messages[0].blocks);
  });
});

describe('TodoPhases.apply — fallback when normalizeTodoPhases is missing', () => {
  let saved;
  beforeEach(() => { saved = globalThis.normalizeTodoPhases; globalThis.normalizeTodoPhases = undefined; });
  afterEach(() => { globalThis.normalizeTodoPhases = saved; });

  it('uses the caller-supplied fallback (default [] → nothing applied)', () => {
    assert.equal(todo.apply(RAW), false);
    assert.equal(state.kanban.length, 0);
  });

  it('a null fallback is treated as nothing to apply (no throw)', () => {
    assert.equal(todo.apply(null, { fallback: null }), false);
  });

  it('applies phases from an explicit fallback', () => {
    assert.equal(todo.apply(null, { fallback: RAW }), true);
    assert.ok(state.kanban.length > 0);
  });
});
