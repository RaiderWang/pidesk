/**
 * test/live-events-message.test.mjs
 *
 * live/events-message.js in isolation (every collaborator injected, incl.
 * savePrefs — the module needs nothing else loaded): thinking-level clamping,
 * turn_end TPS/cost, message lifecycle, prompt_result error mounting.
 *
 * Run: node --test test/live-events-message.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['live/defaults.js', 'live/runtime.js', 'live/events-message.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
globalThis.PeerSessionBridge = { build: () => null, id: null };

const { Runtime, EventsMessage, Defaults } = globalThis._Live;

let runtime, state, rt, notified, sent, prefs, settled, titles, firstTexts, h;

beforeEach(() => {
  runtime = Runtime.create({
    defaults: Defaults, sessionRegistry: new Map(), sessionSnapshots: new Map(), pendingSetModel: [],
  });
  ({ state, rt } = runtime);
  notified = 0; sent = []; prefs = []; settled = []; titles = []; firstTexts = [];
  h = EventsMessage.create({
    state, rt,
    notify: () => { notified++; },
    send: cmd => sent.push(cmd),
    savePrefs: patch => prefs.push(patch),
    settleInFlightActions: opts => settled.push(opts),
    reindexToolCards: runtime.reindexToolCards,
    refreshCtx: runtime.refreshCtx,
    nextCmdId: runtime.nextCmdId,
    setTabTitle: (title, sid) => titles.push([title, sid]),
    updateTabTitleIfDefault: text => firstTexts.push(text),
  }).handlers;
});

const asst = (text = 'hello') => ({ role: 'assistant', content: [{ type: 'text', text }] });

describe('events-message — session level', () => {
  it('session_info_update forwards title + target session', () => {
    h.session_info_update({ type: 'session_info_update', title: 'My chat', sessionId: 'omp-1' });
    h.session_info_update({ type: 'session_info_update' });
    assert.deepEqual(titles, [['My chat', 'omp-1']]);
  });

  it('thinking_level_changed clamps an unsupported level to the first available and saves prefs', () => {
    state.availableThinkingLevels = ['off', 'low'];
    state.thinkingLevel = 'low';
    h.thinking_level_changed({ type: 'thinking_level_changed', thinkingLevel: 'xhigh' });
    assert.equal(state.thinkingLevel, 'off');
    assert.deepEqual(prefs, [{ thinkingLevel: 'off' }]);
    assert.equal(notified, 1);
  });

  it('thinking_level_changed to the same level is silent', () => {
    state.availableThinkingLevels = ['off', 'low'];
    state.thinkingLevel = 'low';
    h.thinking_level_changed({ type: 'thinking_level_changed', thinkingLevel: 'low' });
    assert.equal(prefs.length, 0);
    assert.equal(notified, 0);
  });

  it('thinking_level_changed defaults to "off" and accepts anything when levels are unknown', () => {
    state.thinkingLevel = 'high';
    h.thinking_level_changed({ type: 'thinking_level_changed' });
    assert.equal(state.thinkingLevel, 'off');
    h.thinking_level_changed({ type: 'thinking_level_changed', thinkingLevel: 'medium' });
    assert.equal(state.thinkingLevel, 'medium');
  });

  it('agent_start / agent_end only refresh get_state; session_settled clears pending work', () => {
    h.agent_start({ type: 'agent_start' });
    h.agent_end({ type: 'agent_end' });
    assert.deepEqual(sent, [{ type: 'get_state' }, { type: 'get_state' }]);
    state.hasPendingAsyncWork = true; state.isSettled = false;
    h.session_settled({ type: 'session_settled' });
    assert.equal(state.hasPendingAsyncWork, false);
    assert.equal(state.isSettled, true);
  });
});

describe('events-message — turns', () => {
  it('turn_start marks streaming and stamps the clock', () => {
    const before = Date.now();
    h.turn_start({ type: 'turn_start' });
    assert.equal(state.isStreaming, true);
    assert.ok(state.turnStartMs >= before);
    assert.equal(rt.session.turnStartTime, state.turnStartMs);
  });

  it('turn_end computes TPS into the rolling window and accumulates cost', () => {
    state.rpcState = { contextUsage: { tokens: 10, contextWindow: 100, percent: 10 } };
    rt.session.turnStartTime = Date.now() - 2000;
    state.isStreaming = true;
    h.turn_end({ type: 'turn_end', message: { usage: { output: 100, cost: { total: 0.25 } } } });
    assert.equal(state.isStreaming, false);
    assert.ok(state.currentTps > 40 && state.currentTps < 60, `tps ${state.currentTps}`);
    assert.equal(rt.session.tpsSamples.length, 30, 'window stays 30 wide');
    assert.equal(state.sparkline.at(-1), Math.round(state.currentTps));
    assert.equal(state.sessionCost, 0.25);
    h.turn_end({ type: 'turn_end', message: { usage: { output: 0, cost: { total: 0.5 } } } });
    assert.equal(state.sessionCost, 0.75);
  });

  it('turn_end settles non-aborted, asks for stats + state, and notifies', () => {
    h.turn_end({ type: 'turn_end' });
    assert.deepEqual(settled, [{ aborted: false }]);
    assert.deepEqual(sent.map(c => c.type), ['get_session_stats', 'get_state']);
    assert.equal(rt.session.streamingBubble, null);
    assert.equal(notified, 1);
  });

  it('turn_end without usage leaves TPS and cost alone', () => {
    rt.session.turnStartTime = Date.now() - 1000;
    h.turn_end({ type: 'turn_end' });
    assert.equal(state.currentTps, 0);
    assert.equal(state.sessionCost, null);
  });
});

describe('events-message — message lifecycle', () => {
  it('user message_start appends once, offers the text as tab title, dedupes the echo', () => {
    const ev = { type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } };
    h.message_start(ev);
    h.message_start(ev);
    assert.equal(state.messages.length, 1);
    assert.deepEqual(firstTexts, ['hi', 'hi']); // title hook runs for the echo too (it is idempotent)
    assert.equal(state.messages[0].kind, 'user');
  });

  it('user echo of an already-shown message gains its images instead of duplicating', () => {
    state.messages = [{ kind: 'user', text: 'look', images: [] }];
    h.message_start({ type: 'message_start', message: { role: 'user', content: [
      { type: 'text', text: 'look' }, { type: 'image', data: 'AAA' },
    ] } });
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].images.length, 1);
    assert.equal(state.messages[0].images[0].mimeType, 'image/png');
  });

  it('assistant message_start opens the streaming bubble', () => {
    state.model = { name: 'GPT' };
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    assert.equal(rt.session.streamingBubble.streaming, true);
    assert.equal(rt.session.streamingBubble.model, 'GPT');
    assert.equal(state.messages.at(-1).streaming, true);
  });

  it('message_update replaces the streaming entry even when an ask bubble sits after it', () => {
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    state.messages = [...state.messages, { kind: 'ask' }];
    h.message_update({ type: 'message_update', message: asst('partial') });
    const idx = state.messages.findIndex(m => m.streaming);
    assert.equal(idx, 0);
    assert.equal(state.messages[0].blocks[0].text, 'partial');
    assert.equal(state.messages[1].kind, 'ask');
  });

  it('message_update without a streaming bubble is ignored', () => {
    h.message_update({ type: 'message_update', message: asst('x') });
    assert.equal(notified, 0);
  });

  it('message_end completes the bubble with usage and clears streamingBubble', () => {
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    h.message_end({ type: 'message_end', message: { ...asst('done'), usage: { input: 10, output: 5 } } });
    const m = state.messages[0];
    assert.equal(m.streaming, false);
    assert.equal(m.tokens, 15);
    assert.equal(m.tokensIn, 10);
    assert.equal(m.tokensOut, 5);
    assert.equal(rt.session.streamingBubble, null);
  });

  it('message_end for a user/toolResult message does not close the assistant bubble', () => {
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    h.message_end({ type: 'message_end', message: { role: 'user', content: [] } });
    h.message_end({ type: 'message_end', message: { role: 'toolResult', content: [] } });
    assert.ok(rt.session.streamingBubble);
    assert.equal(state.messages[0].streaming, true);
  });

  it('a content-less (tool-call-only) turn drops its placeholder', () => {
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    h.message_end({ type: 'message_end', message: { role: 'assistant', content: [] } });
    assert.equal(state.messages.length, 0);
    assert.equal(rt.session.streamingBubble, null);
  });

  it('a failed turn keeps its bubble and mounts errorMessage on it', () => {
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    h.message_end({ type: 'message_end', message: {
      role: 'assistant', content: [], stopReason: 'error', errorMessage: ' 429 rate limited ',
      provider: 'p', model: 'm',
    } });
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].error.message, '429 rate limited');
    assert.equal(state.messages[0].error.provider, 'p');
  });
});

describe('events-message — prompt_result', () => {
  it('mounts the error on the latest real assistant bubble, skipping notices', () => {
    state.messages = [
      { kind: 'assistant', blocks: [] },
      { kind: 'assistant', notice: true, blocks: [] },
    ];
    h.prompt_result({ type: 'prompt_result', status: 'error', error: { message: 'boom', code: 'cost_cap', retryable: 1 } });
    assert.equal(state.messages[0].error.message, 'boom');
    assert.equal(state.messages[0].error.code, 'cost_cap');
    assert.equal(state.messages[0].error.retryable, true);
    assert.equal(state.messages[1].error, undefined);
    assert.equal(notified, 1);
  });

  it('clears streamingBubble when the error lands on it', () => {
    h.message_start({ type: 'message_start', message: { role: 'assistant', content: [] } });
    h.prompt_result({ type: 'prompt_result', status: 'error', error: { message: 'x' } });
    assert.equal(rt.session.streamingBubble, null);
    assert.equal(state.messages[0].streaming, false);
  });

  it('creates an error bubble when there is no assistant message', () => {
    state.messages = [{ kind: 'user', text: 'hi' }];
    h.prompt_result({ type: 'prompt_result', status: 'error', error: { message: 'no net' } });
    assert.equal(state.messages.length, 2);
    assert.equal(state.messages[1].kind, 'assistant');
    assert.equal(state.messages[1].error.message, 'no net');
  });

  it('accepts a bare string error', () => {
    state.messages = [{ kind: 'assistant', blocks: [] }];
    h.prompt_result({ type: 'prompt_result', status: 'error', error: 'plain' });
    assert.equal(state.messages[0].error.message, 'plain');
  });

  it('sessionSettled drives isSettled / hasPendingAsyncWork; ok status adds no error', () => {
    state.hasPendingAsyncWork = true;
    state.messages = [{ kind: 'assistant', blocks: [] }];
    h.prompt_result({ type: 'prompt_result', status: 'ok', sessionSettled: true });
    assert.equal(state.isSettled, true);
    assert.equal(state.hasPendingAsyncWork, false);
    assert.equal(state.messages[0].error, undefined);
    h.prompt_result({ type: 'prompt_result', status: 'ok', sessionSettled: false });
    assert.equal(state.isSettled, false);
  });
});
