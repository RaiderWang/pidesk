import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isContentless } = require('../src/app/empty-bubble.js');

const asst = (over = {}) => ({ kind: 'assistant', thought: null, blocks: [], ...over });

describe('EmptyBubble.isContentless', () => {
  it('true for placeholder / empty blocks', () => {
    assert.equal(isContentless(asst()), true);
    assert.equal(isContentless(asst({ blocks: [{ type: 'text', text: '' }] })), true);
    assert.equal(isContentless({ kind: 'assistant' }), true);
  });

  it('whitespace-only text and thought count as empty', () => {
    assert.equal(isContentless(asst({ blocks: [{ type: 'text', text: '\n\n ' }] })), true);
    assert.equal(isContentless(asst({ thought: '  \n' })), true);
  });

  it('false when there is text, thought, plan or error', () => {
    assert.equal(isContentless(asst({ blocks: [{ type: 'text', text: 'hi' }] })), false);
    assert.equal(isContentless(asst({ thought: 'hmm' })), false);
    assert.equal(isContentless(asst({ blocks: [{ type: 'plan', phases: [] }] })), false);
    assert.equal(isContentless(asst({ error: { message: 'boom' } })), false);
  });

  it('false for notices and non-assistant messages', () => {
    assert.equal(isContentless(asst({ notice: true })), false);
    assert.equal(isContentless({ kind: 'user', text: '' }), false);
    assert.equal(isContentless({ kind: 'tool' }), false);
    assert.equal(isContentless(null), false);
  });
});
