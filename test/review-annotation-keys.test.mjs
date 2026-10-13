import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Keys = require('../src/review/review-annotation-keys.js');
const ReviewDiff = require('../src/review/review-diff.js');

const RAW = `diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -12,3 +12,3 @@
 keep
-old twelve
+new twelve
`;

describe('ReviewAnnotationKeys', () => {
  const [file] = ReviewDiff.parseMultiFileDiff(RAW);

  it('gives a removed line and an added line with the same number distinct keys', () => {
    const rem = file.rows.find((r) => r.kind === 'rem');
    const add = file.rows.find((r) => r.kind === 'add');
    assert.equal(rem.oldLine, 13);
    assert.equal(add.newLine, 13);
    assert.equal(Keys.keyForRow(rem), 'old:13');
    assert.equal(Keys.keyForRow(add), 'new:13');
  });

  it('keys context rows by their new-side number and skips non-code rows', () => {
    const ctx = file.rows.find((r) => r.kind === 'ctx');
    assert.equal(Keys.keyForRow(ctx), 'new:12');
    assert.equal(Keys.keyForRow(file.rows.find((r) => r.kind === 'hunk')), null);
    assert.equal(Keys.keyForRow({ kind: 'no-newline', text: '\\ No newline' }), null);
    assert.equal(Keys.keyForRow(undefined), null);
  });

  it('parses new, old and legacy keys', () => {
    assert.deepEqual(Keys.parseKey('old:7'), { side: 'old', line: 7 });
    assert.deepEqual(Keys.parseKey('new:9'), { side: 'new', line: 9 });
    assert.deepEqual(Keys.parseKey('L42'), { side: 'legacy', line: 42 });
    assert.equal(Keys.parseKey('nonsense'), null);
    assert.equal(Keys.parseKey(null), null);
  });

  it('resolves keys back to the exact row (old vs new side)', () => {
    assert.equal(Keys.findRow(file, 'old:13').text, 'old twelve');
    assert.equal(Keys.findRow(file, 'new:13').text, 'new twelve');
    assert.equal(Keys.findRow(file, 'new:12').text, 'keep');
    assert.equal(Keys.findRow(file, 'new:99'), null);
    // Legacy keys prefer the new side.
    assert.equal(Keys.findRow(file, 'L13').text, 'new twelve');
  });

  it('sorts keys by line number then side', () => {
    const sorted = ['new:20', 'old:3', 'new:3', 'new:1'].sort(Keys.compareKeys);
    assert.deepEqual(sorted, ['new:1', 'new:3', 'old:3', 'new:20']);
  });
});
