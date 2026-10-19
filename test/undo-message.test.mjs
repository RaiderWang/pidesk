import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/shim.mjs';

const require = createRequire(import.meta.url);
const UndoMessage = require('../src/app/undo-message.js');

// ── fixtures ────────────────────────────────────────────────────────────
let seq = 0;
function msgEntry(role, content, parentId) {
  const id = `e${++seq}`;
  return { type: 'message', id, parentId, message: { role, content } };
}
function userEntry(text, parentId, images = []) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const data of images) content.push({ type: 'image', data, mimeType: 'image/png' });
  return msgEntry('user', content, parentId);
}
function asstEntry(text, parentId) {
  return msgEntry('assistant', [{ type: 'text', text }], parentId);
}
/** Linear chain: [u1, a1, u2, a2, ...] */
function chain(turns) {
  const out = [];
  let parent = null;
  for (const [u, a] of turns) {
    const ue = userEntry(u, parent);
    out.push(ue);
    const ae = asstEntry(a, ue.id);
    out.push(ae);
    parent = ae.id;
  }
  return out;
}
const ui = (kind, text, extra = {}) => ({ kind, text, ...extra });

describe('UndoMessage.activeUserEntries', () => {
  it('returns user entries root-first on a linear branch', () => {
    const entries = chain([['one', 'A1'], ['two', 'A2'], ['three', 'A3']]);
    const leaf = entries[entries.length - 1].id;
    const users = UndoMessage.activeUserEntries(entries, leaf);
    assert.deepEqual(users.map((e) => e.message.content[0].text), ['one', 'two', 'three']);
  });

  it('ignores entries on side branches (outside the leaf chain)', () => {
    const entries = chain([['one', 'A1'], ['two', 'A2']]);
    const side = userEntry('abandoned', entries[1].id); // sibling of "two"
    const all = [...entries, side];
    const leaf = entries[entries.length - 1].id;
    const users = UndoMessage.activeUserEntries(all, leaf);
    assert.deepEqual(users.map((e) => e.message.content[0].text), ['one', 'two']);
  });

  it('skips non-message entries and empty user messages, keeps image-only ones', () => {
    const u1 = userEntry('hello', null);
    const comp = { type: 'compaction', id: 'c1', parentId: u1.id };
    const empty = userEntry('', comp.id);
    const imgOnly = userEntry('', empty.id, ['AAA']);
    const entries = [u1, comp, empty, imgOnly];
    const users = UndoMessage.activeUserEntries(entries, imgOnly.id);
    assert.deepEqual(users.map((e) => e.id), [u1.id, imgOnly.id]);
  });

  it('falls back to the last entry when leafId is unknown, and tolerates empty input', () => {
    const entries = chain([['one', 'A1']]);
    assert.equal(UndoMessage.activeUserEntries(entries, 'nope').length, 1);
    assert.deepEqual(UndoMessage.activeUserEntries([], null), []);
    assert.deepEqual(UndoMessage.activeUserEntries(null, null), []);
  });

  it('does not loop forever on a parent cycle', () => {
    const a = { type: 'message', id: 'a', parentId: 'b', message: { role: 'user', content: 'x' } };
    const b = { type: 'message', id: 'b', parentId: 'a', message: { role: 'user', content: 'y' } };
    assert.equal(UndoMessage.activeUserEntries([a, b], 'a').length, 2);
  });
});

describe('UndoMessage.resolveTarget (tail alignment)', () => {
  const entries = chain([['one', 'A1'], ['two', 'A2'], ['three', 'A3']]);
  const users = UndoMessage.activeUserEntries(entries, entries[entries.length - 1].id);

  it('finds the middle message', () => {
    const msgs = [
      ui('user', 'one'), ui('assistant', 'A1'),
      ui('user', 'two'), ui('tool', ''), ui('assistant', 'A2'),
      ui('user', 'three'), ui('assistant', 'A3'),
    ];
    const r = UndoMessage.resolveTarget(msgs, 2, users);
    assert.equal(r.entryId, users[1].id);
    assert.equal(r.text, 'two');
  });

  it('finds the first and the last message when the UI mirrors the whole file', () => {
    const msgs = [
      ui('user', 'one'), ui('assistant', 'A1'),
      ui('user', 'two'), ui('assistant', 'A2'),
      ui('user', 'three'), ui('assistant', 'A3'),
    ];
    assert.equal(UndoMessage.resolveTarget(msgs, 0, users).entryId, users[0].id);
    assert.equal(UndoMessage.resolveTarget(msgs, 4, users).entryId, users[2].id);
  });

  it('still hits the right entry when the UI list was head-trimmed', () => {
    // UI lost "one"; the file still has it.
    const msgs = [ui('assistant', 'A1'), ui('user', 'two'), ui('assistant', 'A2'), ui('user', 'three')];
    assert.equal(UndoMessage.resolveTarget(msgs, 1, users).entryId, users[1].id);
    assert.equal(UndoMessage.resolveTarget(msgs, 3, users).entryId, users[2].id);
  });

  it('works after compaction (file has more user entries than the UI)', () => {
    const big = chain([['old1', 'x'], ['old2', 'x'], ['two', 'A2'], ['three', 'A3']]);
    const u = UndoMessage.activeUserEntries(big, big[big.length - 1].id);
    const msgs = [ui('user', 'two'), ui('assistant', 'A2'), ui('user', 'three'), ui('assistant', 'A3')];
    assert.equal(UndoMessage.resolveTarget(msgs, 0, u).entryId, u[2].id);
  });

  it('counts image-only user messages', () => {
    const e1 = userEntry('hi', null);
    const e2 = userEntry('', e1.id, ['IMG']);
    const e3 = userEntry('bye', e2.id);
    const u = UndoMessage.activeUserEntries([e1, e2, e3], e3.id);
    const msgs = [ui('user', 'hi'), ui('user', '', { images: [{ data: 'IMG' }] }), ui('user', 'bye')];
    assert.equal(UndoMessage.resolveTarget(msgs, 1, u).entryId, e2.id);
    assert.equal(UndoMessage.resolveTarget(msgs, 2, u).entryId, e3.id);
  });

  it('ignores whitespace/newline differences between UI and file text', () => {
    const e = userEntry('line1line2', null); // omp joins blocks with ""
    const u = UndoMessage.activeUserEntries([e], e.id);
    const msgs = [ui('user', 'line1\nline2')]; // UI joins with "\n"
    assert.equal(UndoMessage.resolveTarget(msgs, 0, u).entryId, e.id);
  });

  it('matches multi-block text plus an image, and rejects the same text without the image', () => {
    // File: two text blocks (joined with "") + an image; UI: joined with "\n".
    const content = [
      { type: 'text', text: 'first part ' },
      { type: 'text', text: 'second part' },
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    ];
    const e = msgEntry('user', content, null);
    const u = UndoMessage.activeUserEntries([e], e.id);

    const withImage = [ui('user', 'first part \nsecond part', { images: [{ type: 'image', data: 'QUJD' }] })];
    assert.equal(UndoMessage.resolveTarget(withImage, 0, u).entryId, e.id);

    const noImage = [ui('user', 'first part \nsecond part', { images: [] })];
    assert.equal(UndoMessage.resolveTarget(noImage, 0, u), null, 'image presence must agree');
  });

  it('returns null when text does not match (e.g. steer bubble not persisted)', () => {
    const msgs = [ui('user', 'one'), ui('assistant', 'A1'), ui('user', 'two'), ui('assistant', 'A2'),
      ui('user', 'three'), ui('assistant', 'A3'), ui('user', 'steered but never saved')];
    assert.equal(UndoMessage.resolveTarget(msgs, 6, users), null);
    assert.equal(UndoMessage.resolveTarget(msgs, 2, users), null);
  });

  it('returns null when the image presence differs', () => {
    const msgs = [ui('user', 'one', { images: [{ data: 'x' }] })];
    const e = userEntry('one', null);
    const u = UndoMessage.activeUserEntries([e], e.id);
    assert.equal(UndoMessage.resolveTarget(msgs, 0, u), null);
  });

  it('returns null for non-user bubbles, bad indices and too-few entries', () => {
    const msgs = [ui('user', 'one'), ui('assistant', 'A1')];
    assert.equal(UndoMessage.resolveTarget(msgs, 1, users), null);
    assert.equal(UndoMessage.resolveTarget(msgs, 9, users), null);
    const many = [ui('user', 'a'), ui('user', 'b'), ui('user', 'c'), ui('user', 'd')];
    assert.equal(UndoMessage.resolveTarget(many, 0, users), null);
  });
});

describe('UndoMessage.countAffected', () => {
  it('counts conversation turns and tool cards after the target', () => {
    const msgs = [
      ui('user', 'a'), ui('assistant', 'b'),
      ui('user', 'c'), ui('tool', ''), ui('tool', ''), ui('assistant', 'd'), ui('compact', ''),
    ];
    assert.deepEqual(UndoMessage.countAffected(msgs, 2), { messages: 1, tools: 2 });
    assert.deepEqual(UndoMessage.countAffected(msgs, 0), { messages: 3, tools: 2 });
    assert.deepEqual(UndoMessage.countAffected(null, 0), { messages: 0, tools: 0 });
  });

  it('does not count client-side notice bubbles', () => {
    const msgs = [ui('user', 'a'), ui('assistant', 'b'), { ...ui('assistant', 'oops'), notice: true }];
    assert.deepEqual(UndoMessage.countAffected(msgs, 0), { messages: 1, tools: 0 });
  });
});

describe('UndoMessage.stripPlanFraming', () => {
  const { t } = globalThis.I18N;

  it('strips the English framing', () => {
    const wrapped = t('plan.intentFraming', { intent: 'build a thing' }, undefined, 'en');
    const r = UndoMessage.stripPlanFraming(wrapped, t);
    assert.equal(r.stripped, true);
    assert.equal(r.text, 'build a thing');
  });

  it('strips the Chinese framing regardless of the current locale', () => {
    const wrapped = t('plan.intentFraming', { intent: '做一个东西' }, undefined, 'zh-CN');
    const r = UndoMessage.stripPlanFraming(wrapped, t);
    assert.equal(r.stripped, true);
    assert.equal(r.text, '做一个东西');
  });

  it('leaves unrelated text untouched', () => {
    assert.deepEqual(UndoMessage.stripPlanFraming('just a normal message', t), {
      text: 'just a normal message',
      stripped: false,
    });
    assert.deepEqual(UndoMessage.stripPlanFraming(undefined, t), { text: '', stripped: false });
  });
});

describe('UndoMessage.toComposerImages', () => {
  it('converts RPC image blocks to composer attachments', () => {
    const out = UndoMessage.toComposerImages([{ type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].dataUrl, 'data:image/jpeg;base64,QUJD');
    assert.equal(out[0].data, 'QUJD');
    assert.equal(out[0].mimeType, 'image/jpeg');
    assert.match(out[0].name, /\.jpeg$/);
    assert.ok(out[0].id);
  });

  it('keeps an existing dataUrl, drops empties, tolerates non-arrays', () => {
    const out = UndoMessage.toComposerImages([{ dataUrl: 'data:image/png;base64,Zg==', data: 'Zg==' }, {}, null]);
    assert.equal(out.length, 1);
    assert.equal(out[0].dataUrl, 'data:image/png;base64,Zg==');
    assert.deepEqual(UndoMessage.toComposerImages(null), []);
  });
});
