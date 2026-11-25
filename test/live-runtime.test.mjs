/**
 * test/live-runtime.test.mjs
 *
 * live/runtime.js in isolation: per-tab save/restore/reset of the volatile
 * variables (rt.session), what must NOT travel with a tab (rt.conn), the
 * monotonic counters (rt.seq), head-trim index shifting and the shared
 * snapshot builder used by notify() and onUpdate().
 *
 * Run: node --test test/live-runtime.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['live/defaults.js', 'live/runtime.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}

const { Runtime, Defaults } = globalThis._Live;

globalThis.PeerSessionBridge = { build: () => null, id: null };

let sessionRegistry, sessionSnapshots, pendingSetModel, runtime, state, rt;

beforeEach(() => {
  sessionRegistry = new Map();
  sessionSnapshots = new Map();
  pendingSetModel = [];
  runtime = Runtime.create({ defaults: Defaults, sessionRegistry, sessionSnapshots, pendingSetModel });
  ({ state, rt } = runtime);
});

describe('runtime — save / restore / reset', () => {
  it('round-trips state and rt.session volatile vars through a snapshot', () => {
    rt.conn.activeSessionId = 'A';
    const bubble = { kind: 'assistant', streaming: true };
    state.messages = [{ kind: 'user', text: 'hi' }, bubble];
    state.isStreaming = true;
    state.thinkingLevel = 'high';
    rt.session.streamingBubble = bubble;
    rt.session.activeToolCards = new Map([['tc1', 4]]);
    rt.session.tpsSamples = [1, 2, 3];
    rt.session.turnStartTime = 1234;
    rt.session.activityLog = [{ ts: 1, toolName: 'bash' }];
    runtime.save();

    runtime.reset();
    assert.equal(state.messages.length, 0);
    assert.equal(rt.session.streamingBubble, null);
    assert.equal(rt.session.activeToolCards.size, 0);

    assert.equal(runtime.restore('A'), true);
    assert.equal(state.messages.length, 2);
    assert.equal(state.isStreaming, true);
    assert.equal(state.thinkingLevel, 'high');
    assert.equal(rt.session.streamingBubble, bubble);
    assert.deepEqual([...rt.session.activeToolCards], [['tc1', 4]]);
    assert.deepEqual(rt.session.tpsSamples, [1, 2, 3]);
    assert.equal(rt.session.turnStartTime, 1234);
    assert.deepEqual(rt.session.activityLog, [{ ts: 1, toolName: 'bash' }]);
  });

  it('save copies mutable containers so later mutation does not leak into the snapshot', () => {
    rt.conn.activeSessionId = 'A';
    rt.session.activeToolCards = new Map([['x', 1]]);
    rt.session.activityLog = [{ ts: 1, toolName: 'a' }];
    runtime.save();
    rt.session.activeToolCards.set('y', 2);
    rt.session.activityLog.push({ ts: 2, toolName: 'b' });
    const snap = sessionSnapshots.get('A');
    assert.equal(snap.activeToolCards.size, 1);
    assert.equal(snap.activityLog.length, 1);
  });

  it('save is a no-op without an active session; restore of an unknown id is false', () => {
    runtime.save();
    assert.equal(sessionSnapshots.size, 0);
    assert.equal(runtime.restore('nope'), false);
  });

  it('save caps each hub agent stream at the last 200 lines', () => {
    rt.conn.activeSessionId = 'A';
    state.hubAgents = [{ id: 'a1', _stream: Array.from({ length: 500 }, (_, i) => `l${i}`) }];
    runtime.save();
    const saved = sessionSnapshots.get('A').hubAgents[0]._stream;
    assert.equal(saved.length, 200);
    assert.equal(saved[199], 'l499');
  });

  it('restore defaults fields an older snapshot lacks', () => {
    sessionSnapshots.set('old', {
      messages: [], isStreaming: false, model: null, thinkingLevel: null, ctx: {}, kanban: [],
      planMeta: {}, models: [], activity: [], sparkline: [], rpcState: null, sessionCost: null,
      currentTps: 0, streamingBubble: null, activeToolCards: new Map(), tpsSamples: [],
      turnStartTime: null, activityLog: [],
    });
    runtime.restore('old');
    assert.equal(state.availableThinkingLevels, null);
    assert.equal(state.hubMode, 'compact');
    assert.equal(state.isSettled, true);
    assert.deepEqual(state.toolLogs, {});
  });

  it('reset clears the pending set_model queue, keeps rt.seq', () => {
    pendingSetModel.push('restore', 'user');
    rt.session.compactBackfillId = 'c1';
    rt.seq.msg = 41;
    runtime.reset();
    assert.equal(pendingSetModel.length, 0);
    assert.equal(rt.session.compactBackfillId, null);
    assert.equal(rt.seq.msg, 41);
  });

  it('reset does not touch transport state (rt.conn.activeSessionId / listeners)', () => {
    rt.conn.activeSessionId = 'A';
    rt.conn.activeListeners = [() => {}];
    rt.conn.agentStarting = true;
    runtime.reset();
    assert.equal(rt.conn.activeSessionId, 'A');
    assert.equal(rt.conn.activeListeners.length, 1);
    assert.equal(rt.conn.agentStarting, true);
  });

  it('compactBackfillId travels with the tab; sessionFresh does not (the tab switch sets it)', () => {
    rt.conn.activeSessionId = 'A';
    rt.session.compactBackfillId = 'c1';
    rt.session.sessionFresh = true;
    runtime.save();
    const snap = sessionSnapshots.get('A');
    assert.equal(snap.compactBackfillId, 'c1');
    assert.ok(!('sessionFresh' in snap));

    rt.session.compactBackfillId = 'other-tab';
    runtime.restore('A');
    assert.equal(rt.session.compactBackfillId, 'c1');
    assert.equal(rt.session.sessionFresh, true); // untouched by restore
  });

  it('restoring a tab without a pending back-fill clears one left by another tab', () => {
    sessionSnapshots.set('B', {
      messages: [], isStreaming: false, model: null, thinkingLevel: null, ctx: {}, kanban: [],
      planMeta: {}, models: [], activity: [], sparkline: [], rpcState: null, sessionCost: null,
      currentTps: 0, streamingBubble: null, activeToolCards: new Map(), tpsSamples: [],
      turnStartTime: null, activityLog: [],
    });
    rt.session.compactBackfillId = 'leftover';
    runtime.restore('B');
    assert.equal(rt.session.compactBackfillId, null);
  });
});

describe('runtime — tool cards, trimming, counters', () => {
  it('reindexToolCards maps only running tool cards with a call id', () => {
    state.messages = [
      { kind: 'user' },
      { kind: 'tool', status: 'running', _toolCallId: 't1' },
      { kind: 'tool', status: 'done', _toolCallId: 't2' },
      { kind: 'tool', status: 'running' },
      { kind: 'tool', status: 'running', _toolCallId: 't3' },
    ];
    runtime.reindexToolCards();
    assert.deepEqual([...rt.session.activeToolCards], [['t1', 1], ['t3', 4]]);
  });

  it('reindexToolCards accepts an explicit list and replaces the map', () => {
    rt.session.activeToolCards = new Map([['stale', 0]]);
    runtime.reindexToolCards([{ kind: 'tool', status: 'running', _toolCallId: 'n' }]);
    assert.deepEqual([...rt.session.activeToolCards], [['n', 0]]);
  });

  it('trimMessages drops one 13-row once past 169, shifting/evicting active cards', () => {
    state.messages = Array.from({ length: Runtime.MINIMAP_MAX + 1 }, (_, i) => ({ kind: 'user', i }));
    rt.session.activeToolCards = new Map([['gone', 5], ['kept', 40]]);
    runtime.trimMessages();
    assert.equal(state.messages.length, Runtime.MINIMAP_MAX + 1 - Runtime.MINIMAP_COLS);
    assert.equal(state.messages[0].i, Runtime.MINIMAP_COLS);
    assert.equal(rt.session.activeToolCards.has('gone'), false);
    assert.equal(rt.session.activeToolCards.get('kept'), 40 - Runtime.MINIMAP_COLS);
  });

  it('trimMessages waits for a clean turn boundary and respects the cap', () => {
    state.messages = Array.from({ length: Runtime.MINIMAP_MAX + 5 }, () => ({ kind: 'user' }));
    state.isStreaming = true;
    runtime.trimMessages();
    assert.equal(state.messages.length, Runtime.MINIMAP_MAX + 5);
    state.isStreaming = false;
    state.messages = state.messages.slice(0, Runtime.MINIMAP_MAX);
    runtime.trimMessages();
    assert.equal(state.messages.length, Runtime.MINIMAP_MAX);
  });

  it('prepare stamps ids once and keeps them stable', () => {
    state.messages = [{ kind: 'user' }, { kind: 'user', _id: 99 }];
    runtime.prepare();
    const first = state.messages[0]._id;
    assert.ok(first > 0);
    assert.equal(state.messages[1]._id, 99);
    runtime.prepare();
    assert.equal(state.messages[0]._id, first);
  });

  it('counters are monotonic and unique across calls', () => {
    const a = runtime.genSessionId();
    const b = runtime.genSessionId();
    assert.notEqual(a, b);
    assert.match(a, /^session-\d+-1$/);
    assert.match(b, /^session-\d+-2$/);
    const c1 = runtime.nextCmdId();
    assert.equal(runtime.nextCmdId(), c1 + 1);
  });
});

describe('runtime — buildSnapshot', () => {
  it('carries active tab, starting flag, tab list and thinking levels', () => {
    sessionRegistry.set('A', { id: 'A', name: 'one' });
    rt.conn.activeSessionId = 'A';
    rt.conn.agentStarting = true;
    state.availableThinkingLevels = ['off', 'low'];
    const snap = runtime.buildSnapshot();
    assert.equal(snap.activeSessionId, 'A');
    assert.equal(snap.agentStarting, true);
    assert.deepEqual(snap.availableThinkingLevels, ['off', 'low']);
    assert.deepEqual(snap.sessions, [{ id: 'A', name: 'one' }]);
    assert.equal(snap.messages, state.messages);
  });

  it('refreshCtx rebuilds ctx from rpcState', () => {
    state.rpcState = { contextUsage: { tokens: 1000, contextWindow: 4000, percent: 25 } };
    runtime.refreshCtx();
    assert.ok(state.ctx);
    assert.notEqual(state.ctx, Defaults.ctx);
  });
});
