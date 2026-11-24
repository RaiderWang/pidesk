/**
 * test/live-compaction.test.mjs
 *
 * live.js wiring for omp 19 `manual_compaction_*` events and the abort /
 * process-exit settling of pending compact cards.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['peer-session.js', 'app/undo-message.js', 'undo-bridge.js', 'export-bridge.js', 'live.js']) {
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
const bridge = globalThis.OMP_BRIDGE;
const ev = (e) => bridge._handleEvent(e);
const cards = () => bridge.getState().messages.filter((m) => m.kind === 'compact');

describe('manual_compaction events in live.js', () => {
  beforeEach(() => {
    const s = bridge.getState();
    s.messages = [];
    s.rpcState = { contextUsage: { tokens: 26200 } };
  });

  it('start creates an external pending card with tokensBefore from contextUsage', () => {
    ev({ type: 'manual_compaction_start' });
    const [c] = cards();
    assert.equal(c.status, 'pending');
    assert.equal(c.external, true);
    assert.equal(c.tokensBefore, 26200);
  });

  it('end (committed) resolves it, and a later get_state back-fills tokensAfter', () => {
    ev({ type: 'manual_compaction_start' });
    ev({ type: 'manual_compaction_end', aborted: false, result: { shortSummary: 's', summary: 'S' } });
    const [c] = cards();
    assert.equal(c.status, 'done');
    bridge._handleResponse({
      id: 1, command: 'get_state', success: true,
      data: { isStreaming: false, contextUsage: { tokens: 8100 } },
    });
    assert.equal(cards()[0].tokensAfter, 8100);
  });

  it('a committed end asks omp for get_state; other ends and own cards do not', async () => {
    const sent = [];
    const prevTauri = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'send_command' && args?.json) sent.push(JSON.parse(args.json));
          if (name === 'is_session_running') return true;
          return null;
        },
      },
      event: { listen: async () => () => {} },
    };
    try {
      await bridge.resumeSession({
        id: 'cmpct-live', title: 'C', path: 'C:\\Users\\u\\.omp\\agent\\sessions\\t\\cmpct.jsonl',
      });
      const state = bridge.getState();
      const getStates = () => sent.filter((c) => c.type === 'get_state').length;
      const reset = () => { state.messages = []; state.rpcState = { contextUsage: { tokens: 1 } }; };

      reset();
      ev({ type: 'manual_compaction_start' });
      ev({ type: 'manual_compaction_end', aborted: false, errorMessage: 'nope' });
      const afterFailure = getStates();

      reset();
      state.messages = [{ kind: 'compact', status: 'pending', id: 'own' }];
      ev({ type: 'manual_compaction_end', aborted: false, result: { summary: 'x' } });
      assert.equal(getStates(), afterFailure, 'own card / failure: no extra get_state');

      reset();
      ev({ type: 'manual_compaction_start' });
      ev({ type: 'manual_compaction_end', aborted: false, result: { summary: 'x' } });
      assert.equal(getStates(), afterFailure + 1, 'committed external compaction refreshes state once');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('PiDesk\'s own compact card is not duplicated or resolved by the events', () => {
    bridge.getState().messages = [{ kind: 'compact', status: 'pending', id: 'cmpct-9' }];
    ev({ type: 'manual_compaction_start' });
    ev({ type: 'manual_compaction_end', aborted: false, result: { summary: 'x' } });
    assert.equal(cards().length, 1);
    assert.equal(cards()[0].status, 'pending');
  });

  it('end with errorMessage marks the card failed', () => {
    ev({ type: 'manual_compaction_start' });
    ev({ type: 'manual_compaction_end', aborted: false, errorMessage: 'nope' });
    assert.equal(cards()[0].status, 'error');
    assert.equal(cards()[0].errorReason, 'nope');
  });
});

describe('pending compact cards on abort', () => {
  beforeEach(() => { bridge.getState().messages = []; });

  it('abort() settles a pending compact card as aborted', () => {
    bridge.getState().messages = [{ kind: 'compact', status: 'pending', id: 'c1' }];
    bridge.abort();
    assert.equal(cards()[0].status, 'error');
    assert.equal(cards()[0].errorReason, globalThis.t('chat.aborted'));
  });

  it('a normal turn_end leaves a pending compact card alone', () => {
    bridge.getState().messages = [{ kind: 'compact', status: 'pending', id: 'c2' }];
    ev({ type: 'turn_end', message: { role: 'assistant', content: [] } });
    assert.equal(cards()[0].status, 'pending');
  });
});
