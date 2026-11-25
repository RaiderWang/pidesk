/**
 * test/live-models.test.mjs
 *
 * live/models.js in isolation (collaborators injected): pure level helpers,
 * set_model origin queue (restore vs user failure), pref restore, current-model
 * sync, set_model/cycle responses and client-side thinking cycle.
 *
 * Run: node --test test/live-models.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
// eslint-disable-next-line no-new-func
new Function(readFileSync(join(SRC, 'live/models.js'), 'utf-8'))();

const { Models } = globalThis._Live;
globalThis.NoticeBubble = { make: (text) => ({ kind: 'notice', text }) };
globalThis.timeNow = () => '00:00';
globalThis.t = undefined;

let state, rt, sent, notified, pending, saved, cleared, savedPrefs, h;

beforeEach(() => {
  state = {
    model: null, models: [], rpcState: null, messages: [],
    thinkingLevel: 'off', availableThinkingLevels: [],
  };
  rt = { conn: { activeSessionId: 's1', agentStarting: false } };
  sent = [];
  notified = 0;
  pending = [];
  saved = [];
  cleared = 0;
  savedPrefs = null;
  h = Models.create({
    state, rt,
    notify: () => { notified++; },
    send: cmd => sent.push(cmd),
    sessionRegistry: new Map(),
    pendingSetModel: pending,
    prefs: {
      loadPrefs: () => savedPrefs,
      savePrefs: p => saved.push(p),
      clearModelPrefs: () => { cleared++; },
    },
    customModels: {
      buildModelEntry: m => ({ ...m }),
      mergeModels: (a) => a,
      loadFromConfig: () => Promise.resolve({ customModels: [], customProviders: new Map() }),
    },
  });
});

describe('models — pure helpers', () => {
  it('hasReasoning: flag, thinking config or >1 levels', () => {
    assert.equal(Models.hasReasoning({ model: null }), false);
    assert.equal(Models.hasReasoning({ model: { reasoning: true } }), true);
    assert.equal(Models.hasReasoning({ model: { thinking: { efforts: ['low'] } } }), true);
    assert.equal(Models.hasReasoning({ model: {}, availableThinkingLevels: ['off'] }), false);
    assert.equal(Models.hasReasoning({ model: {}, availableThinkingLevels: ['off', 'low'] }), true);
  });

  it('resolveValidLevels: omp list > model efforts > generic ladder, never "auto"', () => {
    assert.deepEqual(Models.resolveValidLevels({ availableThinkingLevels: ['off', 'high'] }), ['off', 'high']);
    assert.deepEqual(
      Models.resolveValidLevels({ availableThinkingLevels: ['off'], model: { thinking: { efforts: ['low', 'xhigh'] } } }),
      ['off', 'low', 'xhigh'],
    );
    assert.deepEqual(Models.resolveValidLevels({ model: {} }), ['off', 'low', 'medium', 'high']);
  });
});

describe('models — set_model failure handling', () => {
  const fail = error => h.responseHandlers.always.set_model({ command: 'set_model', success: false, error });

  it('success is left to the success table (returns false, queue untouched)', () => {
    pending.push('user');
    assert.equal(h.responseHandlers.always.set_model({ success: true }), false);
    assert.deepEqual(pending, ['user']);
  });

  it('failed "restore": forgets prefs, falls back to the running model, no notice', () => {
    state.rpcState = { model: { id: 'running', provider: 'p' } };
    state.model = { id: 'stale' };
    state.models = [{ id: 'running', provider: 'p' }, { id: 'other' }];
    h.sendSetModel('p', 'stale', 'restore');
    sent.length = 0;

    assert.equal(fail('no such model'), true);
    assert.equal(cleared, 1);
    assert.equal(state.model.id, 'running');
    assert.deepEqual(state.models.map(m => m.current), [true, false]);
    assert.equal(state.messages.length, 0);
    assert.deepEqual(pending, []);
  });

  it('failed "user": appends a notice and keeps prefs', () => {
    h.sendSetModel('p', 'm', 'user');
    assert.equal(fail('boom'), true);
    assert.equal(cleared, 0);
    assert.equal(state.messages.length, 1);
    assert.match(state.messages[0].text, /boom/);
  });

  it('origins are shifted oldest-first (restore then user)', () => {
    h.sendSetModel('p', 'a', 'restore');
    h.sendSetModel('p', 'b', 'user');
    fail('x');
    assert.deepEqual(pending, ['user']);
    fail('y');
    assert.equal(state.messages.length, 1);
    assert.deepEqual(pending, []);
  });
});

describe('models — sending and responses', () => {
  it('sendSetModel queues the origin and sends set_model', () => {
    h.sendSetModel('prov', 'id1', 'user');
    assert.deepEqual(pending, ['user']);
    assert.deepEqual(sent, [{ type: 'set_model', provider: 'prov', modelId: 'id1' }]);
  });

  it('set_model success: adopts model, saves prefs, refreshes levels and state', () => {
    state.models = [{ id: 'm1' }, { id: 'm2' }];
    pending.push('user');
    h.responseHandlers.success.set_model({ id: 'm2', provider: 'p', name: 'Two' });
    assert.deepEqual(pending, []);
    assert.equal(state.model.id, 'm2');
    assert.deepEqual(state.models.map(m => m.current), [false, true]);
    assert.deepEqual(saved[0], { modelId: 'm2', modelProvider: 'p', modelName: 'Two' });
    assert.deepEqual(sent.map(c => c.type), ['get_available_thinking_levels', 'get_state']);
    assert.equal(notified, 1);
  });

  it('pushThinkingLevel: non-reasoning model forces off; otherwise re-pushes level', () => {
    state.thinkingLevel = 'high';
    state.model = { id: 'x', reasoning: false };
    h.pushThinkingLevel();
    assert.equal(state.thinkingLevel, 'off');
    assert.deepEqual(saved, [{ thinkingLevel: 'off' }]);
    assert.equal(sent.length, 0);

    state.thinkingLevel = 'medium';
    state.model = { id: 'x', reasoning: true };
    h.pushThinkingLevel();
    assert.deepEqual(sent, [{ type: 'set_thinking_level', level: 'medium' }]);
  });

  it('cycle_thinking_level response: valid level adopted, bogus one clamped to next', () => {
    state.model = { reasoning: true };
    state.availableThinkingLevels = ['off', 'low', 'high'];
    state.thinkingLevel = 'off';
    h.responseHandlers.success.cycle_thinking_level({ level: 'high' });
    assert.equal(state.thinkingLevel, 'high');
    h.responseHandlers.success.cycle_thinking_level({ level: 'auto' });
    assert.equal(state.thinkingLevel, 'off');
    assert.deepEqual(sent, [{ type: 'set_thinking_level', level: 'off' }]);
  });
});

describe('models — thinking cycle (client-side)', () => {
  it('walks the resolved ladder and wraps', () => {
    state.model = { reasoning: true };
    state.thinkingLevel = 'high';
    h.api.cycleThinking();
    assert.equal(state.thinkingLevel, 'off');
    h.api.cycleThinking();
    assert.equal(state.thinkingLevel, 'low');
    assert.deepEqual(sent.map(c => c.level), ['off', 'low']);
    assert.deepEqual(saved.at(-1), { thinkingLevel: 'low' });
  });

  it('non-reasoning model: stays off, sends nothing', () => {
    state.model = { reasoning: false };
    state.thinkingLevel = 'low';
    h.api.cycleThinking();
    assert.equal(state.thinkingLevel, 'off');
    assert.equal(sent.length, 0);
    assert.equal(notified, 1);
  });
});

describe('models — syncCurrentModel', () => {
  it('copies capabilities from the listed model (same id, other provider ignored)', () => {
    state.model = { id: 'm', provider: 'a' };
    state.models = [
      { id: 'm', provider: 'b', name: 'wrong', reasoning: false },
      { id: 'm', provider: 'a', name: 'right', reasoning: true, thinking: { efforts: ['low', 'high'] } },
    ];
    h.syncCurrentModel();
    assert.equal(state.model.name, 'right');
    assert.deepEqual(state.availableThinkingLevels, ['off', 'low', 'high']);
  });

  it('non-reasoning match: levels collapse to off and a set level is cleared', () => {
    state.model = { id: 'm' };
    state.models = [{ id: 'm', reasoning: false }];
    state.thinkingLevel = 'high';
    h.syncCurrentModel();
    assert.deepEqual(state.availableThinkingLevels, ['off']);
    assert.equal(state.thinkingLevel, 'off');
    assert.deepEqual(sent, [{ type: 'set_thinking_level', level: 'off' }]);
  });

  it('no list or no match: untouched', () => {
    state.model = { id: 'm' };
    h.syncCurrentModel();
    state.models = [{ id: 'other' }];
    h.syncCurrentModel();
    assert.deepEqual(state.model, { id: 'm' });
    assert.equal(sent.length, 0);
  });
});

describe('models — restorePrefs', () => {
  it('different saved model: queues a "restore" set_model and updates optimistically', () => {
    state.model = { id: 'default', provider: 'p' };
    savedPrefs = { modelId: 'mine', modelProvider: 'q', modelName: 'Mine', thinkingLevel: 'high' };
    h.restorePrefs();
    assert.deepEqual(pending, ['restore']);
    assert.deepEqual(sent, [{ type: 'set_model', provider: 'q', modelId: 'mine' }]);
    assert.equal(state.model.id, 'mine');
    assert.equal(state.thinkingLevel, 'high');
  });

  it('same model: only pushes the thinking level', () => {
    state.model = { id: 'mine', provider: 'q' };
    savedPrefs = { modelId: 'mine', modelProvider: 'q', thinkingLevel: 'low' };
    h.restorePrefs();
    assert.deepEqual(pending, []);
    assert.deepEqual(sent, [{ type: 'set_thinking_level', level: 'low' }]);
  });

  it('no saved prefs: does nothing', () => {
    h.restorePrefs();
    assert.equal(sent.length, 0);
  });
});

describe('models — initFetch', () => {
  it('requests state, messages, models and thinking levels in order', () => {
    h.initFetch();
    assert.deepEqual(sent.map(c => c.type), [
      'get_state', 'get_messages', 'get_available_models', 'get_available_thinking_levels',
    ]);
  });
});
