/**
 * test/live-undo.test.mjs
 *
 * OMP_BRIDGE.undoMessage (undo-bridge.js wired through live.js) against a
 * stubbed Tauri `send_command` that answers omp RPC requests.
 *
 * Run: node --test test/live-undo.test.mjs
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
function loadScript(rel) {
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}

loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('undo-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;
const OLD_FILE = 'C:\\sessions\\proj\\old.jsonl';
const NEW_FILE = 'C:\\sessions\\proj\\new.jsonl';

// ── omp RPC stub ────────────────────────────────────────────────────────
const calls = [];
let handlers = {};

function installTauri() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        if (name !== 'send_command') return null;
        const cmd = JSON.parse(args.json);
        calls.push(cmd);
        const h = handlers[cmd.type];
        if (h && cmd.id) {
          setTimeout(async () => {
            const out = await h(cmd); // handlers may be async to hold a response back
            const resp = out && out.__error
              ? { type: 'response', id: cmd.id, command: cmd.type, success: false, error: out.__error }
              : { type: 'response', id: cmd.id, command: cmd.type, success: true, data: out };
            bridge._handleResponse(resp);
          }, 0);
        }
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
}

let seq = 0;
function entry(role, text, parentId) {
  return { type: 'message', id: `e${++seq}`, parentId, message: { role, content: [{ type: 'text', text }] } };
}
function transcript(turns) {
  const out = [];
  let parent = null;
  for (const [u, a] of turns) {
    const ue = entry('user', u, parent);
    const ae = entry('assistant', a, ue.id);
    out.push(ue, ae);
    parent = ae.id;
  }
  return out;
}
const uiUser = (text, extra = {}) => ({ kind: 'user', time: '00:00:00', text, images: [], ...extra });
const uiAsst = (text) => ({ kind: 'assistant', time: '00:00:00', blocks: [{ type: 'text', text }], completed: true });

let tabId;
before(async () => {
  installTauri();
  tabId = await bridge.resumeSession({
    id: 'undo-sess', title: 'Undo', path: OLD_FILE, cwd: '', is_standalone: true,
  });
  // omp reports the file it is writing; this binds the tab to OLD_FILE.
  bridge._handleResponse({
    type: 'response', command: 'get_state', success: true,
    data: { isStreaming: false, sessionFile: OLD_FILE, sessionId: 'undo-sess' },
  });
});

function setup({ messages, entries }) {
  calls.length = 0;
  const st = bridge.getState();
  st.messages = messages;
  st.isStreaming = false;
  st.hasPendingAsyncWork = false;
  st.rpcState = { ...(st.rpcState ?? {}), isCompacting: false };
  st.kanban = [{ id: 'stale' }];
  st.hubAgents = [{ id: 'sub1', status: 'ok' }];
  st.toolLogs = { tc_old: { status: 'done' } };
  st.sessionCost = 1.5;
  const leaf = entries[entries.length - 1].id;
  handlers = {
    get_entries: () => ({ entries, leafId: leaf }),
    branch: (cmd) => ({ text: entries.find((e) => e.id === cmd.entryId).message.content[0].text, cancelled: false }),
    get_state: () => ({ isStreaming: false, sessionFile: NEW_FILE, sessionId: 'new-id', todoPhases: [] }),
  };
  return st;
}

describe('OMP_BRIDGE.undoMessage', () => {
  beforeEach(() => { handlers = {}; });

  it('branches at the resolved entry, truncates the list and re-binds the tab', async () => {
    const entries = transcript([['one', 'A1'], ['two', 'A2'], ['three', 'A3']]);
    const st = setup({
      messages: [uiUser('one'), uiAsst('A1'), uiUser('two'), uiAsst('A2'), uiUser('three'), uiAsst('A3')],
      entries,
    });

    const r = await bridge.undoMessage(2);

    assert.equal(r.ok, true);
    assert.equal(r.text, 'two');
    assert.equal(r.planFramingStripped, false);
    assert.deepEqual(calls.map((c) => c.type), ['get_entries', 'branch', 'get_state']);
    assert.equal(calls[1].entryId, entries[2].id, 'branch must target the second user entry');

    // Everything from the undone bubble on is gone.
    assert.deepEqual(st.messages.map((m) => m.text ?? m.blocks?.[0]?.text), ['one', 'A1']);
    // Derived state reset.
    assert.deepEqual(st.kanban, []);
    assert.deepEqual(st.hubAgents, []);
    // toolLogs are keyed by unique toolCallId and are not pruned by an undo.
    assert.deepEqual(st.toolLogs, { tc_old: { status: 'done' } });
    assert.equal(st.sessionCost, null);

    // Tab is now bound to omp's new file, not the backup.
    const tab = bridge.getSessions().find((s) => s.id === tabId);
    assert.equal(tab.sessionFile, NEW_FILE);
    assert.equal(tab.sessionPath, NEW_FILE);
    assert.equal(tab.savedSessionId, 'new-id');
  });

  it('hands the original images back to the caller', async () => {
    const entries = transcript([['look', 'ok']]);
    entries[0].message.content.push({ type: 'image', data: 'QUJD', mimeType: 'image/png' });
    const img = { type: 'image', data: 'QUJD', mimeType: 'image/png' };
    setup({ messages: [uiUser('look', { images: [img] }), uiAsst('ok')], entries });

    const r = await bridge.undoMessage(0);
    assert.equal(r.ok, true);
    assert.deepEqual(r.images, [img]);
    assert.equal(bridge.getState().messages.length, 0, 'undoing the first message empties the chat');
  });

  it('strips plan-mode framing from the restored text', async () => {
    const wrapped = globalThis.t('plan.intentFraming', { intent: 'build it' }, undefined, 'en');
    const entries = transcript([[wrapped, 'plan...']]);
    setup({ messages: [uiUser(wrapped), uiAsst('plan...')], entries });

    const r = await bridge.undoMessage(0);
    assert.equal(r.ok, true);
    assert.equal(r.text, 'build it');
    assert.equal(r.planFramingStripped, true);
  });

  it('leaves state untouched when omp reports the branch as cancelled', async () => {
    const entries = transcript([['one', 'A1'], ['two', 'A2']]);
    const st = setup({ messages: [uiUser('one'), uiAsst('A1'), uiUser('two'), uiAsst('A2')], entries });
    handlers.branch = () => ({ text: 'two', cancelled: true });

    const r = await bridge.undoMessage(2);

    assert.equal(r.ok, false);
    assert.equal(r.reason, 'undo.fail.cancelled');
    assert.ok(!calls.some((c) => c.type === 'get_state'), 'no state refresh after cancel');
    assert.equal(st.messages.length, 5, 'original 4 messages kept + one warning bubble');
    assert.match(st.messages[4].blocks[0].text, /^⚠️/);
    assert.deepEqual(st.kanban, [{ id: 'stale' }]);
    const tab = bridge.getSessions().find((s) => s.id === tabId);
    assert.equal(tab.sessionFile, NEW_FILE, 'binding is unchanged by a failed undo');
  });

  it('refuses to branch when the bubble cannot be located with certainty', async () => {
    const entries = transcript([['one', 'A1'], ['two', 'A2']]);
    const st = setup({
      messages: [uiUser('one'), uiAsst('A1'), uiUser('two'), uiAsst('A2'), uiUser('steered, never persisted')],
      entries,
    });

    const r = await bridge.undoMessage(2);

    assert.equal(r.ok, false);
    assert.equal(r.reason, 'undo.fail.locate');
    assert.ok(!calls.some((c) => c.type === 'branch'), 'branch is destructive — must not be sent');
    assert.equal(st.messages.length, 6);
  });

  it('surfaces an RPC error as a warning without touching the conversation', async () => {
    const entries = transcript([['one', 'A1']]);
    const st = setup({ messages: [uiUser('one'), uiAsst('A1')], entries });
    handlers.branch = () => ({ __error: 'Invalid entry ID for branching' });

    const r = await bridge.undoMessage(0);

    assert.equal(r.ok, false);
    assert.equal(r.reason, 'undo.fail.generic');
    assert.equal(st.messages.length, 3);
    assert.match(st.messages[2].blocks[0].text, /Invalid entry ID for branching/);
  });

  it('does nothing while the agent is streaming or compacting', async () => {
    const entries = transcript([['one', 'A1']]);
    const st = setup({ messages: [uiUser('one'), uiAsst('A1')], entries });

    st.isStreaming = true;
    assert.equal((await bridge.undoMessage(0)).ok, false);
    assert.equal(calls.length, 0);

    st.isStreaming = false;
    st.rpcState = { ...st.rpcState, isCompacting: true };
    assert.equal((await bridge.undoMessage(0)).ok, false);
    assert.equal(calls.length, 0, 'no RPC may be sent while busy');
  });

  it('refuses while background async work is pending or a manual /compact is running', async () => {
    const entries = transcript([['one', 'A1']]);
    const st = setup({ messages: [uiUser('one'), uiAsst('A1')], entries });

    assert.equal(bridge.undoBlocked, null, 'idle session is not blocked');

    st.hasPendingAsyncWork = true;
    assert.equal(bridge.undoBlocked, 'async');
    const r = await bridge.undoMessage(0);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'undo.fail.busy');
    assert.equal(calls.length, 0, 'branch would cancel background jobs — no RPC may be sent');

    // A manual compact only adds a pending card; rpcState.isCompacting stays false.
    st.hasPendingAsyncWork = false;
    st.messages = [uiUser('one'), uiAsst('A1'), { kind: 'compact', status: 'pending' }];
    assert.equal(bridge.undoBlocked, 'running');
    assert.equal((await bridge.undoMessage(0)).ok, false);
    assert.equal(calls.length, 0);

    st.isStreaming = true;
    assert.equal(bridge.undoBlocked, 'running');
  });

  it('ignores non-user targets and bad indices', async () => {
    const entries = transcript([['one', 'A1']]);
    setup({ messages: [uiUser('one'), uiAsst('A1')], entries });
    assert.deepEqual(await bridge.undoMessage(1), { ok: false, reason: 'invalid' });
    assert.deepEqual(await bridge.undoMessage(7), { ok: false, reason: 'invalid' });
    assert.equal(calls.length, 0);
  });

  it('serialises concurrent undo requests', async () => {
    const entries = transcript([['one', 'A1'], ['two', 'A2']]);
    setup({ messages: [uiUser('one'), uiAsst('A1'), uiUser('two'), uiAsst('A2')], entries });

    const [a, b] = await Promise.all([bridge.undoMessage(2), bridge.undoMessage(2)]);
    assert.equal(a.ok, true);
    assert.deepEqual(b, { ok: false, reason: 'busy' });
    assert.equal(calls.filter((c) => c.type === 'branch').length, 1);
  });
});

describe('OMP_BRIDGE.undoMessage + tab switching', () => {
  const OTHER_FILE = 'C:\\sessions\\proj\\other.jsonl';
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const texts = (msgs) => msgs.map((m) => m.text ?? m.blocks?.[0]?.text);

  async function switchAwayWhile(undoPromise) {
    await tick(); // get_entries answered, branch now held back by the test
    let switched = false;
    const sw = bridge
      .resumeSession({ id: 'other-sess', title: 'Other', path: OTHER_FILE, cwd: '', is_standalone: true })
      .then(() => { switched = true; });
    await tick();
    assert.equal(switched, false, 'tab switch must wait for the in-flight undo');
    assert.equal(bridge.activeSessionId, tabId);
    return { sw }; // boxed: returning a promise from an async fn would await it
  }

  beforeEach(() => { handlers = {}; });

  it('defers the switch until the undo has finished, so the result still reaches its tab', async () => {
    const entries = transcript([['one', 'A1'], ['two', 'A2']]);
    setup({ messages: [uiUser('one'), uiAsst('A1'), uiUser('two'), uiAsst('A2')], entries });
    let release;
    const gate = new Promise((r) => { release = r; });
    handlers.branch = async () => { await gate; return { text: 'two', cancelled: false }; };

    const order = [];
    const undoP = bridge.undoMessage(2).then((r) => { order.push('undone'); return r; });
    const { sw: rawSw } = await switchAwayWhile(undoP);
    const sw = rawSw.then(() => order.push('switched'));
    release();
    const r = await undoP;
    await sw;

    assert.equal(r.ok, true, 'result is delivered, not reported as "switched"');
    assert.equal(r.text, 'two');
    assert.deepEqual(order, ['undone', 'switched']);
    assert.equal(bridge.activeSessionId === tabId, false, 'switch happened afterwards');

    // Back on the original tab the truncation survived the snapshot round-trip.
    await bridge.activateSession(tabId);
    assert.deepEqual(texts(bridge.getState().messages), ['one', 'A1']);
  });

  it('keeps a failure warning in the originating tab, never in the one switched to', async () => {
    const entries = transcript([['one', 'A1']]);
    setup({ messages: [uiUser('one'), uiAsst('A1')], entries });
    let release;
    const gate = new Promise((r) => { release = r; });
    handlers.branch = async () => { await gate; return { __error: 'boom' }; };

    const undoP = bridge.undoMessage(0);
    const { sw } = await switchAwayWhile(undoP);
    release();
    const r = await undoP;
    await sw;

    assert.equal(r.ok, false);
    assert.ok(
      !bridge.getState().messages.some((m) => /boom|⚠️/.test(m.blocks?.[0]?.text ?? '')),
      'the other tab must not receive the warning bubble',
    );

    await bridge.activateSession(tabId);
    const last = bridge.getState().messages.at(-1);
    assert.match(last.blocks[0].text, /boom/);
  });
});
