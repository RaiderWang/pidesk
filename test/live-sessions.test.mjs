/**
 * test/live-sessions.test.mjs
 *
 * live/sessions.js + live/session-branch.js in isolation with a fake Tauri:
 * git-watch wiring, opening/resuming tabs (de-dup of an already open saved
 * session), closing (last-tab reset, active-tab fallback), retry, and the
 * branch refusal paths (never a silent full copy).
 *
 * Run: node --test test/live-sessions.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['live/defaults.js', 'live/runtime.js', 'live/sessions.js', 'live/session-branch.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}

const { Runtime, Sessions, SessionBranch, Defaults } = globalThis._Live;

let runtime, state, rt, reg, snaps, gitListeners, queues, login, invoked, listeners, handlers, switched, notified;
let invokeImpl, h;

beforeEach(() => {
  reg = new Map();
  snaps = new Map();
  gitListeners = new Map();
  queues = new Map();
  login = new Map();
  invoked = [];
  listeners = [];
  handlers = new Map();
  switched = [];
  notified = 0;
  invokeImpl = async () => null;
  globalThis.__TAURI__ = {
    core: { invoke: (cmd, args) => { invoked.push([cmd, args]); return Promise.resolve(invokeImpl(cmd, args)); } },
    event: {
      listen: async (name, cb) => {
        listeners.push(name);
        handlers.set(name, cb);
        return () => { listeners.splice(listeners.indexOf(name), 1); handlers.delete(name); };
      },
    },
  };
  globalThis.PeerSessionBridge = { clearIfMatch: () => {}, build: () => null, id: null };
  runtime = Runtime.create({ defaults: Defaults, sessionRegistry: reg, sessionSnapshots: snaps, pendingSetModel: [] });
  ({ state, rt } = runtime);
  let resets = 0;
  h = {
    resetCount: () => resets,
    ...Sessions.create({
      state, rt, runtime,
      notify: () => { notified++; },
      sessionRegistry: reg, sessionSnapshots: snaps, gitListeners,
      startQueues: queues, loginInFlight: login,
      resetSession: () => { resets++; },
      switchToSession: async (id, opts) => { switched.push([id, opts]); rt.conn.activeSessionId = id; },
    }),
  };
});

afterEach(() => { delete globalThis.__TAURI__; });

describe('sessions — attachGitWatch', () => {
  it('stores the initial branch and re-reads on git://branch events', async () => {
    reg.set('s1', { id: 's1', path: '/p', branch: null });
    invokeImpl = (cmd) => (cmd === 'start_git_watch' ? 'main' : null);
    await h.attachGitWatch('s1', '/p');
    assert.equal(reg.get('s1').branch, 'main');
    assert.deepEqual(listeners, ['git://branch/s1']);
    assert.ok(gitListeners.has('s1'));

    handlers.get('git://branch/s1')({ payload: 'feature/x' });
    assert.equal(reg.get('s1').branch, 'feature/x');
    assert.equal(notified, 1);
  });

  it('an event for a tab closed meanwhile is ignored but still notifies', async () => {
    reg.set('s1', { id: 's1', path: '/p', branch: null });
    await h.attachGitWatch('s1', '/p');
    reg.delete('s1');
    handlers.get('git://branch/s1')({ payload: 'x' });
    assert.ok(!reg.has('s1'));
    assert.equal(notified, 1);
  });

  it('no cwd (standalone): does nothing', async () => {
    await h.attachGitWatch('s1', '');
    assert.equal(invoked.length, 0);
  });
});

describe('sessions — openSession', () => {
  it('registers the tab, starts omp, arms git watch and activates', async () => {
    const id = await h.api.openSession('/work/proj');
    assert.equal(reg.get(id).path, '/work/proj');
    assert.deepEqual(invoked.map(c => c[0]), ['start_session', 'start_git_watch']);
    assert.deepEqual(invoked[0][1], { sessionId: id, cwd: '/work/proj' });
    assert.deepEqual(switched, [[id, undefined]]);
  });

  it('standalone tab: empty path, no git watch', async () => {
    const id = await h.api.openSession(null);
    assert.equal(reg.get(id).path, '');
    assert.deepEqual(invoked.map(c => c[0]), ['start_session']);
  });

  it('a failing start_session still registers and switches (error surfaces via the banner)', async () => {
    invokeImpl = (cmd) => { if (cmd === 'start_session') throw new Error('no omp'); };
    const id = await h.api.openSession(null);
    assert.ok(reg.has(id));
    assert.equal(switched.length, 1);
  });
});

describe('sessions — resumeSession', () => {
  it('already open (sessionPath match): activates the existing tab', async () => {
    reg.set('t1', { id: 't1', sessionPath: 'C:\\x\\a.jsonl' });
    rt.conn.activeSessionId = 'other';
    reg.set('other', { id: 'other' });
    const id = await h.api.resumeSession({ path: 'c:/x/a.jsonl', id: 'a' });
    assert.equal(id, 't1');
    assert.deepEqual(switched, [['t1', undefined]]);
    assert.equal(invoked.length, 0);
  });

  it('already open (savedSessionId match)', async () => {
    reg.set('t1', { id: 't1', savedSessionId: 'abc' });
    rt.conn.activeSessionId = 'x';
    reg.set('x', { id: 'x' });
    assert.equal(await h.api.resumeSession({ path: '/other/b.jsonl', id: 'abc' }), 't1');
  });

  it('already open (a background tab whose snapshot reports that file) binds the path', async () => {
    reg.set('t1', { id: 't1' });
    snaps.set('t1', { rpcState: { sessionFile: '/s/c.jsonl' } });
    rt.conn.activeSessionId = 'x';
    reg.set('x', { id: 'x' });
    assert.equal(await h.api.resumeSession({ path: '/s/c.jsonl', id: 'c' }), 't1');
    assert.equal(reg.get('t1').sessionPath, '/s/c.jsonl');
  });

  it('new tab: starts omp with --resume and keeps the project cwd', async () => {
    const id = await h.api.resumeSession({ path: '/s/d.jsonl', id: 'd', cwd: '/proj', title: 'Hello' });
    const start = invoked.find(c => c[0] === 'start_session');
    assert.deepEqual(start[1], { sessionId: id, cwd: '/proj', resume: '/s/d.jsonl' });
    assert.equal(reg.get(id).sessionPath, '/s/d.jsonl');
    assert.equal(reg.get(id).savedSessionId, 'd');
  });

  it('standalone history resumes project-less (empty cwd, no git watch)', async () => {
    const id = await h.api.resumeSession({ path: '/s/e.jsonl', id: 'e', cwd: '/old/exe/dir', is_standalone: true });
    assert.equal(reg.get(id).path, '');
    assert.equal(invoked.find(c => c[0] === 'start_session')[1].cwd, '');
    assert.ok(!invoked.some(c => c[0] === 'start_git_watch'));
  });

  it('invalid input returns null', async () => {
    assert.equal(await h.api.resumeSession(null), null);
    assert.equal(await h.api.resumeSession({}), null);
  });
});

describe('sessions — activate / close / retry', () => {
  it('activateSession ignores the active tab and unknown ids', async () => {
    reg.set('a', { id: 'a' });
    rt.conn.activeSessionId = 'a';
    await h.api.activateSession('a');
    await h.api.activateSession('ghost');
    assert.equal(switched.length, 0);
    reg.set('b', { id: 'b' });
    await h.api.activateSession('b');
    assert.deepEqual(switched, [['b', undefined]]);
  });

  it('closing the active tab switches to the last remaining one', async () => {
    reg.set('a', { id: 'a' });
    reg.set('b', { id: 'b' });
    reg.set('c', { id: 'c' });
    rt.conn.activeSessionId = 'c';
    queues.set('c', ['x']);
    await h.api.closeSession('c');
    assert.ok(!reg.has('c'));
    assert.ok(!queues.has('c'));
    assert.deepEqual(switched, [['b', undefined]]);
    const cmds = invoked.map(c => c[0]);
    assert.ok(cmds.includes('stop_session') && cmds.includes('stop_git_watch'));
  });

  it('closing a background tab only notifies', async () => {
    reg.set('a', { id: 'a' });
    reg.set('b', { id: 'b' });
    rt.conn.activeSessionId = 'a';
    await h.api.closeSession('b');
    assert.equal(switched.length, 0);
    assert.equal(notified, 1);
  });

  it('closing the last tab resets state and opens a fresh standalone tab', async () => {
    reg.set('a', { id: 'a' });
    rt.conn.activeSessionId = 'a';
    let unlistened = 0;
    rt.conn.activeListeners = [() => { unlistened++; }];
    await h.api.closeSession('a');
    assert.equal(unlistened, 1);
    assert.equal(h.resetCount(), 1);
    assert.equal(reg.size, 1);
    assert.equal([...reg.values()][0].path, '');
    assert.equal(switched.length, 1);
  });

  it('closing releases the git listener', async () => {
    let called = 0;
    gitListeners.set('b', () => { called++; });
    reg.set('a', { id: 'a' });
    reg.set('b', { id: 'b' });
    rt.conn.activeSessionId = 'a';
    await h.api.closeSession('b');
    assert.equal(called, 1);
    assert.ok(!gitListeners.has('b'));
  });

  it('retrySession: clears the error, restarts, then switches; failure keeps the error', async () => {
    reg.set('a', { id: 'a', path: '/p' });
    rt.conn.activeSessionId = 'a';
    state.agentError = 'old';
    await h.api.retrySession();
    assert.equal(state.agentError, null);
    assert.deepEqual(invoked[0], ['start_session', { sessionId: 'a', cwd: '/p' }]);
    assert.deepEqual(switched, [['a', undefined]]);

    switched.length = 0;
    invokeImpl = () => { throw new Error('still missing'); };
    await h.api.retrySession();
    assert.equal(state.agentError, 'still missing');
    assert.equal(switched.length, 0);
  });
});

describe('session-branch — refusal paths', () => {
  let branch, sendWith;
  const notices = () => state.messages.map(m => m.text ?? m.blocks?.[0]?.text);

  beforeEach(() => {
    globalThis.NoticeBubble = { make: (text) => ({ kind: 'notice', text }) };
    globalThis.timeNow = () => '00:00';
    globalThis.t = (key) => key;
    globalThis.BranchSession = {
      pickSourcePath: (sessions) => sessions?.[0]?.path ?? null,
      resolveTarget: () => null,
    };
    reg.set('a', { id: 'a', name: 'Main', path: '/p' });
    rt.conn.activeSessionId = 'a';
    sendWith = async () => ({ entries: [], leafId: null });
    const build = () => SessionBranch.create({
      state, rt, runtime, notify: () => { notified++; }, sessionRegistry: reg,
      sendWithResponse: (...a) => sendWith(...a),
      attachGitWatch: async () => {},
      switchToSession: async (id) => { switched.push([id]); },
    }).api.branch;
    branch = build();
  });

  it('no saved session file: refuses with branch.fail.noSession', async () => {
    invokeImpl = (cmd) => (cmd === 'list_saved_sessions' ? [] : null);
    await branch();
    assert.deepEqual(notices(), ['branch.fail.noSession']);
    assert.ok(!invoked.some(c => c[0] === 'copy_session_file'));
  });

  it('cannot locate the bubble: refuses instead of copying everything', async () => {
    invokeImpl = (cmd) => (cmd === 'list_saved_sessions' ? [{ path: '/s/a.jsonl' }] : null);
    await branch(3);
    assert.deepEqual(notices(), ['branch.fail.locate']);
    assert.ok(!invoked.some(c => c[0] === 'copy_session_file'));
  });

  it('tab switched while resolving: stays silent', async () => {
    invokeImpl = (cmd) => (cmd === 'list_saved_sessions' ? [{ path: '/s/a.jsonl' }] : null);
    sendWith = async () => { rt.conn.activeSessionId = 'other'; return { entries: [] }; };
    await branch(1);
    assert.deepEqual(notices(), []);
    assert.ok(!invoked.some(c => c[0] === 'copy_session_file'));
  });

  it('happy path: copies at the resolved entry, resumes the fork in a new tab', async () => {
    invokeImpl = (cmd) => {
      if (cmd === 'list_saved_sessions') return [{ path: '/s/a.jsonl' }];
      if (cmd === 'copy_session_file') return '/s/fork.jsonl';
      return null;
    };
    globalThis.BranchSession.resolveTarget = () => 'entry-9';
    await branch(2);
    const copy = invoked.find(c => c[0] === 'copy_session_file')[1];
    assert.deepEqual(copy, { sourcePath: '/s/a.jsonl', maxMessages: null, untilEntryId: 'entry-9' });
    const start = invoked.find(c => c[0] === 'start_session')[1];
    assert.equal(start.resume, '/s/fork.jsonl');
    assert.equal(start.cwd, '/p');
    const fork = [...reg.values()].find(e => e.sessionPath === '/s/fork.jsonl');
    assert.equal(fork.name, 'Main (fork)');
    assert.equal(switched.length, 1);
  });

  it('copy failure: reports branch.fail.generic', async () => {
    invokeImpl = (cmd) => {
      if (cmd === 'list_saved_sessions') return [{ path: '/s/a.jsonl' }];
      if (cmd === 'copy_session_file') throw new Error('disk full');
      return null;
    };
    await branch();
    assert.deepEqual(notices(), ['branch.fail.generic']);
  });
});
