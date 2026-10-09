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
loadScript('design/yaml-util.js');
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

describe('OMP Compatibility — Dynamic Thinking Levels & Model Reasoning', () => {
  it('get_available_thinking_levels updates availableThinkingLevels and clamps invalid level', () => {
    const state = bridge.getState();
    state.thinkingLevel = 'medium';

    // Simulate get_available_thinking_levels returning only dual levels
    bridge._handleResponse({
      id: 101,
      command: 'get_available_thinking_levels',
      success: true,
      data: { levels: ['off', 'low', 'high'] },
    });

    const updated = bridge.getState();
    assert.deepEqual(updated.availableThinkingLevels, ['off', 'low', 'high']);
    assert.equal(bridge.getAvailableThinkingLevels(), updated.availableThinkingLevels);
    // Since 'medium' is not in ['off', 'low', 'high'], should clamp to 'low'
    assert.equal(updated.thinkingLevel, 'low');
  });

  it('get_available_thinking_levels clamps to off when model only supports off', () => {
    const state = bridge.getState();
    state.thinkingLevel = 'high';

    bridge._handleResponse({
      id: 102,
      command: 'get_available_thinking_levels',
      success: true,
      data: { levels: ['off'] },
    });

    const updated = bridge.getState();
    assert.deepEqual(updated.availableThinkingLevels, ['off']);
    assert.equal(updated.thinkingLevel, 'off');
  });

  it('set_model to non-reasoning model resets thinkingLevel to off and queries available levels', async () => {
    const sentLines = [];
    const prevTauri = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'send_command' && args?.json) {
            sentLines.push(JSON.parse(args.json));
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
    };

    try {
      await bridge.resumeSession({
        id: 'test-thinking-reset',
        title: 'Thinking Non-reasoning Test',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test\\session.jsonl',
      });

      const state = bridge.getState();
      state.thinkingLevel = 'high';

      // Switch to a non-reasoning model
      bridge._handleResponse({
        id: 103,
        command: 'set_model',
        success: true,
        data: {
          id: 'gpt-4o-mini',
          provider: 'openai',
          name: 'GPT-4o Mini',
          reasoning: false,
        },
      });

      assert.equal(state.thinkingLevel, 'off', 'thinkingLevel should reset to off for non-reasoning model');
      // Should NOT have sent set_thinking_level with high
      const setThinkingCmd = sentLines.find(cmd => cmd.type === 'set_thinking_level');
      assert.ok(!setThinkingCmd, 'should not send set_thinking_level when resetting to off');
      // Should have sent get_available_thinking_levels
      const getAvailCmd = sentLines.find(cmd => cmd.type === 'get_available_thinking_levels');
      assert.ok(getAvailCmd, 'should query get_available_thinking_levels on model switch');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('cycle_thinking_level on non-reasoning model stays off when omp returns null', async () => {
    const sentLines = [];
    const prevTauri = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'send_command' && args?.json) {
            sentLines.push(JSON.parse(args.json));
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
    };

    try {
      await bridge.resumeSession({
        id: 'test-cycle-non-reasoning',
        title: 'Cycle Non-reasoning Test',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test\\session.jsonl',
      });

      const state = bridge.getState();
      state.model = { id: 'plain-model', name: 'Plain', reasoning: false };
      state.availableThinkingLevels = ['off'];
      state.thinkingLevel = 'off';

      // Simulate cycle_thinking_level command response with null
      bridge._handleResponse({
        id: 104,
        command: 'cycle_thinking_level',
        success: true,
        data: null,
      });

      assert.equal(state.thinkingLevel, 'off', 'should remain off');
      const setCmd = sentLines.find(cmd => cmd.type === 'set_thinking_level');
      assert.ok(!setCmd, 'should not send set_thinking_level for non-reasoning model');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('cycle_thinking_level cycles through model custom efforts (e.g. DeepSeek dual levels)', async () => {
    const sentLines = [];
    const prevTauri = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'send_command' && args?.json) {
            sentLines.push(JSON.parse(args.json));
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
    };

    try {
      await bridge.resumeSession({
        id: 'test-cycle-dual',
        title: 'Cycle Dual Test',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test\\session.jsonl',
      });

      const state = bridge.getState();
      state.model = {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        reasoning: true,
        thinking: { mode: 'effort', efforts: ['low', 'high'], defaultLevel: 'high' },
      };
      state.availableThinkingLevels = ['off', 'low', 'high'];
      state.thinkingLevel = 'off';

      // First cycle: off -> low
      bridge._handleResponse({
        id: 105,
        command: 'cycle_thinking_level',
        success: true,
        data: null,
      });
      assert.equal(state.thinkingLevel, 'low');
      assert.equal(sentLines[sentLines.length - 1].type, 'set_thinking_level');
      assert.equal(sentLines[sentLines.length - 1].level, 'low');

      // Second cycle: low -> high
      bridge._handleResponse({
        id: 106,
        command: 'cycle_thinking_level',
        success: true,
        data: null,
      });
      assert.equal(state.thinkingLevel, 'high');
      assert.equal(sentLines[sentLines.length - 1].level, 'high');

      // Third cycle: high -> off
      bridge._handleResponse({
        id: 107,
        command: 'cycle_thinking_level',
        success: true,
        data: null,
      });
      assert.equal(state.thinkingLevel, 'off');
      assert.equal(sentLines[sentLines.length - 1].level, 'off');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('thinking_level_changed event updates state thinkingLevel', () => {
    const state = bridge.getState();
    state.thinkingLevel = 'low';

    bridge._handleEvent({
      type: 'thinking_level_changed',
      thinkingLevel: 'high',
    });

    assert.equal(state.thinkingLevel, 'high');
  });

  it('refreshModels immediately syncs active state.model and availableThinkingLevels without app restart', async () => {
    const sentLines = [];
    const prevTauri = globalThis.window.__TAURI__;
    const yamlConfig = `
providers:
  deepseek:
    baseUrl: https://api.deepseek.com
    apiKey: sk-test
    api: openai-completions
    models:
      - id: deepseek-chat
        name: DeepSeek V3 (Reasoning Enabled)
        reasoning: true
        thinking:
          mode: effort
          efforts:
            - low
            - high
          defaultLevel: high
`;

    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'read_models_config') {
            return { content: yamlConfig, path: '/models.yml', exists: true };
          }
          if (name === 'send_command' && args?.json) {
            sentLines.push(JSON.parse(args.json));
          }
          if (name === 'is_session_running') return true;
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
    };

    try {
      await bridge.resumeSession({
        id: 'test-instant-refresh',
        title: 'Instant Refresh Test',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test\\session.jsonl',
      });

      const state = bridge.getState();
      // Initially, active model had reasoning disabled
      state.model = {
        id: 'deepseek-chat',
        provider: 'deepseek',
        name: 'DeepSeek V3',
        reasoning: false,
      };
      state.availableThinkingLevels = ['off'];
      state.thinkingLevel = 'off';

      // User modified config and clicked save, triggering refreshModels
      await bridge.refreshModels();

      // Verify that state.model was immediately updated
      assert.equal(state.model.name, 'DeepSeek V3 (Reasoning Enabled)');
      assert.strictEqual(state.model.reasoning, true);
      assert.deepEqual(state.model.thinking.efforts, ['low', 'high']);
      assert.deepEqual(state.availableThinkingLevels, ['off', 'low', 'high']);
      assert.equal(state.thinkingLevel, 'high');

      // Verify that set_thinking_level was sent to omp immediately
      const setThinking = sentLines.find(c => c.type === 'set_thinking_level');
      assert.ok(setThinking, 'should push set_thinking_level to omp');
      assert.equal(setThinking.level, 'high');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('custom model efforts restrict bridge.cycleThinking() and reject stale xhigh from omp', async () => {
    localStorage.clear();
    const sentLines = [];
    const prevTauri = globalThis.window.__TAURI__;
    const yamlConfig = `
providers:
  custom-proxy:
    baseUrl: http://localhost:20128/v1
    apiKey: sk-test
    api: openai-completions
    models:
      - id: mid-quality
        name: mid-quality
        reasoning: true
        thinking:
          mode: effort
          efforts:
            - low
            - medium
            - high
          defaultLevel: medium
`;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'send_command' && args?.json) {
            sentLines.push(JSON.parse(args.json));
          }
          if (name === 'read_models_config') {
            return { content: yamlConfig, path: '/models.yml', exists: true };
          }
          return null;
        },
      },
      event: { listen: async () => () => {} },
    };

    try {
      await bridge.resumeSession({
        id: 'test-custom-efforts-unique',
        title: 'Custom Efforts Test',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test-unique-8\\session.jsonl',
      });

      const state = bridge.getState();
      state.model = {
        id: 'mid-quality',
        provider: 'custom-proxy',
        name: 'mid-quality',
        reasoning: true,
        thinking: { mode: 'effort', efforts: ['low', 'medium', 'high'], defaultLevel: 'medium' },
      };
      state.models = [{ ...state.model }];
      state.availableThinkingLevels = ['off', 'low', 'medium', 'high'];
      state.thinkingLevel = 'off';

      // 1. Client-side cycling through availableThinkingLevels
      bridge.cycleThinking();
      assert.equal(state.thinkingLevel, 'low');
      assert.equal(sentLines[sentLines.length - 1].level, 'low');

      bridge.cycleThinking();
      assert.equal(state.thinkingLevel, 'medium');
      assert.equal(sentLines[sentLines.length - 1].level, 'medium');

      bridge.cycleThinking();
      assert.equal(state.thinkingLevel, 'high');
      assert.equal(sentLines[sentLines.length - 1].level, 'high');

      bridge.cycleThinking();
      assert.equal(state.thinkingLevel, 'off');
      assert.equal(sentLines[sentLines.length - 1].level, 'off');

      // 2. Stale get_state from omp with un-customized model object should not clobber custom efforts
      bridge._handleResponse({
        id: 'mock-test8-get-state',
        command: 'get_state',
        success: true,
        data: {
          model: {
            id: 'mid-quality',
            provider: 'custom-proxy',
            name: 'mid-quality',
            reasoning: true,
            thinking: { mode: 'effort', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
          },
        },
      });
      assert.deepEqual(state.availableThinkingLevels, ['off', 'low', 'medium', 'high']);
      assert.deepEqual(state.model.thinking.efforts, ['low', 'medium', 'high']);

      // 3. Stale cycle_thinking_level response with 'xhigh' must be rejected and clamped to valid levels
      bridge._handleResponse({
        id: 'mock-test8-cycle-thinking',
        command: 'cycle_thinking_level',
        success: true,
        data: { level: 'xhigh' },
      });
      assert.notEqual(state.thinkingLevel, 'xhigh');
      assert.ok(['off', 'low', 'medium', 'high'].includes(state.thinkingLevel));
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });
});


