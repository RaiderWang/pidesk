/**
 * test/live-session-restart.test.mjs
 *
 * OMP_BRIDGE.restartActiveSession(): respawn the active tab's omp so it
 * re-reads models.yml, resuming the same session file and keeping the UI
 * history. Refuses while a turn runs.
 *
 * Run: node --test test/live-session-restart.test.mjs
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
const SESSION_FILE = 'C:\\Users\\user\\.omp\\agent\\sessions\\proj\\restart.jsonl';

let calls;
let startError;
let seq = 0;

function installTauri() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        calls.push({ name, args });
        if (name === 'start_session' && startError) throw new Error(startError);
        if (name === 'is_session_running') return true;
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
}

async function openTab() {
  await bridge.resumeSession({
    id: `restart-${++seq}`,
    title: 'Restart',
    path: `C:\\Users\\user\\.omp\\agent\\sessions\\proj\\restart-${seq}.jsonl`,
  });
  return bridge.getState();
}

const starts = () => calls.filter((c) => c.name === 'start_session');

describe('live.js — restartActiveSession', () => {
  let prevTauri;
  beforeEach(() => {
    prevTauri = globalThis.window.__TAURI__;
    calls = [];
    startError = null;
    installTauri();
  });

  it('respawns with --resume of the rpc session file and keeps the history', async () => {
    try {
      const state = await openTab();
      state.rpcState = { sessionFile: SESSION_FILE };
      state.messages = [{ kind: 'user', text: 'hello', time: 't' }];
      calls.length = 0;

      const r = await bridge.restartActiveSession();

      assert.deepEqual(r, { ok: true });
      assert.equal(starts().length, 1);
      assert.equal(starts()[0].args.resume, SESSION_FILE);
      assert.ok(
        state.messages.some((m) => m.kind === 'user' && m.text === 'hello'),
        'conversation survives the respawn',
      );
      assert.ok(calls.some((c) => c.name === 'send_command'), 'init fetch re-issued to the new process');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('refuses while a turn is streaming and does not touch the process', async () => {
    try {
      const state = await openTab();
      state.rpcState = { sessionFile: SESSION_FILE };
      state.isStreaming = true;
      calls.length = 0;

      assert.deepEqual(await bridge.restartActiveSession(), { ok: false, reason: 'busy' });
      assert.equal(starts().length, 0);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('refuses a conversation without a session file instead of dropping its history', async () => {
    try {
      // openSession tabs carry neither sessionFile nor sessionPath.
      await bridge.openSession('');
      const state = bridge.getState();
      state.rpcState = null;
      state.messages = [{ kind: 'user', text: 'hello', time: 't' }];
      calls.length = 0;

      assert.deepEqual(await bridge.restartActiveSession(), { ok: false, reason: 'no-session-file' });
      assert.equal(starts().length, 0);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('a just-resumed tab (no get_state yet) resumes from its registry sessionPath', async () => {
    try {
      const state = await openTab();
      state.rpcState = null;
      state.messages = [{ kind: 'user', text: 'hello', time: 't' }];
      calls.length = 0;

      const r = await bridge.restartActiveSession();

      assert.deepEqual(r, { ok: true });
      assert.match(starts()[0].args.resume, /restart-\d+\.jsonl$/);
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  describe('saved model prefs after the respawn', () => {
    const PREFS = { modelId: 'tab-b-model', modelProvider: 'prov-b', thinkingLevel: 'high' };
    const rpc = (model, extra = {}) => ({
      id: 1, command: 'get_state', success: true, data: { model, ...extra },
    });
    const setModels = () => calls.filter(
      (c) => c.name === 'send_command' && JSON.parse(c.args.json).type === 'set_model',
    );

    it('with --resume the global prefs are NOT pushed (omp restores the session model)', async () => {
      try {
        localStorage.setItem('pidesk:prefs', JSON.stringify(PREFS));
        const state = await openTab();
        state.rpcState = { sessionFile: SESSION_FILE };
        state.messages = [{ kind: 'user', text: 'hello', time: 't' }];
        state.thinkingLevel = 'low';
        calls.length = 0;

        await bridge.restartActiveSession();
        bridge._handleResponse(rpc({ id: 'tab-a-model', provider: 'prov-a', reasoning: true }));

        assert.equal(setModels().length, 0, 'another tab’s last-used model is not forced on this one');
        assert.equal(state.model.id, 'tab-a-model');
        assert.equal(state.thinkingLevel, 'low');
        assert.ok(state.messages.some((m) => m.text === 'hello'));
      } finally {
        localStorage.clear();
        globalThis.window.__TAURI__ = prevTauri;
      }
    });

    it('an empty tab restarts as a new session and gets the saved prefs', async () => {
      try {
        localStorage.setItem('pidesk:prefs', JSON.stringify(PREFS));
        await bridge.openSession('');
        const state = bridge.getState();
        state.rpcState = null;
        state.messages = [{ kind: 'assistant', notice: true, blocks: [] }];
        calls.length = 0;

        const r = await bridge.restartActiveSession();
        assert.deepEqual(r, { ok: true });
        assert.equal(starts()[0].args.resume, undefined);
        assert.equal(state.messages.length, 0, 'blank state, like a new tab');

        bridge._handleResponse(rpc({ id: 'default-model', provider: 'prov-d', reasoning: true }));

        const req = setModels()[0];
        assert.ok(req, 'saved model is pushed to the new process');
        assert.deepEqual(
          [JSON.parse(req.args.json).provider, JSON.parse(req.args.json).modelId],
          ['prov-b', 'tab-b-model'],
        );
        assert.equal(state.thinkingLevel, 'high');
      } finally {
        localStorage.clear();
        globalThis.window.__TAURI__ = prevTauri;
      }
    });
  });

  it('reports a spawn failure and surfaces it as the agent error', async () => {
    try {
      const state = await openTab();
      state.rpcState = { sessionFile: SESSION_FILE };
      startError = 'spawn failed';

      const r = await bridge.restartActiveSession();

      assert.deepEqual(r, { ok: false, reason: 'start-failed', error: 'spawn failed' });
      assert.equal(state.agentError, 'spawn failed');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });
});
