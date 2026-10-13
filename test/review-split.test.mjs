import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ReviewSplit = require('../src/review/review-split.js');

describe('ReviewSplit', () => {
  it('returns empty array for empty or non-array input', () => {
    assert.deepEqual(ReviewSplit.buildSplitRows([]), []);
    assert.deepEqual(ReviewSplit.buildSplitRows(null), []);
    assert.deepEqual(ReviewSplit.buildSplitRows(undefined), []);
  });

  it('aligns single line replacement (rem + add)', () => {
    const input = [
      { kind: 'hunk', text: '@@ -1,1 +1,1 @@' },
      { kind: 'rem', oldLine: 1, text: 'old line' },
      { kind: 'add', newLine: 1, text: 'new line' },
    ];

    const result = ReviewSplit.buildSplitRows(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].type, 'hunk');
    assert.equal(result[0].text, '@@ -1,1 +1,1 @@');

    assert.equal(result[1].type, 'row');
    assert.equal(result[1].left.kind, 'rem');
    assert.equal(result[1].left.lineNum, 1);
    assert.equal(result[1].left.text, 'old line');

    assert.equal(result[1].right.kind, 'add');
    assert.equal(result[1].right.lineNum, 1);
    assert.equal(result[1].right.text, 'new line');
  });

  it('aligns unequal deletions and additions (2 rems, 1 add)', () => {
    const input = [
      { kind: 'rem', oldLine: 10, text: 'delete 1' },
      { kind: 'rem', oldLine: 11, text: 'delete 2' },
      { kind: 'add', newLine: 10, text: 'insert 1' },
    ];

    const result = ReviewSplit.buildSplitRows(input);
    assert.equal(result.length, 2);

    assert.equal(result[0].left.kind, 'rem');
    assert.equal(result[0].left.lineNum, 10);
    assert.equal(result[0].right.kind, 'add');
    assert.equal(result[0].right.lineNum, 10);

    assert.equal(result[1].left.kind, 'rem');
    assert.equal(result[1].left.lineNum, 11);
    assert.equal(result[1].right.kind, 'empty');
    assert.equal(result[1].right.lineNum, null);
    assert.equal(result[1].right.text, '');
  });

  it('aligns unequal deletions and additions (1 rem, 3 adds)', () => {
    const input = [
      { kind: 'rem', oldLine: 5, text: 'delete 1' },
      { kind: 'add', newLine: 5, text: 'add 1' },
      { kind: 'add', newLine: 6, text: 'add 2' },
      { kind: 'add', newLine: 7, text: 'add 3' },
    ];

    const result = ReviewSplit.buildSplitRows(input);
    assert.equal(result.length, 3);

    assert.equal(result[0].left.kind, 'rem');
    assert.equal(result[0].left.lineNum, 5);
    assert.equal(result[0].right.kind, 'add');
    assert.equal(result[0].right.lineNum, 5);

    assert.equal(result[1].left.kind, 'empty');
    assert.equal(result[1].right.kind, 'add');
    assert.equal(result[1].right.lineNum, 6);

    assert.equal(result[2].left.kind, 'empty');
    assert.equal(result[2].right.kind, 'add');
    assert.equal(result[2].right.lineNum, 7);
  });

  it('preserves context rows on both sides', () => {
    const input = [
      { kind: 'ctx', oldLine: 1, newLine: 1, text: 'unchanged line' },
    ];

    const result = ReviewSplit.buildSplitRows(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'row');
    assert.equal(result[0].left.kind, 'ctx');
    assert.equal(result[0].left.lineNum, 1);
    assert.equal(result[0].left.text, 'unchanged line');
    assert.equal(result[0].right.kind, 'ctx');
    assert.equal(result[0].right.lineNum, 1);
    assert.equal(result[0].right.text, 'unchanged line');
  });

  it('flushes pending changes before hunk and no-newline', () => {
    const input = [
      { kind: 'rem', oldLine: 1, text: 'old' },
      { kind: 'no-newline', text: '\\ No newline at end of file' },
      { kind: 'hunk', text: '@@ -5,1 +5,1 @@' },
      { kind: 'add', newLine: 5, text: 'new' },
    ];

    const result = ReviewSplit.buildSplitRows(input);
    assert.equal(result.length, 4);
    assert.equal(result[0].type, 'row');
    assert.equal(result[0].left.kind, 'rem');
    assert.equal(result[1].type, 'no-newline');
    assert.equal(result[2].type, 'hunk');
    assert.equal(result[3].type, 'row');
    assert.equal(result[3].right.kind, 'add');
  });
});
