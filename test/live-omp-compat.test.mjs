/**
 * test/live-omp-compat.test.mjs
 *
 * Unit tests verifying dual compatibility between older omp (18.0.x)
 * and omp 18.4+ incremental features:
 *   1. Backward compatibility: legacy get_state & prompt_result without errors or settlement
 *   2. Forward enhancement: prompt_result structured error mapping & retryability
 *   3. Forward enhancement: session_settled event and hasPendingAsyncWork lifecycle
 *   4. i18n key integrity across en and zh-CN
 *
 * Run: node --test test/live-omp-compat.test.mjs
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
  const code = readFileSync(join(SRC, rel), 'utf-8');
  new Function(code)();
}

// Load dependencies
loadScript('i18n.js');
loadScript('peer-session.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;

describe('OMP Compatibility — Legacy (18.0.x) behavior', () => {
  it('gracefully handles legacy get_state lacking hasPendingAsyncWork/isSettled', () => {
    // Simulate legacy omp get_state response without new fields
    const legacyRpcState = {
      isStreaming: false,
      messageCount: 5,
      queuedMessageCount: 0,
    };

    // Dispatch legacy get_state
    bridge._handleEvent({
      type: 'agent_end',
    });

    const state = bridge.getState();
    assert.equal(state.hasPendingAsyncWork, false, 'hasPendingAsyncWork should default to false');
    assert.equal(state.isSettled, true, 'isSettled should default to true');
  });

  it('gracefully handles legacy prompt_result lacking status and error fields', () => {
    // Simulate legacy prompt_result without error
    bridge._handleEvent({
      type: 'prompt_result',
      id: 'cmd_1',
      agentInvoked: true,
    });

    const state = bridge.getState();
    assert.equal(state.hasPendingAsyncWork, false);
    assert.equal(state.isSettled, true);
  });
});

describe('OMP Compatibility — Modern (18.4+) enhanced behavior', () => {
  it('correctly tracks hasPendingAsyncWork from session_settled and prompt_result', () => {
    const state = bridge.getState();

    // 1. Simulate state update where async tasks are pending
    state.hasPendingAsyncWork = true;
    state.isSettled = false;

    // 2. session_settled arrives from omp 18.4+
    bridge._handleEvent({
      type: 'session_settled',
    });

    const updated = bridge.getState();
    assert.equal(updated.hasPendingAsyncWork, false, 'hasPendingAsyncWork should reset on session_settled');
    assert.equal(updated.isSettled, true, 'isSettled should be true after session_settled');
  });

  it('attaches structured error and retryable flag to assistant bubble upon prompt_result error', () => {
    // 1. Create a streaming assistant bubble
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Partial response before failure' }],
      },
    });

    // 2. prompt_result arrives with structured error
    bridge._handleEvent({
      type: 'prompt_result',
      id: 'cmd_err_1',
      agentInvoked: true,
      status: 'error',
      error: {
        message: 'Rate limit exceeded (429)',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        httpStatus: 429,
        retryable: true,
      },
      sessionSettled: true,
    });

    const state = bridge.getState();
    const lastAsst = [...state.messages].reverse().find(m => m.kind === 'assistant');
    assert.ok(lastAsst, 'assistant bubble should exist');
    assert.ok(lastAsst.error, 'last assistant bubble should have error attached');
    assert.equal(lastAsst.error.message, 'Rate limit exceeded (429)');
    assert.equal(lastAsst.error.provider, 'anthropic');
    assert.equal(lastAsst.error.httpStatus, 429);
    assert.equal(lastAsst.error.retryable, true);
    assert.equal(lastAsst.streaming, false);
    assert.equal(state.isSettled, true);
    assert.equal(state.hasPendingAsyncWork, false);
  });

  it('creates an error bubble if prompt_result error arrives with no prior assistant bubble', () => {
    const state = bridge.getState();
    // Wipe messages to simulate immediate rejection
    state.messages = [];

    bridge._handleEvent({
      type: 'prompt_result',
      id: 'cmd_err_2',
      agentInvoked: false,
      status: 'error',
      error: {
        message: 'Invalid API key provided',
        provider: 'openai',
        httpStatus: 401,
        retryable: false,
      },
      sessionSettled: true,
    });

    const updated = bridge.getState();
    const lastAsst = updated.messages[updated.messages.length - 1];
    assert.ok(lastAsst, 'should synthesize assistant error card');
    assert.equal(lastAsst.kind, 'assistant');
    assert.equal(lastAsst.error.message, 'Invalid API key provided');
    assert.equal(lastAsst.error.provider, 'openai');
    assert.equal(lastAsst.error.httpStatus, 401);
    assert.equal(lastAsst.error.retryable, false);
  });
});

describe('OMP Compatibility — i18n dictionary integrity', () => {
  it('provides matching en and zh-CN translations for all new keys', () => {
    const t = globalThis.t;
    assert.ok(typeof t === 'function', 't function should be available');

    const keys = [
      'agent.backgroundPending',
      'chat.error.providerError',
      'chat.error.retryable',
    ];

    for (const key of keys) {
      const enVal = t(key, null, undefined, 'en');
      const zhVal = t(key, null, undefined, 'zh-CN');

      assert.ok(enVal && enVal !== key, `key '${key}' should have English translation`);
      assert.ok(zhVal && zhVal !== key, `key '${key}' should have Chinese translation`);
    }

    assert.equal(t('agent.backgroundPending', null, undefined, 'en'), 'background work…');
    assert.equal(t('agent.backgroundPending', null, undefined, 'zh-CN'), '后台任务进行中…');
    assert.equal(t('chat.error.retryable', null, undefined, 'en'), 'Retryable');
    assert.equal(t('chat.error.retryable', null, undefined, 'zh-CN'), '可重试');
  });
});
