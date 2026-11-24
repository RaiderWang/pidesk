/**
 * test/live-model-restore.test.mjs
 *
 * Regression: after a custom model was renamed in models.yml, the saved
 * `pidesk:prefs` model was re-pushed to omp by every new session and failed
 * with "Model not found" forever.
 *
 *   - restore failure is silent, clears the model prefs (keeping thinkingLevel),
 *     rolls the UI back to omp's model and re-pushes the thinking level
 *   - a user-initiated set_model failure still shows a notice
 *   - restore + user set_model in flight together are attributed in order
 *   - restore is not gated on state.models (built-in models arrive late)
 *   - refreshModels drops a prefs model that models.yml no longer lists
 *
 * Run: node --test test/live-model-restore.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
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
loadScript('export-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;
const PREFS_KEY = 'pidesk:prefs';
const STALE = { modelId: 'deepseek-v4-flash', modelProvider: 'arkcode', modelName: 'DS' };
const OMP_DEFAULT = { id: 'auto/best-free', provider: 'custom-proxy', reasoning: true };

const prefsNow = () => JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
const notices = (state) => state.messages.filter((m) => m.notice);

let sent;
let modelsYml = '';
let seq = 0;

function installTauri() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        if (name === 'send_command' && args?.json) sent.push(JSON.parse(args.json));
        if (name === 'is_session_running') return true;
        if (name === 'read_models_config') return { content: modelsYml };
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
}

async function freshSession() {
  await bridge.resumeSession({
    id: `restore-${++seq}`,
    title: 'Restore',
    // Distinct path per call: resumeSession reuses an open tab with the same path.
    path: `C:\\Users\\user\\.omp\\agent\\sessions\\test\\session-${seq}.jsonl`,
  });
  return bridge.getState();
}

const getState = () => ({
  id: 1, command: 'get_state', success: true,
  data: { model: OMP_DEFAULT },
});
const setModelFail = () => ({
  id: 2, command: 'set_model', success: false,
  error: 'Model not found: arkcode/deepseek-v4-flash',
});

describe('live.js — saved model preference restore', () => {
  let prevTauri;
  beforeEach(() => {
    prevTauri = globalThis.window.__TAURI__;
    sent = [];
    modelsYml = '';
    localStorage.clear();
    installTauri();
  });

  it('failed restore: silent, clears model prefs, keeps thinkingLevel, rolls back', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...STALE, thinkingLevel: 'high' }));
      const state = await freshSession();

      bridge._handleResponse(getState());
      const req = sent.find((c) => c.type === 'set_model');
      assert.deepEqual([req.provider, req.modelId], ['arkcode', 'deepseek-v4-flash']);
      assert.equal(state.model.id, 'deepseek-v4-flash', 'optimistic until the response');

      sent.length = 0;
      bridge._handleResponse(setModelFail());

      assert.equal(notices(state).length, 0, 'no notice for an automatic restore');
      assert.deepEqual(prefsNow(), { thinkingLevel: 'high' });
      assert.equal(state.model.id, 'auto/best-free');
      assert.equal(state.thinkingLevel, 'high');
      const thinking = sent.find((c) => c.type === 'set_thinking_level');
      assert.ok(thinking, 'thinking level re-pushed to the rolled-back model');
      assert.equal(thinking.level, 'high');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('failed restore with no rpcState model does not throw', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(STALE));
      const state = await freshSession();
      bridge._handleResponse(getState());
      state.rpcState = null;
      assert.doesNotThrow(() => bridge._handleResponse(setModelFail()));
      assert.equal(state.model, null);
      assert.deepEqual(prefsNow(), {});
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('failed user set_model still shows the notice and keeps prefs', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ modelId: 'ok', modelProvider: 'p' }));
      const state = await freshSession();
      await bridge.setModel({ provider: 'arkcode', id: 'gone' });
      assert.ok(sent.some((c) => c.type === 'set_model' && c.modelId === 'gone'));

      bridge._handleResponse(setModelFail());

      assert.equal(notices(state).length, 1);
      assert.ok(notices(state)[0].blocks[0].text.includes('Model not found'));
      assert.equal(prefsNow().modelId, 'ok', 'user failure does not wipe prefs');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('restore + user set_model in flight: failures are attributed in order', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(STALE));
      const state = await freshSession();
      bridge._handleResponse(getState());          // queues "restore"
      await bridge.setModel({ provider: 'p', id: 'm2' }); // queues "user"

      bridge._handleResponse(setModelFail());      // restore → silent
      assert.equal(notices(state).length, 0);
      assert.equal(prefsNow().modelId, undefined);

      bridge._handleResponse(setModelFail());      // user → notice
      assert.equal(notices(state).length, 1);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('same model id under another provider is a different model: set_model is sent', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        modelId: OMP_DEFAULT.id, modelProvider: 'other-provider',
      }));
      await freshSession();
      bridge._handleResponse(getState());
      const req = sent.find((c) => c.type === 'set_model');
      assert.ok(req, 'set_model sent');
      assert.equal(req.provider, 'other-provider');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('identical provider + id: no set_model, thinking level pushed directly', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        modelId: OMP_DEFAULT.id, modelProvider: OMP_DEFAULT.provider, thinkingLevel: 'low',
      }));
      await freshSession();
      bridge._handleResponse(getState());
      assert.equal(sent.filter((c) => c.type === 'set_model').length, 0);
      assert.ok(sent.some((c) => c.type === 'set_thinking_level' && c.level === 'low'));
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('omp model without a provider field is compared by id only', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        modelId: OMP_DEFAULT.id, modelProvider: OMP_DEFAULT.provider,
      }));
      await freshSession();
      bridge._handleResponse({
        id: 1, command: 'get_state', success: true,
        data: { model: { id: OMP_DEFAULT.id } },
      });
      assert.equal(sent.filter((c) => c.type === 'set_model').length, 0);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('restore is not gated on state.models holding only custom entries', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        modelId: 'claude-sonnet', modelProvider: 'anthropic',
      }));
      const state = await freshSession();
      // models.yml finished first; built-in models have not arrived yet.
      state.models = [{ id: 'x', provider: 'custom-proxy', current: true }];

      bridge._handleResponse(getState());

      const req = sent.find((c) => c.type === 'set_model');
      assert.ok(req, 'set_model still sent for a built-in model');
      assert.equal(req.provider, 'anthropic');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('switching tabs drops pending origins so later user failures show a notice', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(STALE));
      await freshSession();
      bridge._handleResponse(getState());          // "restore" pending, response lost
      const state = await freshSession();          // tab switch clears the queue

      bridge._handleResponse(setModelFail());      // arrives with nothing pending

      assert.equal(notices(state).length, 1);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('a successful restore removes its queue entry', async () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ modelId: 'ok', modelProvider: 'p' }));
      const state = await freshSession();
      bridge._handleResponse(getState());
      bridge._handleResponse({
        id: 3, command: 'set_model', success: true,
        data: { id: 'ok', provider: 'p', name: 'OK' },
      });
      bridge._handleResponse(setModelFail());      // a later, unrelated failure
      assert.equal(notices(state).length, 1);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });
});

describe('live.js — refreshModels vs saved model preference', () => {
  let prevTauri;
  beforeEach(() => {
    prevTauri = globalThis.window.__TAURI__;
    sent = [];
    localStorage.clear();
    installTauri();
  });

  const yml = (id) =>
    `providers:\n  arkcode:\n    baseUrl: http://x/v1\n    api: openai-completions\n    models:\n      - id: ${id}\n        name: ${id}\n`;

  it('clears the model prefs when models.yml renamed the saved id', async () => {
    try {
      await freshSession();
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...STALE, thinkingLevel: 'low' }));
      modelsYml = yml('deepseek-v4.1-flash');

      await bridge.refreshModels();

      assert.deepEqual(prefsNow(), { thinkingLevel: 'low' });
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('keeps the prefs while the model is still in models.yml', async () => {
    try {
      await freshSession();
      localStorage.setItem(PREFS_KEY, JSON.stringify(STALE));
      modelsYml = yml('deepseek-v4-flash');

      await bridge.refreshModels();

      assert.equal(prefsNow().modelId, 'deepseek-v4-flash');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('never clears a built-in model preference', async () => {
    try {
      await freshSession();
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        modelId: 'claude-sonnet', modelProvider: 'anthropic',
      }));
      modelsYml = yml('deepseek-v4.1-flash');

      await bridge.refreshModels();

      assert.equal(prefsNow().modelId, 'claude-sonnet');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });
});
