import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/shim.mjs';

const require = createRequire(import.meta.url);
const BranchSession = require('../src/app/branch-session.js');

let seq = 0;
function entry(role, content, parentId) {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  return { type: 'message', id: `e${++seq}`, parentId, message: { role, content: blocks } };
}
/** Linear chain from [role, content] pairs. */
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
const leafOf = (es) => es[es.length - 1].id;

const uiUser = (text, extra = {}) => ({ kind: 'user', text, images: [], ...extra });
const uiAsst = (text, extra = {}) => ({ kind: 'assistant', blocks: [{ type: 'text', text }], ...extra });
const uiTool = () => ({ kind: 'tool', toolCallId: 't1' });
const uiEmptyAsst = () => ({ kind: 'assistant', blocks: [{ type: 'text', text: '' }], thought: null });

describe('BranchSession.pickSourcePath', () => {
  const sessions = [
    { id: 'newest', path: 'C:\\s\\proj\\new.jsonl' },
    { id: 'mine', path: 'C:\\s\\proj\\mine.jsonl' },
  ];

  it('matches the active file by normalised path, not the newest one', () => {
    assert.equal(BranchSession.pickSourcePath(sessions, 'c:/s/proj/MINE.jsonl', null), 'C:\\s\\proj\\mine.jsonl');
  });

  it('falls back to the saved session id', () => {
    assert.equal(BranchSession.pickSourcePath(sessions, null, 'mine'), 'C:\\s\\proj\\mine.jsonl');
  });

  it('trusts the reported file when the scan does not list it', () => {
    assert.equal(BranchSession.pickSourcePath(sessions, 'C:\\other\\x.jsonl', null), 'C:\\other\\x.jsonl');
  });

  it('uses the newest scan entry only when nothing is known, and null when empty', () => {
    assert.equal(BranchSession.pickSourcePath(sessions, null, null), 'C:\\s\\proj\\new.jsonl');
    assert.equal(BranchSession.pickSourcePath([], null, null), null);
  });
});

describe('BranchSession.resolveTarget', () => {
  it('resolves an assistant bubble on an un-trimmed conversation', () => {
    const es = chain([
      ['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2'], ['user', 'q3'], ['assistant', 'a3'],
    ]);
    const ui = [uiUser('q1'), uiAsst('a1'), uiUser('q2'), uiAsst('a2'), uiUser('q3'), uiAsst('a3')];
    assert.equal(BranchSession.resolveTarget(ui, 3, es, leafOf(es)), es[3].id);
  });

  it('resolves correctly after head trimming', () => {
    const es = chain([
      ['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2'],
      ['user', 'q3'], ['assistant', 'a3'], ['user', 'q4'], ['assistant', 'a4'],
    ]);
    const trimmed = [uiUser('q3'), uiAsst('a3'), uiUser('q4'), uiAsst('a4')];
    assert.equal(BranchSession.resolveTarget(trimmed, 1, es, leafOf(es)), es[5].id);
  });

  it('skips toolResult rows, tool-call-only turns, tool cards and empty bubbles', () => {
    const es = chain([
      ['user', 'q1'],
      ['assistant', [{ type: 'toolCall', id: 'c1', name: 'read' }]], // no bubble
      ['toolResult', [{ type: 'text', text: 'file body' }]],
      ['assistant', 'a1'],
      ['user', 'q2'],
      ['assistant', 'a2'],
    ]);
    const ui = [uiUser('q1'), uiEmptyAsst(), uiTool(), uiAsst('a1'), uiUser('q2'), uiAsst('a2')];
    assert.equal(BranchSession.resolveTarget(ui, 3, es, leafOf(es)), es[3].id);
  });

  it('matches thought-only assistant turns', () => {
    const es = chain([
      ['user', 'q1'],
      ['assistant', [{ type: 'thinking', thinking: 'let me think' }, { type: 'toolCall', id: 'c1' }]],
      ['toolResult', 'out'],
      ['assistant', 'a1'],
    ]);
    const ui = [
      uiUser('q1'),
      { kind: 'assistant', blocks: [{ type: 'text', text: '' }], thought: 'let me think' },
      uiAsst('a1'),
    ];
    assert.equal(BranchSession.resolveTarget(ui, 1, es, leafOf(es)), es[1].id);
  });

  it('follows the active leaf chain, ignoring abandoned side branches', () => {
    const base = chain([['user', 'q1'], ['assistant', 'a1']]);
    const abandoned = entry('user', 'q2-old', base[1].id);
    const live = entry('user', 'q2', base[1].id);
    const liveA = entry('assistant', 'a2', live.id);
    const es = [...base, abandoned, live, liveA];
    const ui = [uiUser('q1'), uiAsst('a1'), uiUser('q2'), uiAsst('a2')];
    assert.equal(BranchSession.resolveTarget(ui, 3, es, liveA.id), liveA.id);
  });

  it('refuses (null) instead of guessing', () => {
    const es = chain([['user', 'q1'], ['assistant', 'ok'], ['user', 'q2'], ['assistant', 'ok']]);
    const leaf = leafOf(es);
    // not a text bubble / out of range
    assert.equal(BranchSession.resolveTarget([uiTool()], 0, es, leaf), null);
    assert.equal(BranchSession.resolveTarget([uiUser('q1')], -1, es, leaf), null);
    assert.equal(BranchSession.resolveTarget([], 0, es, leaf), null);
    // text differs
    assert.equal(BranchSession.resolveTarget([uiUser('q1'), uiAsst('different')], 1, es, leaf), null);
    // a short text must not match by substring
    assert.equal(BranchSession.resolveTarget([uiUser('q1'), uiAsst('o')], 1, es, leaf), null);
    // more UI bubbles than stored entries (e.g. an unpersisted steer bubble)
    const ui = [uiUser('q1'), uiAsst('ok'), uiUser('q2'), uiAsst('ok'), uiUser('steer')];
    assert.equal(BranchSession.resolveTarget(ui, 3, es, leaf), null);
  });

  it('treats an image-only user message as a bubble', () => {
    const es = chain([['user', [{ type: 'image', data: 'AAA', mimeType: 'image/png' }]], ['assistant', 'seen']]);
    const ui = [uiUser('', { images: [{ type: 'image', data: 'AAA' }] }), uiAsst('seen')];
    assert.equal(BranchSession.resolveTarget(ui, 1, es, leafOf(es)), es[1].id);
  });
});
