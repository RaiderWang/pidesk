/**
 * test/live-session-switch.test.mjs
 *
 * live/session-switch.js in isolation with a fake Tauri: ordering around the
 * bridges-idle wait and snapshot, what is cleared on every switch, snapshot
 * restore vs fresh start, the starting → running → status read order, the
 * startup-wait path and the agent://exit cleanup.
 *
 * Run: node --test test/live-session-switch.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
// eslint-disable-next-line no-new-func
new Function(readFileSync(join(SRC, 'live/session-switch.js'), 'utf-8'))();
const { SessionSwitch } = globalThis._Live;

let state, rt, log, invoked, status, handlers, waitOpts, pendingSetModel, queues, login;
let restoreResult, switcher, resetCount;

const lastSwitch = (id = 's2', opts) => switcher.switchToSession(id, opts);

beforeEach(() => {
  state = { agentError: null, isStreaming: true };
  rt = {
    session: { sessionFresh: null },
    conn: { activeSessionId: 's1', activeListeners: [], agentStarting: false, startWaitSeq: 0 },
  };
  log = [];
  invoked = [];
  handlers = new Map();
  waitOpts = null;
  restoreResult = true;
  resetCount = 0;
  pendingSetModel = ['user', 'restore'];
  queues = new Map([['s2', ['queued']]]);
  login = new Map([['s2', 1]]);
  status = { starting: false, running: true, error: null };

  globalThis.__TAURI__ = {
    core: {
      invoke: async (cmd) => {
        invoked.push(cmd);
        if (cmd === 'is_session_starting') return status.starting;
        if (cmd === 'is_session_running') return status.running;
        if (cmd === 'session_status') return status.error;
        return null;
      },
    },
    event: {
      listen: async (name, cb) => { handlers.set(name, cb); return () => { log.push(`unlisten ${name}`); }; },
    },
  };
  globalThis.PeerSessionBridge = { clearIfMatch: id => log.push(`peer ${id}`) };
  globalThis.AgentStartupWait = { waitUntilStarted: opts => { waitOpts = opts; } };
  globalThis.t = undefined;

  switcher = SessionSwitch.create({
    state, rt,
    runtime: {
      save: () => log.push('save'),
      restore: () => restoreResult,
    },
    notify: () => log.push('notify'),
    pendingSetModel, startQueues: queues, loginInFlight: login,
    ui: { resetHandshake: () => log.push('resetHandshake') },
    resetSession: () => { resetCount++; },
    settleInFlightActions: o => log.push(['settle', o]),
    handleLine: line => log.push(['line', line]),
    initFetch: () => log.push('initFetch'),
    onAgentStarted: () => log.push('onAgentStarted'),
    awaitBridgesIdle: async () => { log.push('idle'); },
  });
});

afterEach(() => { delete globalThis.__TAURI__; delete globalThis.AgentStartupWait; });

describe('session-switch — preparation', () => {
  it('without Tauri it does nothing', async () => {
    delete globalThis.__TAURI__;
    await lastSwitch();
    assert.deepEqual(log, []);
    assert.equal(rt.conn.activeSessionId, 's1');
  });

  it('waits for bridges, then snapshots, then drops the handshake', async () => {
    await lastSwitch();
    const i = n => log.indexOf(n);
    assert.ok(i('idle') >= 0 && i('idle') < i('save'));
    assert.ok(i('save') < i('resetHandshake'));
    assert.equal(log[0], 'peer s2');
  });

  it('clears in-flight set_model origins and tears down the old listeners', async () => {
    let torn = 0;
    rt.conn.activeListeners = [() => { torn++; }, () => { torn++; }];
    await lastSwitch();
    assert.deepEqual(pendingSetModel, []);
    assert.equal(torn, 2);
    assert.equal(rt.conn.activeSessionId, 's2');
    assert.equal(rt.conn.activeListeners.length, 2);
    assert.deepEqual([...handlers.keys()], ['agent://line/s2', 'agent://exit/s2']);
  });
});

describe('session-switch — snapshot vs fresh', () => {
  it('restores a cached snapshot without resetting; prefs are not re-applied', async () => {
    await lastSwitch();
    assert.equal(resetCount, 0);
    assert.equal(rt.session.sessionFresh, false);
  });

  it('no snapshot: resets and marks the session fresh', async () => {
    restoreResult = false;
    await lastSwitch();
    assert.equal(resetCount, 1);
    assert.equal(rt.session.sessionFresh, true);
  });

  it('`fresh` ignores an existing snapshot', async () => {
    await lastSwitch('s2', { fresh: true });
    assert.equal(resetCount, 1);
    assert.equal(rt.session.sessionFresh, true);
  });
});

describe('session-switch — process status', () => {
  it('reads starting first and session_status last', async () => {
    await lastSwitch();
    assert.deepEqual(invoked, ['is_session_starting', 'is_session_running', 'session_status']);
  });

  it('running: clears the error and re-fetches', async () => {
    state.agentError = 'old';
    await lastSwitch();
    assert.equal(state.agentError, null);
    assert.ok(log.includes('initFetch'));
  });

  it('cached startup error wins, drops the start queue, still re-fetches', async () => {
    status = { starting: false, running: false, error: ' omp not found ' };
    await lastSwitch();
    assert.equal(state.agentError, 'omp not found');
    assert.equal(state.isStreaming, false);
    assert.ok(!queues.has('s2'));
    assert.ok(log.includes('initFetch'));
  });

  it('neither running nor starting: generic not-running error', async () => {
    status = { starting: false, running: false, error: null };
    await lastSwitch();
    assert.match(state.agentError, /not running/);
  });

  it('starting: waits for the process instead of failing or fetching', async () => {
    status = { starting: true, running: false, error: null };
    await lastSwitch();
    assert.equal(rt.conn.agentStarting, true);
    assert.equal(state.agentError, null);
    assert.ok(!log.includes('initFetch'));
    assert.ok(waitOpts);

    waitOpts.onRunning();
    assert.ok(log.includes('onAgentStarted'));

    waitOpts.onFailed('spawn failed');
    assert.equal(state.agentError, 'spawn failed');
    assert.equal(rt.conn.agentStarting, false);
  });

  it('the startup wait is stale once another switch happened', async () => {
    status = { starting: true, running: false, error: null };
    await lastSwitch();
    assert.equal(waitOpts.isCurrent(), true);
    rt.conn.startWaitSeq++;
    assert.equal(waitOpts.isCurrent(), false);
    rt.conn.startWaitSeq--;
    rt.conn.activeSessionId = 's3';
    assert.equal(waitOpts.isCurrent(), false);
  });
});

describe('session-switch — listeners', () => {
  it('stdout lines are forwarded to handleLine', async () => {
    await lastSwitch();
    handlers.get('agent://line/s2')({ payload: '{"type":"ready"}' });
    assert.deepEqual(log.at(-1), ['line', '{"type":"ready"}']);
  });

  it('agent://exit: records the reason, settles actions, forgets the login, notifies', async () => {
    await lastSwitch();
    log.length = 0;
    handlers.get('agent://exit/s2')({ payload: 'crashed' });
    assert.equal(state.agentError, 'crashed');
    assert.equal(state.isStreaming, false);
    assert.deepEqual(log[0], ['settle', { aborted: true }]);
    assert.ok(!login.has('s2'));
    assert.equal(log.at(-1), 'notify');
  });

  it('agent://exit with an empty payload falls back to the generic error', async () => {
    await lastSwitch();
    handlers.get('agent://exit/s2')({ payload: '' });
    assert.match(state.agentError, /not running/);
  });
});
