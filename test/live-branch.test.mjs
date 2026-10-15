/**
 * test/live-branch.test.mjs
 *
 * live.js wiring of the two alignment fixes, against a stubbed Tauri backend:
 *   - OMP_BRIDGE.branch(): source-file lookup + entry-id cut (BranchSession)
 *   - get_messages merge on a head-trimmed list (MessageMerge)
 *
 * Run: node --test test/live-branch.test.mjs
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
loadScript('app/message-merge.js');
loadScript('app/branch-session.js');
loadScript('undo-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;
const NEWEST_FILE = 'C:\\sessions\\proj\\newest.jsonl';

// ── Tauri stub ──────────────────────────────────────────────────────────
let rpc = [];
let invokes = [];
let rpcHandlers = {};
let savedSessions = [];

function installTauri() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        invokes.push({ name, args });
        if (name === 'list_saved_sessions') return savedSessions;
        if (name === 'copy_session_file') return 'C:\\sessions\\branch-1\\fork.jsonl';
        if (name !== 'send_command') return null;
        const cmd = JSON.parse(args.json);
        rpc.push(cmd);
        const h = rpcHandlers[cmd.type];
        if (h && cmd.id) {
          setTimeout(async () => {
            const out = await h(cmd);
            bridge._handleResponse({ type: 'response', id: cmd.id, command: cmd.type, success: true, data: out });
          }, 0);
        }
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
}

// ── fixtures ────────────────────────────────────────────────────────────
let seq = 0;
function entry(role, content, parentId) {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  return { type: 'message', id: `e${++seq}`, parentId, message: { role, content: blocks } };
}
function chain(rows) {
  const out = [];
  let parent = null;
  for (const [role, content] of rows) {
    const e = entry(role, content, parent);
    out.push(e);
    parent = e.id;
  }
  return out;
}
const uiUser = (text) => ({ kind: 'user', time: '00:00:00', text, images: [] });
const uiAsst = (text) => ({ kind: 'assistant', time: '00:00:00', blocks: [{ type: 'text', text }], completed: true });
const text = (m) => m.text ?? m.blocks?.[0]?.text ?? m.kind;

let tabN = 0;
/** Open a fresh tab bound to `file` and make it the active one. */
async function openTab(file) {
  const n = ++tabN;
  const id = await bridge.resumeSession({ id: `br-${n}`, title: `T${n}`, path: file, cwd: '', is_standalone: true });
  bridge._handleResponse({
    type: 'response', command: 'get_state', success: true,
    data: { isStreaming: false, sessionFile: file, sessionId: `sid-${n}` },
  });
  return id;
}

before(() => installTauri());
beforeEach(() => {
  rpc = [];
  invokes = [];
  rpcHandlers = {};
  savedSessions = [];
});

describe('OMP_BRIDGE.branch', () => {
  it('forks the file omp is writing (not the newest one) and cuts at the entry id', async () => {
    const MINE = 'C:\\sessions\\proj\\mine-a.jsonl';
    await openTab(MINE);
    savedSessions = [
      { id: 'newest', path: NEWEST_FILE },
      { id: 'mine', path: MINE },
    ];
    const es = chain([
      ['user', 'q1'],
      ['assistant', [{ type: 'toolCall', id: 'c1', name: 'read' }]],
      ['toolResult', 'file body'],
      ['assistant', 'a1'],
      ['user', 'q2'],
      ['assistant', 'a2'],
    ]);
    rpcHandlers.get_entries = () => ({ entries: es, leafId: es[es.length - 1].id });
    bridge.getState().messages = [uiUser('q1'), uiAsst('a1'), uiUser('q2'), uiAsst('a2')];

    await bridge.branch(1); // "a1"

    const copy = invokes.find((i) => i.name === 'copy_session_file');
    assert.ok(copy, 'copy_session_file must be invoked');
    assert.equal(copy.args.sourcePath, MINE);
    assert.equal(copy.args.untilEntryId, es[3].id);
    assert.equal(copy.args.maxMessages, null);
  });

  it('cuts at the entry id even after the UI list was head-trimmed', async () => {
    const MINE = 'C:\\sessions\\proj\\mine-b.jsonl';
    await openTab(MINE);
    savedSessions = [{ id: 'mine', path: MINE }];
    const rows = [];
    for (let i = 1; i <= 30; i++) rows.push(['user', `q${i}`], ['assistant', `a${i}`]);
    const es = chain(rows);
    rpcHandlers.get_entries = () => ({ entries: es, leafId: es[es.length - 1].id });
    const ui = [];
    for (let i = 29; i <= 30; i++) ui.push(uiUser(`q${i}`), uiAsst(`a${i}`)); // 56 bubbles trimmed away
    bridge.getState().messages = ui;

    await bridge.branch(1); // "a29"

    const copy = invokes.find((i) => i.name === 'copy_session_file');
    assert.equal(copy.args.untilEntryId, es[57].id, 'a29 is entry #58 of the file');
  });

  it('refuses with a warning when the bubble cannot be matched — no silent full copy', async () => {
    const MINE = 'C:\\sessions\\proj\\mine-c.jsonl';
    const tab = await openTab(MINE);
    savedSessions = [{ id: 'mine', path: MINE }];
    const es = chain([['user', 'q1'], ['assistant', 'a1']]);
    rpcHandlers.get_entries = () => ({ entries: es, leafId: es[1].id });
    bridge.getState().messages = [uiUser('q1'), uiAsst('something else')];

    await bridge.branch(1);

    assert.ok(!invokes.some((i) => i.name === 'copy_session_file'), 'nothing may be copied');
    assert.equal(bridge.activeSessionId, tab, 'stays in the same tab');
    const last = bridge.getState().messages.at(-1);
    assert.match(last.blocks[0].text, /Branch failed/);
  });

  it('branching from HEAD (no index) copies the whole file', async () => {
    const MINE = 'C:\\sessions\\proj\\mine-d.jsonl';
    await openTab(MINE);
    savedSessions = [{ id: 'mine', path: MINE }];
    bridge.getState().messages = [uiUser('q1'), uiAsst('a1')];

    await bridge.branch();

    const copy = invokes.find((i) => i.name === 'copy_session_file');
    assert.equal(copy.args.sourcePath, MINE);
    assert.equal(copy.args.untilEntryId, null);
    assert.ok(!rpc.some((c) => c.type === 'get_entries'), 'no entry lookup needed');
  });
});

describe('get_messages merge (live.js wiring)', () => {
  const raw = (role, t) => ({ role, content: [{ type: 'text', text: t }] });

  it('does not corrupt or duplicate a head-trimmed list', async () => {
    await openTab('C:\\sessions\\proj\\merge-a.jsonl');
    const full = [];
    for (let i = 1; i <= 20; i++) full.push(raw('user', `q${i}`), raw('assistant', `ans${i}`));
    const trimmed = [];
    for (let i = 14; i <= 20; i++) trimmed.push(uiUser(`q${i}`), uiAsst(`ans${i}`));
    bridge.getState().messages = trimmed;

    bridge._handleResponse({ type: 'response', command: 'get_messages', success: true, data: { messages: full } });

    const out = bridge.getState().messages;
    assert.deepEqual(out.map(text), trimmed.map(text));
  });

  it('keeps tool cards and appends turns that finished in the background', async () => {
    await openTab('C:\\sessions\\proj\\merge-b.jsonl');
    const card = { kind: 'tool', _toolCallId: 'tc1', status: 'running' };
    bridge.getState().messages = [uiUser('q1'), uiAsst('ans1'), card];

    bridge._handleResponse({
      type: 'response', command: 'get_messages', success: true,
      data: { messages: [raw('user', 'q1'), raw('assistant', 'ans1'), raw('user', 'q2'), raw('assistant', 'ans2')] },
    });

    const out = bridge.getState().messages;
    assert.deepEqual(out.map(text), ['q1', 'ans1', 'tool', 'q2', 'ans2']);
    assert.equal(out[2]._toolCallId, 'tc1');
  });
});
