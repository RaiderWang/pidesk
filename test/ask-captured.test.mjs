/**
 * test/ask-captured.test.mjs
 *
 * Golden replay of REAL omp `ask` sessions recorded by test/tools/capture-ask.mjs
 * (test/fixtures/captured/ask-<omp version>-<scenario>.jsonl).
 *
 * Every recorded inbound frame is fed to live.js (`_handleEvent`); every recorded
 * outbound answer is re-issued through the public bridge API the way the UI would
 * (`answerAsk` value / custom). The test then asserts that live.js put the SAME
 * extension_ui_response frames on the wire, left no open/pending bubble behind and
 * kept the ask card ordering. No captures on disk → the suite is skipped.
 *
 * Run: node --test test/ask-captured.test.mjs
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';
import { loadLive } from './helpers/load-live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src');
const CAPTURE_DIR = join(HERE, 'fixtures', 'captured');
const loadScript = (rel) => new Function(readFileSync(join(SRC, rel), 'utf-8'))();

const captures = existsSync(CAPTURE_DIR)
  ? readdirSync(CAPTURE_DIR).filter(f => /^ask-.*\.jsonl$/.test(f)).sort()
  : [];

loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('app/message-merge.js');
loadScript('app/branch-session.js');
loadScript('undo-bridge.js');
loadScript('export-bridge.js');
loadLive();

const bridge = globalThis.OMP_BRIDGE;
const M = globalThis.AskModel;

let rpc = [];
before(() => {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        if (name === 'send_command') rpc.push(JSON.parse(args.json));
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
});

let tabN = 0;
beforeEach(async () => {
  rpc = [];
  globalThis.prompt = () => null;
  const n = ++tabN;
  await bridge.resumeSession({ id: `cap-${n}`, title: `C${n}`, path: `C:\\s\\cap-${n}.jsonl`, cwd: '', is_standalone: true });
  rpc = [];
});

const msgs = () => bridge.getState().messages;
const asks = () => msgs().filter(m => m.kind === 'ask');
const responses = () => rpc.filter(c => c.type === 'extension_ui_response');

function load(file) {
  const rows = readFileSync(join(CAPTURE_DIR, file), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  return { meta: rows[0].meta, rows: rows.slice(1) };
}

/** Replay one capture; returns the recorded outs the bridge was expected to send. */
function replay(rows, onToolStart) {
  const expected = [];
  const answered = new Set();
  rows.forEach((row, i) => {
    const f = row.frame;
    if (row.dir === 'in') {
      bridge._handleEvent(f);
      if (f.type === 'tool_execution_start' && onToolStart) onToolStart();
      return;
    }
    expected.push([f.id, f.value ?? null, f.cancelled === true]);
    if (answered.has(i)) return; // sent by the handshake after an Other pick, not by the UI
    const bubble = asks().find(b => b.id === f.id);
    assert.ok(bubble, `bubble for recorded answer ${f.id} exists`);
    if (f.cancelled) { bridge.cancelAsk(f.id); return; }
    // 19.x: a standalone input/editor request is answered with text, not a select value.
    if (bubble.mode === 'input' || bubble.mode === 'editor') {
      bridge.answerAsk(f.id, { text: f.value ?? '' });
      return;
    }
    // 19.x: re-sending the Other row while it is ticked only unticks it (no input follow-up).
    if (bubble.multi && bubble.otherChecked && bubble.otherRow && f.value === bubble.otherRow) {
      bridge.answerAsk(f.id, { clearOther: true });
      return;
    }
    if (bubble.otherRow && f.value === bubble.otherRow) {
      // Other row → the very next recorded out is the free text answered to the follow-up input/editor.
      const next = rows.findIndex((r, j) => j > i && r.dir === 'out');
      assert.ok(next > i, 'Other pick is followed by a text answer');
      answered.add(next);
      bridge.answerAsk(f.id, { custom: rows[next].frame.value });
      return;
    }
    bridge.answerAsk(f.id, { value: f.value });
  });
  return expected;
}

/**
 * One bubble per merged select question plus one per standalone input/editor request.
 * An input/editor right after an "Other" pick is the handshake follow-up (auto-answered,
 * no bubble of its own), so it is not counted.
 */
function distinctQuestions(rows) {
  const selects = new Set();
  let standalone = 0;
  let afterOther = false;
  for (const { dir, frame: f } of rows) {
    if (dir === 'out') {
      afterOther = typeof f.value === 'string' && Boolean(M.findOtherRow([f.value]));
    } else if (f.method === 'select') {
      selects.add(M.normalizeTitle(f.title));
    } else if (f.method === 'input' || f.method === 'editor') {
      if (!afterOther) standalone += 1;
      afterOther = false;
    }
  }
  return selects.size + standalone;
}

// The 18.4.3 captures never exercise the 19.x-only branches of replay(); cover them with
// source-derived frames until a 19.0.1 capture exists.
describe('replay mapping for 19.x-only answers (source-derived frames)', () => {
  const F19 = JSON.parse(readFileSync(join(HERE, 'fixtures', 'ask-frames-19.json'), 'utf-8')).scenarios;
  const out = (id, extra) => ({ dir: 'out', frame: { type: 'extension_ui_response', id, ...extra } });
  const inn = (frame) => ({ dir: 'in', frame });

  it('a standalone input is answered with text', () => {
    const f = F19.text.input;
    const expected = replay([inn(f), out(f.id, { value: 'proj' })]);
    assert.deepEqual(responses().map(r => [r.id, r.value ?? null, r.cancelled === true]), expected);
    assert.equal(responses()[0].value, 'proj');
  });

  it('unticking Other sends the row only and arms no handshake', () => {
    const f = F19.multiRounds.round3Other;
    const other = f.options[f.checkedIndices.find(i => f.options[i].startsWith('Other'))];
    const expected = replay([inn(f), out(f.id, { value: other })]);
    assert.deepEqual(responses().map(r => [r.id, r.value ?? null, r.cancelled === true]), expected);
    bridge._handleEvent(F19.text.input); // would be auto-answered by a leaked handshake
    assert.equal(responses().length, 1, 'the later input stayed an inline bubble');
  });
});

if (captures.length === 0) {
  describe('captured ask replay', () => {
    it('no captures on disk (run test/tools/capture-ask.mjs)', { skip: true }, () => {});
  });
}

for (const file of captures) {
  describe(`captured ${file}`, () => {
    it('puts the recorded frames on the wire in order', () => {
      const { rows } = load(file);
      const expected = replay(rows);
      assert.deepEqual(
        responses().map(r => [r.id, r.value ?? null, r.cancelled === true]),
        expected,
      );
    });

    it('leaves no open/pending bubble and one bubble per question', () => {
      const { rows } = load(file);
      replay(rows);
      assert.deepEqual(asks().filter(b => b.state === 'open' || b.state === 'pending'), []);
      assert.equal(asks().length, distinctQuestions(rows));
    });

    it('the ask card is hoisted above its live bubbles when tool_execution_start arrives', () => {
      // The select frame precedes tool_execution_start in real omp; the card must still end up first.
      const { rows } = load(file);
      let checks = 0;
      replay(rows, () => {
        const list = msgs();
        const cardIdx = list.findIndex(m => m.kind === 'tool' && m.tool === 'ask');
        assert.ok(cardIdx >= 0, 'ask tool card exists after tool_execution_start');
        const live = list.map((m, i) => (m.kind === 'ask' && !m.closed ? i : -1)).filter(i => i >= 0);
        assert.ok(live.every(i => i > cardIdx), 'no live ask bubble precedes the card');
        checks += 1;
      });
      assert.equal(checks, rows.filter(r => r.dir === 'in' && r.frame.type === 'tool_execution_start').length);
    });
  });
}
