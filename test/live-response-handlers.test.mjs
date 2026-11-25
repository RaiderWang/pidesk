/**
 * test/live-response-handlers.test.mjs
 *
 * live/response-handlers.js in isolation: the load-bearing dispatch order
 * (pending id → always → failure drop → success table), own-key safety, the
 * compact card on failure and the get_state projection.
 *
 * Run: node --test test/live-response-handlers.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['live/defaults.js', 'live/runtime.js', 'live/todo-phases.js', 'live/response-handlers.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
globalThis.PeerSessionBridge = { build: () => null, id: null };

const { Runtime, TodoPhases, ResponseHandlers, Defaults } = globalThis._Live;

let runtime, state, rt, sent, notified, pending, calls, registry, finalized, h;

beforeEach(() => {
  registry = new Map([['s1', { id: 's1', name: 'T', path: '' }]]);
  runtime = Runtime.create({
    defaults: Defaults, sessionRegistry: registry, sessionSnapshots: new Map(), pendingSetModel: [],
  });
  ({ state, rt } = runtime);
  rt.conn.activeSessionId = 's1';
  sent = [];
  notified = 0;
  pending = new Map();
  calls = [];
  finalized = [];
  const models = {
    restorePrefs: () => calls.push('restorePrefs'),
    syncCurrentModel: () => calls.push('sync'),
    initFetch: () => calls.push('initFetch'),
    responseHandlers: {
      always: { set_model: resp => { calls.push(['always.set_model', resp.success]); return !resp.success; } },
      success: { set_model: data => calls.push(['success.set_model', data]) },
    },
  };
  h = ResponseHandlers.create({
    state, rt, runtime,
    notify: () => { notified++; },
    send: cmd => sent.push(cmd),
    pendingResponses: pending,
    sessionRegistry: registry,
    todo: TodoPhases.create({ state, rt }),
    ui: { finalizeAsks: o => finalized.push(o) },
    models,
    buildModelEntry: m => ({ ...m }),
    setTabTitle: t => calls.push(['title', t]),
    resetSession: () => calls.push('reset'),
  });
});

describe('response-handlers — dispatch order', () => {
  it('a pending id resolves with data before any handler runs', () => {
    let got;
    pending.set('c1', { resolve: d => { got = d; }, reject: () => assert.fail('no reject') });
    h.handleResponse({ id: 'c1', command: 'set_model', success: true, data: { id: 'm' } });
    assert.deepEqual(got, { id: 'm' });
    assert.equal(pending.size, 0);
    assert.deepEqual(calls, []);
  });

  it('a pending id rejects on failure (and skips `always`)', () => {
    let err;
    pending.set('c2', { resolve: () => assert.fail('no resolve'), reject: e => { err = e; } });
    h.handleResponse({ id: 'c2', command: 'set_model', success: false, error: 'nope' });
    assert.equal(err.message, 'nope');
    assert.deepEqual(calls, []);
  });

  it('an unregistered id falls through to the normal tables', () => {
    h.handleResponse({ id: 'zzz', command: 'set_model', success: true, data: { id: 'm' } });
    assert.deepEqual(calls, [['always.set_model', true], ['success.set_model', { id: 'm' }]]);
  });

  it('`always` sees failures; when it handles one the success table is skipped', () => {
    h.handleResponse({ command: 'set_model', success: false, error: 'x' });
    assert.deepEqual(calls, [['always.set_model', false]]);
  });

  it('other failures are dropped silently', () => {
    h.handleResponse({ command: 'get_state', success: false, error: 'x' });
    assert.equal(notified, 0);
    assert.equal(state.rpcState, null);
  });

  it('wire-supplied command names cannot hit Object.prototype', () => {
    for (const command of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.doesNotThrow(() => h.handleResponse({ command, success: true, data: {} }));
      assert.doesNotThrow(() => h.handleResponse({ command, success: false }));
    }
    assert.deepEqual(calls, []);
  });

  it('get_state success goes to applyRpcState; get_session_stats is a no-op', () => {
    h.handleResponse({ command: 'get_session_stats', success: true, data: {} });
    assert.equal(notified, 0);
    h.handleResponse({ command: 'get_state', success: true, data: { isStreaming: false } });
    assert.ok(state.rpcState);
    assert.equal(notified, 1);
  });

  it('new_session resets, re-fetches and notifies', () => {
    h.handleResponse({ command: 'new_session', success: true, data: {} });
    assert.deepEqual(calls, ['reset', 'initFetch']);
    assert.equal(notified, 1);
  });
});

describe('response-handlers — compact', () => {
  const pendingCompact = () => {
    state.messages = [{ id: 'c', kind: 'compact', status: 'pending', tokensBefore: 10 }];
  };

  it('failure marks the card as error and does not refresh state', () => {
    pendingCompact();
    h.handleResponse({ command: 'compact', success: false, error: 'too small' });
    assert.equal(state.messages[0].status, 'error');
    assert.equal(state.messages[0].errorReason, 'too small');
    assert.equal(sent.length, 0);
  });

  it('success completes the card, arms the backfill and requests get_state', () => {
    pendingCompact();
    h.handleResponse({ command: 'compact', success: true, data: { summary: 'S', tokensBefore: 99 } });
    assert.equal(state.messages[0].status, 'done');
    assert.equal(state.messages[0].tokensBefore, 99);
    assert.equal(rt.session.compactBackfillId, 'c');
    assert.deepEqual(sent, [{ type: 'get_state' }]);
  });

  it('the next get_state back-fills tokensAfter exactly once', () => {
    pendingCompact();
    h.handleResponse({ command: 'compact', success: true, data: {} });
    h.handleResponse({ command: 'get_state', success: true, data: { contextUsage: { tokens: 42 } } });
    assert.equal(state.messages[0].tokensAfter, 42);
    assert.equal(rt.session.compactBackfillId, null);
    h.handleResponse({ command: 'get_state', success: true, data: { contextUsage: { tokens: 7 } } });
    assert.equal(state.messages[0].tokensAfter, 42);
  });
});

describe('response-handlers — applyRpcState', () => {
  it('idle agent: finalizes asks and drops leftover tool cards', () => {
    state.messages = [{ kind: 'tool', id: 't' }, { kind: 'agent', id: 'a' }];
    h.applyRpcState({ isStreaming: false });
    assert.deepEqual(finalized, [{ aborted: false }]);
    assert.deepEqual(state.messages.map(m => m.kind), ['agent']);
  });

  it('retires a stale streaming bubble when omp is no longer streaming', () => {
    rt.session.streamingBubble = { id: 'b', streaming: true };
    state.messages = [rt.session.streamingBubble];
    h.applyRpcState({ isStreaming: false });
    assert.equal(rt.session.streamingBubble, null);
    assert.equal(state.messages[0].streaming, false);
  });

  it('first get_state of a fresh session restores prefs once', () => {
    rt.session.sessionFresh = true;
    h.applyRpcState({ isStreaming: false });
    h.applyRpcState({ isStreaming: false });
    assert.equal(calls.filter(c => c === 'restorePrefs').length, 1);
  });

  it('sessionName renames the tab; sessionFile is bound once, re-bound on change', () => {
    h.applyRpcState({ sessionName: 'Named', sessionFile: 'C:/a.jsonl' });
    assert.deepEqual(calls, [['title', 'Named']]);
    assert.equal(registry.get('s1').sessionFile, 'C:/a.jsonl');

    h.applyRpcState({ sessionFile: 'C:/A.jsonl' }); // same path, case differs: no re-bind
    assert.equal(registry.get('s1').sessionPath, undefined);

    h.applyRpcState({ sessionFile: 'C:/b.jsonl', sessionId: 'id-b' });
    const e = registry.get('s1');
    assert.equal(e.sessionFile, 'C:/b.jsonl');
    assert.equal(e.sessionPath, 'C:/b.jsonl');
    assert.equal(e.savedSessionId, 'id-b');
  });

  it('ignores a null state', () => {
    h.applyRpcState(null);
    assert.equal(notified, 0);
  });
});
