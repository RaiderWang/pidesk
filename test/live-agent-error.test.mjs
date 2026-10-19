/**
 * test/live-agent-error.test.mjs
 *
 * Regression: omp failing to start / exiting used to inject an assistant
 * bubble carrying a bare `text` field, which AssistantBubble (blocks-only)
 * rendered as an empty shell. The AgentErrorBanner owns that error now, and
 * any remaining client-side notice must use NoticeBubble (blocks shape).
 *
 * Run: node --test test/live-agent-error.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');

function loadScript(rel) {
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}

loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('undo-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;

const emptyAssistants = (msgs) =>
  msgs.filter((m) => m.kind === 'assistant' && !(m.blocks?.length) && !m.thought);

describe('live.js — agent start failure surfaces without a ghost bubble', () => {
  it('startup error + exit event set agentError and add no assistant bubble', async () => {
    const handlers = {};
    const prevTauri = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name) => {
          if (name === 'session_status') return 'failed to spawn omp: not found';
          if (name === 'is_session_running') return false;
          return null;
        },
      },
      event: {
        listen: async (evt, cb) => {
          handlers[evt] = cb;
          return () => {};
        },
      },
    };

    try {
      const tabId = await bridge.resumeSession({
        id: 'test-agent-error',
        title: 'Agent Error',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test\\session.jsonl',
      });
      assert.ok(tabId);

      const state = bridge.getState();
      const before = state.messages.length;
      assert.equal(state.agentError, 'failed to spawn omp: not found');
      assert.equal(emptyAssistants(state.messages).length, 0);

      const exitCb = Object.entries(handlers).find(([k]) => k.startsWith('agent://exit/'))?.[1];
      assert.equal(typeof exitCb, 'function');
      exitCb({ payload: 'Process exited with status 1' });

      assert.equal(state.agentError, 'Process exited with status 1');
      assert.equal(state.messages.length, before, 'no chat bubble should be added');
      assert.equal(emptyAssistants(state.messages).length, 0);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('failed set_model adds a renderable notice (blocks, not bare text)', () => {
    const state = bridge.getState();
    const before = state.messages.length;

    bridge._handleResponse({
      id: 424242,
      command: 'set_model',
      success: false,
      error: 'unknown model',
    });

    assert.equal(state.messages.length, before + 1);
    const bubble = state.messages[state.messages.length - 1];
    assert.equal(bubble.kind, 'assistant');
    assert.equal(bubble.text, undefined);
    assert.equal(bubble.blocks[0].type, 'text');
    assert.ok(bubble.blocks[0].text.includes('unknown model'));
  });
});
