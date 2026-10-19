/**
 * test/live-startup-wait.test.mjs
 *
 * live.js during the post-update grace period (omp still starting):
 * no error banner, "starting" in the snapshot, commands issued meanwhile are
 * queued and delivered once omp is up, a failed start surfaces the real
 * reason, and the three status reads are ordered so a start that finishes
 * mid-check is never reported as a failure.
 *
 * Run: node --test test/live-startup-wait.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');
const loadScript = (rel) => new Function(readFileSync(join(SRC, rel), 'utf-8'))();

loadScript('app/agent-startup-wait.js');
loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('undo-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scripted backend: `status` is mutable, `afterRead` can flip it mid-check. */
function mockTauri(status, { afterRead } = {}) {
  const calls = [];
  const handlers = {};
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        calls.push({ name, args });
        let out = null;
        if (name === 'is_session_starting') out = status.starting;
        else if (name === 'is_session_running') out = status.running;
        else if (name === 'session_status') out = status.error;
        afterRead?.(name);
        return out;
      },
    },
    event: {
      listen: async (evt, cb) => {
        handlers[evt] = cb;
        return () => {};
      },
    },
  };
  return { calls, handlers };
}

const sent = (calls, type) =>
  calls
    .filter((c) => c.name === 'send_command')
    .map((c) => JSON.parse(c.args.json))
    .filter((m) => !type || m.type === type);

describe('live.js — grace-period startup wait', () => {
  it('queues commands while starting and delivers them once omp is running', async () => {
    const prev = globalThis.window.__TAURI__;
    const status = { starting: true, running: false, error: null };
    const { calls } = mockTauri(status);
    let snap = null;
    const off = bridge.onUpdate((s) => { snap = s; });
    try {
      await bridge.resumeSession({ id: 'wait-ok', title: 'w', path: 'C:\\x\\wait-ok.jsonl' });
      const state = bridge.getState();
      assert.equal(state.agentError, null, 'no error banner while starting');
      assert.equal(snap.agentStarting, true);

      bridge.send('hello while starting');
      assert.equal(sent(calls).length, 0, 'nothing reaches omp yet');

      status.starting = false;
      status.running = true;
      await sleep(700);

      assert.equal(snap.agentStarting, false);
      assert.equal(state.agentError, null);
      const types = sent(calls).map((m) => m.type);
      assert.ok(types.includes('get_state'), 'init fetch ran');
      const prompts = sent(calls, 'prompt');
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].message, 'hello while starting');
      assert.ok(types.indexOf('get_state') < types.indexOf('prompt'), 'state fetched before the queued prompt');
    } finally {
      off();
      await bridge.closeSession('wait-ok');
      globalThis.window.__TAURI__ = prev;
    }
  });

  it('surfaces the real spawn error and drops queued commands when the grace period fails', async () => {
    const prev = globalThis.window.__TAURI__;
    const status = { starting: true, running: false, error: null };
    const { calls } = mockTauri(status);
    let snap = null;
    const off = bridge.onUpdate((s) => { snap = s; });
    try {
      await bridge.resumeSession({ id: 'wait-fail', title: 'w', path: 'C:\\x\\wait-fail.jsonl' });
      bridge.send('never delivered');

      status.starting = false;
      status.error = 'failed to spawn omp (omp.exe: not found). Make sure omp is installed and on PATH.';
      await sleep(700);

      const state = bridge.getState();
      assert.equal(state.agentError, status.error);
      assert.equal(snap.agentStarting, false);
      assert.equal(sent(calls, 'prompt').length, 0);
    } finally {
      off();
      await bridge.closeSession('wait-fail');
      globalThis.window.__TAURI__ = prev;
    }
  });

  it('a start that finishes between the status reads is not reported as a failure', async () => {
    const prev = globalThis.window.__TAURI__;
    const status = { starting: true, running: false, error: null };
    // The backend finishes right after the `starting` read.
    mockTauri(status, {
      afterRead: (name) => {
        if (name === 'is_session_starting') {
          status.starting = false;
          status.running = true;
        }
      },
    });
    try {
      await bridge.resumeSession({ id: 'wait-race', title: 'w', path: 'C:\\x\\wait-race.jsonl' });
      const state = bridge.getState();
      assert.equal(state.agentError, null, 'no false "not running" banner');
    } finally {
      await bridge.closeSession('wait-race');
      globalThis.window.__TAURI__ = prev;
    }
  });

  it('setModel does not pre-empt a start in progress', async () => {
    const prev = globalThis.window.__TAURI__;
    const status = { starting: true, running: false, error: null };
    const { calls } = mockTauri(status);
    try {
      await bridge.resumeSession({ id: 'wait-model', title: 'w', path: 'C:\\x\\wait-model.jsonl' });
      const startsBefore = calls.filter((c) => c.name === 'start_session').length;
      await bridge.setModel({ provider: 'p', id: 'm' });
      assert.equal(calls.filter((c) => c.name === 'start_session').length, startsBefore);
      assert.equal(sent(calls, 'set_model').length, 0, 'queued, not sent early');
    } finally {
      await bridge.closeSession('wait-model');
      globalThis.window.__TAURI__ = prev;
    }
  });
});
