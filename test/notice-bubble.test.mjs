import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/shim.mjs';

const require = createRequire(import.meta.url);
const NoticeBubble = require('../src/app/notice-bubble.js');
const MessageMerge = require('../src/app/message-merge.js');

const u = (text) => ({ kind: 'user', text, images: [] });
const a = (text) => ({ kind: 'assistant', blocks: [{ type: 'text', text }] });

describe('NoticeBubble.make', () => {
  it('produces a completed assistant bubble with a text block and no bare text field', () => {
    const b = NoticeBubble.make('⚠️ **oops**', '09:31:50');
    assert.equal(b.kind, 'assistant');
    assert.equal(b.time, '09:31:50');
    assert.deepEqual(b.blocks, [{ type: 'text', text: '⚠️ **oops**' }]);
    assert.equal(b.streaming, false);
    assert.equal(b.completed, true);
    assert.equal('text' in b, false);
  });

  it('tags the bubble as a client-side notice and carries an optional model', () => {
    const b = NoticeBubble.make('hi', '10:00:00', 'gpt-x');
    assert.equal(b.notice, true);
    assert.equal(NoticeBubble.isNotice(b), true);
    assert.equal(b.model, 'gpt-x');
    assert.equal(NoticeBubble.make('hi').model, null);
    assert.equal(NoticeBubble.isNotice(a('hi')), false);
    assert.equal(NoticeBubble.isNotice(null), false);
  });

  it('coerces nullish text to an empty string', () => {
    assert.equal(NoticeBubble.make(null).blocks[0].text, '');
  });
});

describe('NoticeBubble × MessageMerge', () => {
  it('is not treated as an empty bubble (survives the merge)', () => {
    const b = NoticeBubble.make('hello');
    assert.equal(MessageMerge.isEmptyBubble(b), false);
    const merged = MessageMerge.merge([b], []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].blocks[0].text, 'hello');
  });

  it('keeps the notice in place on a non-empty conversation without breaking alignment', () => {
    const notice = NoticeBubble.make('switch failed');
    const u1 = { ...u('q1'), _id: 'k1' };
    const a1 = { ...a('a1'), _id: 'k2' };
    const merged = MessageMerge.merge([u1, a1, notice], [u('q1'), a('a1')]);
    assert.equal(merged.length, 3);
    assert.equal(merged[0]._id, 'k1', 'local React keys are preserved (no remount)');
    assert.equal(merged[1]._id, 'k2');
    assert.equal(merged[2], notice);
  });

  it('keeps the notice and appends turns that finished in the background', () => {
    const notice = NoticeBubble.make('switch failed');
    const merged = MessageMerge.merge([u('q1'), a('a1'), notice], [u('q1'), a('a1'), u('q2'), a('a2')]);
    assert.equal(merged.length, 5);
    assert.equal(merged[2], notice);
    assert.equal(merged[3].text, 'q2');
    assert.equal(merged[4].blocks[0].text, 'a2');
  });

  it('keeps the notice even when no alignment is found', () => {
    const notice = NoticeBubble.make('switch failed');
    const merged = MessageMerge.merge([u('stale'), notice], [u('q1'), a('a1')]);
    assert.ok(merged.includes(notice));
    assert.equal(merged.filter((m) => m.kind === 'user' && m.text === 'stale').length, 0);
  });
});
