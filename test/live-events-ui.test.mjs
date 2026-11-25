/**
 * test/live-events-ui.test.mjs
 *
 * live/events-ui.js in isolation: the ask handshake is owned by this module
 * (finalizeAsks / resetHandshake / answerAsk), `custom` todo events, OAuth
 * `input` prompts and the cancel-unsupported-dialog path.
 *
 * Run: node --test test/live-events-ui.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['live/defaults.js', 'live/runtime.js', 'live/todo-phases.js', 'live/events-ui.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
// NoticeBubble is loaded by the shim; PeerSessionBridge only matters for snapshots.
globalThis.PeerSessionBridge = { build: () => null, id: null };

const { Runtime, TodoPhases, EventsUi, Defaults } = globalThis._Live;

let runtime, state, rt, sent, notified, loginInFlight, ui, openedPrompts;

function setup() {
  runtime = Runtime.create({
    defaults: Defaults, sessionRegistry: new Map(), sessionSnapshots: new Map(), pendingSetModel: [],
  });
  ({ state, rt } = runtime);
  rt.conn.activeSessionId = 'S1';
  sent = [];
  notified = 0;
  loginInFlight = new Map();
  const todo = TodoPhases.create({ state, rt });
  ui = EventsUi.create({
    state, rt, notify: () => { notified++; }, send: cmd => sent.push(cmd), todo, loginInFlight,
  });
}

const selectFrame = (id, extra = {}) => ({
  type: 'extension_ui_request', method: 'select', id, title: 'Pick', options: ['a', 'b'], ...extra,
});

let savedPrompt;
beforeEach(() => {
  setup();
  openedPrompts = [];
  savedPrompt = globalThis.prompt;
  globalThis.prompt = (msg) => { openedPrompts.push(msg); return 'typed'; };
});
afterEach(() => { globalThis.prompt = savedPrompt; });

const OTHER = 'Other (type your own)';
const inputFrame = (id) => ({ type: 'extension_ui_request', method: 'input', id, title: 'Your answer' });

/** Arm the "Other" handshake through the real flow: select with an Other row, answer with custom text. */
function armHandshake(askId = 'o1', text = 'typed text') {
  ui.handlers.extension_ui_request(selectFrame(askId, { options: ['a', OTHER] }));
  ui.answerAsk(askId, { custom: text });
  sent.length = 0;
  notified = 0;
  state.messages = [];
}

/** True when the next input request is auto-answered by the handshake (no bubble). */
function inputIsAutoAnswered(id = 'follow') {
  const bubbles = state.messages.length;
  sent.length = 0;
  ui.handlers.extension_ui_request(inputFrame(id));
  const auto = sent.length === 1 && sent[0].id === id && sent[0].value === 'typed text';
  return auto && state.messages.length === bubbles;
}

describe('events-ui — handshake ownership', () => {
  it('an armed handshake auto-answers the follow-up input exactly once', () => {
    armHandshake();
    assert.equal(inputIsAutoAnswered('f1'), true);
    ui.handlers.extension_ui_request(inputFrame('f2'));
    assert.equal(state.messages.length, 1, 'second input is a normal ask bubble');
  });

  it('without a handshake an input request becomes an ask bubble', () => {
    assert.equal(inputIsAutoAnswered(), false);
    assert.equal(state.messages.length, 1);
  });

  it('resetHandshake clears an armed handshake', () => {
    armHandshake();
    ui.resetHandshake();
    assert.equal(inputIsAutoAnswered(), false);
  });

  it('finalizeAsks clears the handshake', () => {
    armHandshake();
    ui.finalizeAsks({ aborted: true });
    assert.equal(inputIsAutoAnswered(), false);
  });

  it('a new select means the server did not enter input: stale handshake dropped, bubble pushed', () => {
    armHandshake();
    ui.handlers.extension_ui_request(selectFrame('q2'));
    assert.equal(state.messages.length, 1);
    assert.equal(notified, 1);
    assert.equal(inputIsAutoAnswered(), false);
  });

  it('cancel drops the handshake', () => {
    armHandshake('o9');
    ui.handlers.extension_ui_request({ type: 'extension_ui_request', method: 'cancel', targetId: 'o9' });
    assert.equal(inputIsAutoAnswered(), false);
  });

  it('answerAsk without a handshake plan (plain select value) arms nothing', () => {
    ui.handlers.extension_ui_request(selectFrame('p1'));
    ui.answerAsk('p1', 'a');
    assert.equal(inputIsAutoAnswered(), false);
  });

  it('answerAsk on an unknown id is a no-op (no frame, no notify)', () => {
    ui.answerAsk('missing', { value: 'a' });
    assert.equal(sent.length, 0);
    assert.equal(notified, 0);
  });

  it('answerAsk sends the response frame for an open select and notifies', () => {
    ui.handlers.extension_ui_request(selectFrame('q4'));
    notified = 0;
    ui.answerAsk('q4', 'a'); // bare string === { value }
    assert.equal(notified, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'extension_ui_response');
    assert.equal(sent[0].id, 'q4');
    assert.equal(sent[0].value, 'a');
  });
});

describe('events-ui — input / editor / confirm', () => {
  it('login in flight: input goes through window.prompt and is answered', () => {
    loginInFlight.set('S1', new Set([Symbol('login')]));
    ui.handlers.extension_ui_request({ type: 'extension_ui_request', method: 'input', id: 'i1', title: 'Code?' });
    assert.deepEqual(openedPrompts, ['Code?']);
    assert.deepEqual(sent, [{ type: 'extension_ui_response', id: 'i1', value: 'typed' }]);
    assert.equal(state.messages.length, 0);
  });

  it('login prompt dismissed → cancelled response', () => {
    globalThis.prompt = () => null;
    loginInFlight.set('S1', new Set([Symbol('login')]));
    ui.handlers.extension_ui_request({ type: 'extension_ui_request', method: 'input', id: 'i2' });
    assert.deepEqual(sent, [{ type: 'extension_ui_response', id: 'i2', cancelled: true }]);
  });

  it('login in flight for another tab does not hijack this tab\'s input', () => {
    loginInFlight.set('OTHER', new Set([Symbol('login')]));
    ui.handlers.extension_ui_request({ type: 'extension_ui_request', method: 'input', id: 'i3', title: 'Name' });
    assert.equal(openedPrompts.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(state.messages.length, 1, 'rendered as an ask bubble instead');
  });

  it('confirm dialogs are cancelled so the server does not hang', () => {
    ui.handlers.extension_ui_request({ type: 'extension_ui_request', method: 'confirm', id: 'c1' });
    assert.deepEqual(sent, [{ type: 'extension_ui_response', id: 'c1', cancelled: true }]);
  });

  it('unknown methods are ignored', () => {
    ui.handlers.extension_ui_request({ type: 'extension_ui_request', method: 'notify', id: 'n1' });
    assert.equal(sent.length, 0);
    assert.equal(notified, 0);
  });

  it('open_url without Tauri opens a window and shows instructions as a notice', () => {
    const opened = [];
    const savedOpen = globalThis.open;
    globalThis.open = (u, t) => opened.push([u, t]);
    const savedTauri = globalThis.__TAURI__;
    delete globalThis.__TAURI__;
    try {
      ui.handlers.extension_ui_request({
        type: 'extension_ui_request', method: 'open_url', url: 'https://x.test/auth', instructions: 'Paste the code',
      });
    } finally {
      globalThis.open = savedOpen;
      if (savedTauri) globalThis.__TAURI__ = savedTauri;
    }
    assert.deepEqual(opened, [['https://x.test/auth', '_blank']]);
    assert.equal(state.messages.length, 1);
    assert.equal(notified, 1);
  });
});

describe('events-ui — custom todo events', () => {
  const phases = [{ name: 'P', tasks: [{ content: 'a', status: 'pending' }] }];

  it('todo_edit applies phases and notifies', () => {
    ui.handlers.custom({ type: 'custom', customType: 'todo_edit', data: { phases } });
    assert.ok(state.kanban.length > 0);
    assert.equal(notified, 1);
  });

  it('unrelated customType is ignored', () => {
    ui.handlers.custom({ type: 'custom', customType: 'something_else', data: { phases } });
    assert.equal(state.kanban.length, 0);
    assert.equal(notified, 0);
  });

  it('todo event without phases does not notify', () => {
    ui.handlers.custom({ type: 'custom', customType: 'todo', data: { phases: [] } });
    assert.equal(notified, 0);
  });
});

describe('events-ui — handler table', () => {
  it('registers exactly custom and extension_ui_request', () => {
    assert.deepEqual(Object.keys(ui.handlers).sort(), ['custom', 'extension_ui_request']);
  });
});
