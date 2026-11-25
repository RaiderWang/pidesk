/**
 * test/live-ask.test.mjs
 *
 * live.js wiring of the ask tool (app/ask-model.js + app/ask-answer.js) against a
 * stubbed Tauri backend, driven with 18.4.3 and 19.0.1 style frame sequences
 * (test/fixtures/ask-frames-*.json).
 *
 * Run: node --test test/live-ask.test.mjs
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';
import { loadLive } from './helpers/load-live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src');
const loadScript = (rel) => new Function(readFileSync(join(SRC, rel), 'utf-8'))();
const fixtures = (n) => JSON.parse(readFileSync(join(HERE, 'fixtures', n), 'utf-8')).scenarios;
const F18 = fixtures('ask-frames-18.json');
const F19 = fixtures('ask-frames-19.json');

loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('app/message-merge.js');
loadScript('app/branch-session.js');
loadScript('undo-bridge.js');
loadScript('export-bridge.js');
loadLive();

const bridge = globalThis.OMP_BRIDGE;
const OTHER = 'Other (type your own)';

// ── Tauri stub ──────────────────────────────────────────────────────────
let rpc = [];
let rpcHandlers = {};
function installTauri() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
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
    event: {
      listen: async (name, cb) => {
        listeners[name] = cb;
        return () => { if (listeners[name] === cb) delete listeners[name]; };
      },
    },
  };
}
let listeners = {};
const fireExit = (reason = '') => listeners[`agent://exit/${bridge.activeSessionId}`]({ payload: reason });

let tabN = 0;
async function openTab() {
  const n = ++tabN;
  return bridge.resumeSession({ id: `ask-${n}`, title: `T${n}`, path: `C:\\s\\ask-${n}.jsonl`, cwd: '', is_standalone: true });
}

const ev = (f) => bridge._handleEvent(f);
const msgs = () => bridge.getState().messages;
const asks = () => msgs().filter(m => m.kind === 'ask');
const kinds = () => msgs().map(m => (m.kind === 'tool' ? `tool:${m.tool}` : m.kind));
const responses = () => rpc.filter(c => c.type === 'extension_ui_response');
const toolStart = (id = 'tc-ask') => ev({ type: 'tool_execution_start', toolCallId: id, toolName: 'ask', args: {} });
const toolEnd = (id = 'tc-ask', name = 'ask') => ev({ type: 'tool_execution_end', toolCallId: id, toolName: name, result: {} });

before(() => installTauri());
beforeEach(async () => {
  rpc = [];
  rpcHandlers = {};
  globalThis.prompt = () => null;
  await openTab();
  rpc = [];
});

describe('ask ordering', () => {
  it('select before tool_execution_start → [tool card, ask bubble] (no pending buffer)', () => {
    ev(F19.singleSelect.frames[0]);
    assert.deepEqual(kinds(), ['ask'], 'bubble is visible immediately');
    toolStart();
    assert.deepEqual(kinds(), ['tool:ask', 'ask']);
    assert.equal(asks()[0].orphan, false);
  });

  it('select after tool_execution_start → same order', () => {
    toolStart();
    ev(F19.singleSelect.frames[0]);
    assert.deepEqual(kinds(), ['tool:ask', 'ask']);
  });

  it('a non-ask tool does not claim an orphan ask bubble', () => {
    ev(F19.singleSelect.frames[0]);
    ev({ type: 'tool_execution_start', toolCallId: 'tc-bash', toolName: 'bash', args: { command: 'ls' } });
    assert.deepEqual(kinds(), ['ask', 'tool:bash']);
  });
});

describe('single select answers', () => {
  it('clicking an option sends the value and marks the bubble answered', () => {
    toolStart();
    ev(F19.singleSelect.frames[0]);
    bridge.answerAsk('19-s1', { value: 'Vue' });
    assert.deepEqual(responses().map(r => [r.id, r.value]), [['19-s1', 'Vue']]);
    assert.equal(asks()[0].state, 'answered');
  });

  it('legacy string payload still works', () => {
    ev(F19.singleSelect.frames[0]);
    bridge.answerAsk('19-s1', 'React');
    assert.equal(responses()[0].value, 'React');
  });

  it('refuses a non-offered value (no frame sent)', () => {
    ev(F19.singleSelect.frames[0]);
    bridge.answerAsk('19-s1', { value: 'Svelte' });
    assert.equal(responses().length, 0);
  });

  it('answering twice sends only once', () => {
    ev(F19.singleSelect.frames[0]);
    bridge.answerAsk('19-s1', { value: 'Vue' });
    bridge.answerAsk('19-s1', { value: 'React' });
    assert.equal(responses().length, 1);
  });
});

describe('"Other" two-step handshake', () => {
  it('19.x: otherRow first, then the input follow-up is auto-answered with the typed text', () => {
    toolStart();
    ev(F19.singleOther.frames[0]);
    bridge.answerAsk('19-o1', { custom: 'Svelte' });
    assert.deepEqual(responses().map(r => r.value), [OTHER]);
    ev(F19.singleOther.frames[1]); // input
    assert.deepEqual(responses().map(r => [r.id, r.value]), [['19-o1', OTHER], ['19-o2', 'Svelte']]);
    assert.equal(asks().length, 1, 'follow-up did not create a bubble');
    assert.equal(asks()[0].answer, 'Svelte');
  });

  it('18.x: the editor follow-up is auto-answered too', () => {
    toolStart();
    ev(F18.singleOther.frames[0]);
    bridge.answerAsk('18-o1', { custom: 'Svelte' });
    ev(F18.singleOther.frames[1]); // editor
    assert.equal(responses().at(-1).id, '18-o2');
    assert.equal(responses().at(-1).value, 'Svelte');
  });

  it('is refused when the select has no otherRow', () => {
    ev(F19.singleSelectNoOther.frames[0]);
    bridge.answerAsk('19-sn1', { custom: 'x' });
    assert.equal(responses().length, 0);
  });

  it('a handshake is consumed once: a later input becomes an inline bubble', () => {
    toolStart();
    ev(F19.singleOther.frames[0]);
    bridge.answerAsk('19-o1', { custom: 'Svelte' });
    ev(F19.singleOther.frames[1]);
    ev(F19.text.input);
    assert.equal(responses().length, 2);
    assert.equal(asks().at(-1).mode, 'input');
  });

  it('leak regression: a new select clears the handshake so the next field is NOT auto-answered', () => {
    toolStart();
    ev(F19.multiRounds.round3Other);
    // user (wrongly) submits custom text while Other is already checked → server answers with a
    // fresh select (unchecks Other) and never sends an input.
    bridge.answerAsk('19-m3', { clearOther: true }); // pending, no handshake
    ev(F19.multiRounds.round4Cleared);
    // now simulate the buggy path directly: arm handshake via a custom answer, server replies select
    bridge.answerAsk('19-m4', { custom: 'bar' });
    ev({ ...F19.multiRounds.round3Other, id: '19-m5' }); // select instead of input
    const before = responses().length;
    ev(F19.text.input); // NEXT form field
    assert.equal(responses().length, before, 'stale handshake must not answer the next field');
    assert.equal(asks().at(-1).mode, 'input');
  });

  it('cancel frame clears the handshake', () => {
    toolStart();
    ev(F19.singleOther.frames[0]);
    bridge.answerAsk('19-o1', { custom: 'Svelte' });
    ev({ type: 'extension_ui_request', id: 'c1', method: 'cancel', targetId: 'whatever' });
    const n = responses().length;
    ev(F19.text.input);
    assert.equal(responses().length, n);
  });

  it('ask tool end clears the handshake; another tool ending does not', () => {
    toolStart();
    ev(F19.singleOther.frames[0]);
    bridge.answerAsk('19-o1', { custom: 'Svelte' });
    ev({ type: 'tool_execution_start', toolCallId: 'tc-b', toolName: 'bash', args: { command: 'ls' } });
    toolEnd('tc-b', 'bash');
    ev(F19.singleOther.frames[1]);
    assert.equal(responses().at(-1).value, 'Svelte', 'bash end left the handshake armed');

    // fresh handshake, then the ask itself ends
    ev({ ...F19.singleOther.frames[0], id: 'o3' });
    bridge.answerAsk('o3', { custom: 'again' });
    toolEnd('tc-ask', 'ask');
    const n = responses().length;
    ev({ ...F19.singleOther.frames[1], id: 'o4' });
    assert.equal(responses().length, n);
  });

  it('switching tab clears the handshake', async () => {
    toolStart();
    ev(F19.singleOther.frames[0]);
    bridge.answerAsk('19-o1', { custom: 'Svelte' });
    await openTab();
    const n = rpc.filter(c => c.type === 'extension_ui_response').length;
    ev(F19.text.input);
    assert.equal(rpc.filter(c => c.type === 'extension_ui_response').length, n);
    assert.equal(asks().at(-1).mode, 'input');
  });
});

describe('multi-select rounds', () => {
  it('19.x: every click is a response; the next round reopens the same bubble with server state', () => {
    toolStart();
    ev(F19.multiRounds.round1);
    assert.equal(asks()[0].multi, true);
    bridge.answerAsk('19-m1', { value: 'Auth' });
    assert.equal(asks()[0].state, 'pending');
    bridge.answerAsk('19-m1', { value: 'Billing' }); // double click while pending
    assert.equal(responses().length, 1);
    ev(F19.multiRounds.round2);
    assert.equal(asks().length, 1, 'no duplicate bubble');
    const b = asks()[0];
    assert.equal(b.id, '19-m2');
    assert.equal(b.state, 'open');
    assert.deepEqual(b.checked, ['Auth']);
    bridge.answerAsk('19-m2', { value: b.doneRow });
    assert.equal(responses().at(-1).value, '✔ Done selecting', 'original doneRow string is sent');
    assert.equal(asks()[0].state, 'answered');
    assert.deepEqual(asks()[0].checked, ['Auth']);
  });

  it('18.x: round 1 is indistinguishable from a single select; round 2 upgrades it and keeps the first pick', () => {
    toolStart();
    ev(F18.multiRounds.round1);
    bridge.answerAsk('18-m1', { value: 'Auth' });
    ev(F18.multiRounds.round2);
    assert.equal(asks().length, 1);
    assert.equal(asks()[0].multi, true);
    assert.deepEqual(asks()[0].checked, ['Auth']);
    bridge.answerAsk('18-m2', { value: 'Search' });
    assert.deepEqual(asks()[0].checked, ['Auth', 'Search']);
    ev(F18.multiRounds.round3);
    assert.equal(asks().length, 1);
    assert.deepEqual(asks()[0].checked, ['Auth', 'Search']);
  });

  it('19.x: a different question of the same ask appends a new bubble', () => {
    toolStart();
    ev(F19.multiRounds.round1);
    bridge.answerAsk('19-m1', { value: 'Auth' });
    ev({ ...F19.singleSelect.frames[0], id: 'q2', title: 'Second question' });
    assert.equal(asks().length, 2);
  });

  it('19.x: other chosen → otherChecked; clearOther sends otherRow without a handshake', () => {
    toolStart();
    ev(F19.multiRounds.round3Other);
    assert.equal(asks()[0].otherChecked, true);
    bridge.answerAsk('19-m3', { clearOther: true });
    assert.deepEqual(responses().map(r => r.value), [OTHER]);
    // an input arriving now must not be auto-answered
    ev(F19.text.input);
    assert.equal(responses().length, 1);
  });
});

describe('custom text while Other is already checked (19.x multi)', () => {
  it('is refused: nothing is sent and no handshake is armed, so the next input is never auto-answered', () => {
    toolStart();
    ev(F19.multiRounds.round3Other);
    assert.equal(asks()[0].otherChecked, true);
    bridge.answerAsk('19-m3', { custom: 'bar' });
    assert.equal(responses().length, 0);
    ev(F19.text.input);
    assert.equal(responses().length, 0, 'the follow-up input became an inline bubble');
    assert.equal(asks().at(-1).mode, 'input');
  });
});

describe('inline input / editor', () => {
  it('editor is no longer auto-cancelled: it becomes a bubble and nothing is sent', () => {
    ev(F19.text.editorMultiline);
    assert.equal(responses().length, 0);
    assert.equal(asks()[0].mode, 'editor');
    assert.equal(asks()[0].prefill, 'line1\nline2');
  });

  it('empty string can be submitted (skip an optional field)', () => {
    ev(F19.text.input);
    bridge.answerAsk('19-t1', { text: '' });
    assert.equal(responses()[0].value, '');
    assert.equal(asks()[0].state, 'answered');
  });

  it('secret input is not echoed in the bubble', () => {
    ev(F19.text.secret);
    bridge.answerAsk('19-t2', { text: 's3cret' });
    assert.equal(responses()[0].value, 's3cret');
    assert.equal(asks()[0].answer, null);
    assert.equal(asks()[0].answerMasked, true);
  });

  it('a validation re-ask appends a new bubble instead of merging', () => {
    ev(F19.text.input);
    bridge.answerAsk('19-t1', { text: '' });
    ev(F19.text.reask);
    assert.equal(asks().length, 2);
    assert.equal(asks()[1].state, 'open');
  });

  it('cancelAsk sends { cancelled: true }', () => {
    ev(F19.text.editorMultiline);
    bridge.cancelAsk('19-t3');
    assert.equal(responses()[0].cancelled, true);
    assert.equal(asks()[0].state, 'cancelled');
  });

  it('confirm is still auto-cancelled', () => {
    ev({ type: 'extension_ui_request', id: 'cf', method: 'confirm', title: 'sure?' });
    assert.equal(responses()[0].cancelled, true);
  });
});

describe('login prompts keep window.prompt', () => {
  it('input during an in-flight login uses window.prompt, not a bubble', async () => {
    let asked = null;
    globalThis.prompt = (t) => { asked = t; return 'yes'; };
    let release;
    rpcHandlers.login = () => new Promise(r => { release = r; });
    const p = bridge.login('antigravity-cli');
    ev({ type: 'extension_ui_request', id: 'lg1', method: 'input', title: 'Type yes' });
    assert.equal(asked, 'Type yes');
    assert.equal(asks().length, 0);
    assert.deepEqual(responses().map(r => [r.id, r.value]), [['lg1', 'yes']]);
    await new Promise(r => setTimeout(r, 5));
    release({});
    await p;
    ev(F19.text.input);
    assert.equal(asks().length, 1, 'after the login finished, input is inline again');
  });

  it('login in-flight state is per session: another tab gets inline bubbles', async () => {
    globalThis.prompt = () => { throw new Error('window.prompt must not be used in this tab'); };
    let release;
    rpcHandlers.login = () => new Promise(r => { release = r; });
    const p = bridge.login('x');
    await new Promise(r => setTimeout(r, 5));
    await openTab(); // different session becomes active
    ev(F19.text.input);
    assert.equal(asks().at(-1).mode, 'input');
    release({});
    await p;
  });

  describe('login claims are tokens, cleared with the process / tab', () => {
    const tick = () => new Promise(r => setTimeout(r, 5));
    const promptReply = () => { const seen = []; globalThis.prompt = (t) => { seen.push(t); return 'v'; }; return seen; };
    // login RPCs the test keeps "in flight"; settled in afterEach so no 300 s timeout timer outlives the test
    let held = [];
    const holdLogin = () => { let res; rpcHandlers.login = () => new Promise(r => { res = r; held.push(r); }); return () => res({}); };
    afterEach(async () => { held.forEach(r => r({})); held = []; await tick(); });

    it('agent exit drops the claim: a later input is an inline bubble', async () => {
      const seen = promptReply();
      holdLogin();
      bridge.login('x');
      await tick();
      fireExit('boom');
      ev(F19.text.input);
      assert.deepEqual(seen, []);
      assert.equal(asks().at(-1).mode, 'input');
    });

    it('a late release of the OLD login does not cancel a NEWER login on the same session', async () => {
      const seen = promptReply();
      const releaseOld = holdLogin();
      const old = bridge.login('x');
      await tick();
      fireExit('boom');
      holdLogin(); // the new login stays in flight
      bridge.login('y');
      await tick();
      releaseOld();
      await old;
      ev({ type: 'extension_ui_request', id: 'lg2', method: 'input', title: 'code?' });
      assert.deepEqual(seen, ['code?'], 'new login still owns the prompt');
      assert.equal(asks().length, 0);
    });

    it('closeSession clears the claim of that session', async () => {
      const seen = promptReply();
      holdLogin();
      const sid = bridge.activeSessionId;
      bridge.login('x');
      await tick();
      await bridge.closeSession(sid);
      await bridge.resumeSession({ id: sid, title: 'again', path: `C:\\s\\${sid}.jsonl`, cwd: '', is_standalone: true });
      ev(F19.text.input);
      assert.deepEqual(seen, []);
      assert.equal(asks().at(-1).mode, 'input');
    });
  });
});

describe('cleanup', () => {
  it('ask tool end cancels an unanswered bubble (18.x timeout sends no cancel frame)', () => {
    toolStart();
    ev(F18.singleSelect.frames[0]);
    toolEnd();
    assert.equal(asks()[0].state, 'cancelled');
  });

  it('ask tool end keeps an answered bubble answered and closes it (later asks never merge into it)', () => {
    toolStart();
    ev(F19.multiRounds.round1);
    bridge.answerAsk('19-m1', { value: 'Auth' });
    toolEnd();
    assert.equal(asks()[0].state, 'answered');
    assert.equal(asks()[0].closed, true);
    toolStart('tc-ask-2');
    ev({ ...F19.multiRounds.round1, id: 'next' });
    assert.equal(asks().length, 2);
  });

  it('abort() settles unanswered ask bubbles', () => {
    ev(F19.text.input);
    bridge.abort();
    assert.equal(asks()[0].state, 'cancelled');
  });

  it('abort() cancels a PENDING bubble too (the answer never reached a result)', () => {
    toolStart();
    ev(F19.multiRounds.round1);
    bridge.answerAsk('19-m1', { value: 'Auth' });
    assert.equal(asks()[0].state, 'pending');
    bridge.abort();
    assert.equal(asks()[0].state, 'cancelled');
    assert.equal(asks()[0].answered, false);
  });

  it('tool_execution_end with isError cancels a pending bubble; a clean end answers it', () => {
    toolStart();
    ev(F19.multiRounds.round1);
    bridge.answerAsk('19-m1', { value: 'Auth' });
    ev({ type: 'tool_execution_end', toolCallId: 'tc-ask', toolName: 'ask', isError: true, result: {} });
    assert.equal(asks()[0].state, 'cancelled');

    toolStart('tc-ask-2');
    ev({ ...F19.multiRounds.round1, id: 'n1' });
    bridge.answerAsk('n1', { value: 'Auth' });
    toolEnd('tc-ask-2');
    assert.equal(asks()[1].state, 'answered');
  });

  it('the ask card is recognised by the card, not only by ev.toolName (omitted on the end frame)', () => {
    toolStart();
    ev(F18.singleSelect.frames[0]);
    ev({ type: 'tool_execution_end', toolCallId: 'tc-ask', isError: false, result: {} });
    assert.equal(asks()[0].state, 'cancelled', 'unanswered bubble settled although the end frame has no toolName');
  });

  describe('get_state reports the agent is idle (e.g. after a tab switch restore)', () => {
    const getState = (isStreaming) => bridge._handleResponse({
      id: 777, command: 'get_state', success: true, data: { isStreaming },
    });

    it('a stale OPEN bubble is cancelled and closed, and the handshake dropped', () => {
      toolStart();
      ev(F19.singleSelect.frames[0]);
      bridge.answerAsk('19-s1', { custom: 'foo' }); // arms the handshake
      ev(F19.multiRounds.round1);
      getState(false);
      assert.equal(asks().at(-1).state, 'cancelled');
      assert.ok(asks().every(b => b.closed));
      ev(F19.text.input); // must be an inline bubble, not auto-answered by a leaked handshake
      assert.equal(responses().filter(r => r.value === 'foo').length, 0);
    });

    it('a pending bubble counts as answered (not an abort)', () => {
      toolStart();
      ev(F19.multiRounds.round1);
      bridge.answerAsk('19-m1', { value: 'Auth' });
      getState(false);
      assert.equal(asks()[0].state, 'answered');
    });

    it('a still-streaming agent keeps its live ask untouched', () => {
      toolStart();
      ev(F19.singleSelect.frames[0]);
      getState(true);
      assert.equal(asks()[0].state, 'open');
      assert.ok(!asks()[0].closed);
    });
  });

  it('a server cancel frame cancels the bubble by its current id only', () => {
    toolStart();
    ev(F19.multiRounds.round1);
    bridge.answerAsk('19-m1', { value: 'Auth' });
    ev(F19.multiRounds.round2); // id is now 19-m2
    ev({ type: 'extension_ui_request', id: 'c0', method: 'cancel', targetId: '19-m1' });
    assert.equal(asks()[0].state, 'open', 'late cancel for a superseded id is ignored');
    ev({ type: 'extension_ui_request', id: 'c1', method: 'cancel', targetId: '19-m2' });
    assert.equal(asks()[0].state, 'cancelled');
  });
});
