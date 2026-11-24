/**
 * test/live-export.test.mjs
 *
 * OMP_BRIDGE.exportSession (export-bridge.js wired through live.js) against a
 * stubbed Tauri: `send_command` answers omp RPC requests, other commands
 * (`save_markdown_export`, `save_html_export`) are recorded.
 *
 * Run: node --test test/live-export.test.mjs
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
loadScript('app/export-markdown.js');
loadScript('undo-bridge.js');
loadScript('export-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;
const t = globalThis.t;
const FILE = 'C:\\sessions\\proj\\export.jsonl';

// ── Tauri stub ──────────────────────────────────────────────────────────
const rpcCalls = [];
const invokeCalls = [];
let rpc = {};
let invokes = {};

function installTauri() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        if (name !== 'send_command') {
          invokeCalls.push({ name, args });
          const h = invokes[name];
          return h ? h(args) : null;
        }
        const cmd = JSON.parse(args.json);
        rpcCalls.push(cmd);
        const h = rpc[cmd.type];
        if (h && cmd.id) {
          setTimeout(async () => {
            const out = await h(cmd);
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
  return { type: 'message', id: `x${++seq}`, parentId, message: { role, content: [{ type: 'text', text }] } };
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

let tabId;
let tabName;
before(async () => {
  installTauri();
  tabId = await bridge.resumeSession({ id: 'export-sess', title: 'Export', path: FILE, cwd: '', is_standalone: true });
  bridge._handleResponse({
    type: 'response', command: 'get_state', success: true,
    data: { isStreaming: false, sessionFile: FILE, sessionId: 'export-sess' },
  });
  tabName = bridge.getSessions().find((s) => s.id === tabId).name;
});

function reset(entries = transcript([['hello', 'world']])) {
  rpcCalls.length = 0;
  invokeCalls.length = 0;
  const st = bridge.getState();
  st.messages = [];
  // The stubbed `session_status` makes resumeSession report "not running"; these tests model a healthy agent.
  st.agentError = null;
  const leaf = entries.length ? entries[entries.length - 1].id : null;
  rpc = { get_entries: () => ({ entries, leafId: leaf }) };
  invokes = {};
  return st;
}
const lastText = (st) => st.messages.at(-1)?.blocks?.[0]?.text ?? '';

describe('OMP_BRIDGE.exportSession (markdown)', () => {
  beforeEach(() => { reset(); });

  it('reads get_entries, builds the transcript and saves it with a localized title', async () => {
    const st = reset();
    invokes.save_markdown_export = () => 'C:\\out\\chat.md';

    const r = await bridge.exportSession('markdown');

    assert.deepEqual(r, { ok: true, path: 'C:\\out\\chat.md' });
    assert.deepEqual(rpcCalls.map((c) => c.type), ['get_entries']);
    assert.equal(invokeCalls.length, 1);
    const { name, args } = invokeCalls[0];
    assert.equal(name, 'save_markdown_export');
    assert.equal(args.content, `# ${t('export.role.user')}\n\nhello\n\n# ${t('export.role.assistant')}\n\nworld\n`);
    assert.equal(args.defaultName, tabName);
    assert.equal(args.title, t('export.dialog.markdown'));
    assert.ok(!('path' in args) && !('dest' in args), 'the frontend never supplies a destination');
    assert.match(lastText(st), /^✅/);
    assert.ok(lastText(st).includes('C:\\out\\chat.md'));
  });

  it('says so and opens no dialog when there is nothing to export', async () => {
    const st = reset([]);
    const r = await bridge.exportSession('markdown');

    assert.deepEqual(r, { ok: false, reason: 'export.fail.empty' });
    assert.equal(invokeCalls.length, 0, 'no save dialog for an empty export');
    assert.match(lastText(st), /^⚠️/);
  });

  it('stays quiet when the user cancels the dialog', async () => {
    const st = reset();
    invokes.save_markdown_export = () => null;

    const r = await bridge.exportSession('markdown');

    assert.deepEqual(r, { ok: false, reason: 'cancelled' });
    assert.equal(st.messages.length, 0);
  });

  it('suggests the HTML export when get_entries times out', async () => {
    const st = reset();
    rpc.get_entries = () => ({ __error: "Command 'get_entries' timed out after 30000ms" });

    const r = await bridge.exportSession('markdown');

    assert.equal(r.reason, 'export.fail.timeoutMd');
    assert.equal(invokeCalls.length, 0);
    assert.equal(lastText(st), `⚠️ ${t('export.fail.timeoutMd')}`);
  });

  it('reports a non-timeout RPC error with its message', async () => {
    const st = reset();
    rpc.get_entries = () => ({ __error: 'kaboom' });

    const r = await bridge.exportSession('markdown');

    assert.equal(r.reason, 'export.fail.generic');
    assert.match(lastText(st), /kaboom/);
  });

  it('reports a failed save command', async () => {
    const st = reset();
    invokes.save_markdown_export = () => { throw 'failed to write file: denied'; };

    const r = await bridge.exportSession('markdown');

    assert.equal(r.ok, false);
    assert.match(lastText(st), /denied/);
  });
});

describe('OMP_BRIDGE.exportSession (html)', () => {
  beforeEach(() => { reset(); });

  it('asks omp for the export, then hands its path to the save command', async () => {
    const st = reset();
    rpc.export_html = () => ({ path: 'C:\\proj\\omp-session.html' });
    invokes.save_html_export = () => 'C:\\out\\s.html';

    const r = await bridge.exportSession('html');

    assert.deepEqual(r, { ok: true, path: 'C:\\out\\s.html' });
    assert.deepEqual(rpcCalls.map((c) => c.type), ['export_html']);
    const { name, args } = invokeCalls[0];
    assert.equal(name, 'save_html_export');
    assert.equal(args.sourcePath, 'C:\\proj\\omp-session.html');
    assert.equal(args.defaultName, tabName);
    assert.equal(args.title, t('export.dialog.html'));
    assert.match(lastText(st), /^✅/);
  });

  it('passes a relative path through untouched when the tab has no project', async () => {
    reset();
    rpc.export_html = () => ({ path: 'omp-session.html' });
    invokes.save_html_export = () => 'C:\\out\\s.html';

    await bridge.exportSession('html');

    assert.equal(invokeCalls[0].args.sourcePath, 'omp-session.html');
  });

  it('reports a missing export path from omp without opening a dialog', async () => {
    const st = reset();
    rpc.export_html = () => ({});

    const r = await bridge.exportSession('html');

    assert.equal(r.reason, 'export.fail.noPath');
    assert.equal(invokeCalls.length, 0);
    assert.equal(lastText(st), `⚠️ ${t('export.fail.noPath')}`);
  });

  it('stays quiet when the user cancels the dialog', async () => {
    const st = reset();
    rpc.export_html = () => ({ path: 'omp-session.html' });
    invokes.save_html_export = () => null;

    const r = await bridge.exportSession('html');

    assert.deepEqual(r, { ok: false, reason: 'cancelled' });
    assert.equal(st.messages.length, 0);
  });
});

describe('OMP_BRIDGE.exportSession guards', () => {
  beforeEach(() => { reset(); });

  it('rejects an unknown format without touching omp', async () => {
    const r = await bridge.exportSession('pdf');
    assert.deepEqual(r, { ok: false, reason: 'invalid' });
    assert.equal(rpcCalls.length, 0);
  });

  it('ignores a second export while one is in flight', async () => {
    reset();
    invokes.save_markdown_export = () => 'C:\\out\\a.md';
    const [a, b] = await Promise.all([bridge.exportSession('markdown'), bridge.exportSession('markdown')]);

    assert.equal(a.ok, true);
    assert.deepEqual(b, { ok: false, reason: 'busy' });
    assert.equal(rpcCalls.filter((c) => c.type === 'get_entries').length, 1);
  });
});

describe('OMP_BRIDGE.exportSession + tab switching', () => {
  const OTHER_FILE = 'C:\\sessions\\proj\\other.jsonl';
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

  it('defers the tab switch until the export finished, notice stays in its own tab', async () => {
    const st = reset();
    let release;
    const gate = new Promise((r) => { release = r; });
    invokes.save_markdown_export = async () => { await gate; return 'C:\\out\\late.md'; };

    const exportP = bridge.exportSession('markdown');
    await tick(); // get_entries answered, the save dialog is "open"

    let switched = false;
    const sw = bridge
      .resumeSession({ id: 'other-export', title: 'Other', path: OTHER_FILE, cwd: '', is_standalone: true })
      .then(() => { switched = true; });
    await tick();
    assert.equal(switched, false, 'tab switch must wait for the in-flight export');
    assert.equal(bridge.activeSessionId, tabId);

    release();
    const r = await exportP;
    await sw;

    assert.equal(r.ok, true);
    assert.equal(bridge.activeSessionId === tabId, false, 'switch happened afterwards');
    assert.ok(
      !bridge.getState().messages.some((m) => /late\.md/.test(m.blocks?.[0]?.text ?? '')),
      'the other tab must not receive the notice',
    );

    await bridge.activateSession(tabId);
    assert.match(lastText(bridge.getState()), /late\.md/);
    assert.ok(st);
  });
});

describe('OMP_BRIDGE.exportSession (html, project tab)', () => {
  it('joins a relative omp path with the project cwd', async () => {
    const CWD = 'C:\\work\\proj';
    await bridge.resumeSession({
      id: 'export-proj', title: 'Proj', path: 'C:\\sessions\\proj\\proj.jsonl', cwd: CWD, is_standalone: false,
    });
    reset();
    rpc.export_html = () => ({ path: 'omp-session.html' });
    invokes.save_html_export = () => 'C:\\out\\s.html';

    await bridge.exportSession('html');

    assert.equal(invokeCalls[0].args.sourcePath, `${CWD}/omp-session.html`);
  });
});

describe('OMP_BRIDGE.exportSession dialog name and dead agent', () => {
  it('flattens path separators in the tab title so the whole title survives', async () => {
    await bridge.resumeSession({
      id: 'export-slash', title: 'fix src/live.js and CI\\CD/', path: 'C:\\sessions\\proj\\slash.jsonl', cwd: '', is_standalone: true,
    });
    const st = reset();
    invokes.save_markdown_export = () => 'C:\\out\\x.md';

    await bridge.exportSession('markdown');

    const name = invokeCalls[0].args.defaultName;
    assert.ok(!/[\\/]/.test(name), name);
    assert.ok(name.includes('fix src_live.js and CI_CD_'), name);
    assert.ok(st);
  });

  it('fails fast without any RPC when the agent is already known to be dead', async () => {
    const st = reset();
    st.agentError = 'omp exited unexpectedly';
    try {
      const r = await bridge.exportSession('markdown');
      assert.deepEqual(r, { ok: false, reason: 'export.fail.generic' });
      assert.equal(rpcCalls.length, 0, 'no RPC that could only time out');
      assert.equal(invokeCalls.length, 0);
      assert.match(lastText(st), /omp exited unexpectedly/);
      // And it never holds the tab-switch gate.
      await bridge.exportSession('html');
      assert.equal(rpcCalls.length, 0);
    } finally {
      st.agentError = null;
    }
  });
});
