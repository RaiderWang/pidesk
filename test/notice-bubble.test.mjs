import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/shim.mjs';

const require = createRequire(import.meta.url);
const NoticeBubble = require('../src/app/notice-bubble.js');
const MessageMerge = require('../src/app/message-merge.js');

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

  it('is not treated as an empty bubble by MessageMerge (survives get_messages merge)', () => {
    const b = NoticeBubble.make('hello');
    assert.equal(MessageMerge.isEmptyBubble(b), false);
    const merged = MessageMerge.merge([b], []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].blocks[0].text, 'hello');
  });

  it('coerces nullish text to an empty string', () => {
    assert.equal(NoticeBubble.make(null).blocks[0].text, '');
  });
});
