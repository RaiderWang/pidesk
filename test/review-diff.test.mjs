import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ReviewDiff = require('../src/review/review-diff.js');

describe('ReviewDiff', () => {
  it('parses empty diff into empty array', () => {
    assert.deepEqual(ReviewDiff.parseMultiFileDiff(''), []);
    assert.deepEqual(ReviewDiff.parseMultiFileDiff(null), []);
  });

  it('parses single modified file diff', () => {
    const raw = `diff --git a/src/app.js b/src/app.js
index 1111..2222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;
    const files = ReviewDiff.parseMultiFileDiff(raw);
    assert.equal(files.length, 1);
    const f = files[0];
    assert.equal(f.path, 'src/app.js');
    assert.equal(f.linesAdded, 2);
    assert.equal(f.linesRemoved, 1);
    assert.equal(f.status, 'modified');

    const addRows = f.rows.filter(r => r.kind === 'add');
    assert.equal(addRows.length, 2);
    assert.equal(addRows[0].text, 'const b = 3;');
    assert.equal(addRows[0].newLine, 2);
    assert.equal(addRows[1].text, 'const c = 4;');
    assert.equal(addRows[1].newLine, 3);
  });

  it('parses newly added and deleted files', () => {
    const raw = `diff --git a/new-file.txt b/new-file.txt
new file mode 100644
--- /dev/null
+++ b/new-file.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/old-file.txt b/old-file.txt
deleted file mode 100644
--- a/old-file.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-goodbye
`;
    const files = ReviewDiff.parseMultiFileDiff(raw);
    assert.equal(files.length, 2);
    assert.equal(files[0].status, 'added');
    assert.equal(files[0].path, 'new-file.txt');
    assert.equal(files[0].linesAdded, 2);

    assert.equal(files[1].status, 'deleted');
    assert.equal(files[1].path, 'old-file.txt');
    assert.equal(files[1].linesRemoved, 1);
  });

  it('filters excluded lock and build files', () => {
    const raw = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-1
+2
diff --git a/src/index.js b/src/index.js
--- a/src/index.js
+++ b/src/index.js
@@ -1,1 +1,2 @@
+import x from 'y';
 x();
`;
    const files = ReviewDiff.parseMultiFileDiff(raw);
    const { displayFiles, excludedFiles, totalAdded, totalRemoved } = ReviewDiff.filterExcludedFiles(files);
    assert.equal(displayFiles.length, 1);
    assert.equal(displayFiles[0].path, 'src/index.js');
    assert.equal(excludedFiles.length, 1);
    assert.equal(excludedFiles[0].path, 'package-lock.json');
    assert.equal(excludedFiles[0].excludeReason, 'lockfile');
    assert.equal(totalAdded, 1);
    assert.equal(totalRemoved, 0);
  });

  it('decodes escaped git path tokens', () => {
    assert.equal(ReviewDiff.decodeGitPath('a/src/file.js'), 'src/file.js');
    assert.equal(ReviewDiff.decodeGitPath('"a/src/with space.js"'), 'src/with space.js');
  });

  it('decodes octal-escaped UTF-8 bytes as one character', () => {
    assert.equal(ReviewDiff.decodeGitPath('"a/caf\\303\\251.txt"'), 'café.txt');
    assert.equal(ReviewDiff.decodeGitPath('"a/tab\\there"'), 'tab\there');
  });

  it('keeps the full path for files whose names contain spaces', () => {
    const raw = `diff --git a/docs/my file.txt b/docs/my file.txt
index 1111..2222 100644
--- a/docs/my file.txt\t
+++ b/docs/my file.txt\t
@@ -1,1 +1,1 @@
-a
+b
`;
    const [f] = ReviewDiff.parseMultiFileDiff(raw);
    assert.equal(f.path, 'docs/my file.txt');
    assert.equal(f.oldPath, 'docs/my file.txt');
  });

  it('splits the diff --git header on the symmetric a/X b/X boundary', () => {
    assert.deepEqual(ReviewDiff.splitDiffGitHeader('a/x y/z w b/x y/z w'), ['a/x y/z w', 'b/x y/z w']);
    assert.deepEqual(ReviewDiff.splitDiffGitHeader('"a/q\\"r" "b/q\\"r"'), ['"a/q\\"r"', '"b/q\\"r"']);
    assert.deepEqual(ReviewDiff.splitDiffGitHeader('a/old.txt b/new.txt'), ['a/old.txt', 'b/new.txt']);
  });

  it('takes rename paths (with spaces) from rename from/to lines', () => {
    const raw = `diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
`;
    const [f] = ReviewDiff.parseMultiFileDiff(raw);
    assert.equal(f.status, 'renamed');
    assert.equal(f.oldPath, 'old name.txt');
    assert.equal(f.newPath, 'new name.txt');
    assert.equal(f.path, 'new name.txt');
  });

  it('does not mistake removed "-- x" lines inside a hunk for a --- header', () => {
    const raw = `diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,2 +1,1 @@
--- comment line
 select 1;
`;
    const [f] = ReviewDiff.parseMultiFileDiff(raw);
    assert.equal(f.path, 'q.sql');
    assert.equal(f.status, 'modified');
    assert.equal(f.linesRemoved, 1);
    assert.equal(f.rows.find((r) => r.kind === 'rem').text, '-- comment line');
  });

  it('keeps SVG diffs reviewable but still excludes raster images', () => {
    const raw = `diff --git a/logo.svg b/logo.svg
--- a/logo.svg
+++ b/logo.svg
@@ -1 +1 @@
-<svg/>
+<svg />
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;
    const { displayFiles, excludedFiles } = ReviewDiff.filterExcludedFiles(
      ReviewDiff.parseMultiFileDiff(raw)
    );
    assert.deepEqual(displayFiles.map((f) => f.path), ['logo.svg']);
    assert.deepEqual(excludedFiles.map((f) => f.path), ['logo.png']);
  });

  it('re-joins only the non-excluded files for the prompt', () => {
    const raw = `diff --git a/Cargo.lock b/Cargo.lock
--- a/Cargo.lock
+++ b/Cargo.lock
@@ -1 +1 @@
-x
+y
diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1 +1 @@
-1
+2
`;
    const { displayFiles } = ReviewDiff.filterExcludedFiles(ReviewDiff.parseMultiFileDiff(raw));
    const joined = ReviewDiff.joinFileDiffs(displayFiles);
    assert.ok(joined.includes('src/a.js'));
    assert.ok(!joined.includes('Cargo.lock'));
    assert.ok(joined.endsWith('+2\n'));
    assert.equal(ReviewDiff.joinFileDiffs([]), '');
    // Round-trips through the parser.
    assert.equal(ReviewDiff.parseMultiFileDiff(joined).length, 1);
  });
});
