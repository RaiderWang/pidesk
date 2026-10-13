import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ReviewPrompt = require('../src/review/review-prompt.js');
const ReviewDiff = require('../src/review/review-diff.js');

describe('ReviewPrompt', () => {
  it('formats annotations correctly in Chinese and English', () => {
    const annotations = {
      'src/main.js': {
        L42: '缺少空指针防护',
        L88: '优化循环性能',
      },
    };

    const textZh = ReviewPrompt.formatAnnotations(annotations, 'zh');
    assert.ok(textZh.includes('用户特定批注与要求'));
    assert.ok(textZh.includes('src/main.js'));
    assert.ok(textZh.includes('行 42'));
    assert.ok(textZh.includes('缺少空指针防护'));

    const textEn = ReviewPrompt.formatAnnotations(annotations, 'en');
    assert.ok(textEn.includes('User Annotations & Directives'));
    assert.ok(textEn.includes('Line 42'));
  });

  it('builds standard inline prompt for modest diffs', () => {
    const prompt = ReviewPrompt.buildReviewPrompt({
      targetMode: 'uncommitted',
      targetLabel: '未提交更改',
      files: [{ path: 'src/a.js', linesAdded: 5, linesRemoved: 2, status: 'modified' }],
      rawDiff: 'diff --git a/src/a.js b/src/a.js\n+hello\n-world',
      annotations: { 'src/a.js': { L1: '注意这个修改' } },
      focusInstructions: '重点审查并发与异常处理',
      lang: 'zh',
    });

    assert.ok(prompt.includes('代码审查请求 (未提交更改)'));
    assert.ok(prompt.includes('重点关注方向'));
    assert.ok(prompt.includes('并发与异常处理'));
    assert.ok(prompt.includes('注意这个修改'));
    assert.ok(prompt.includes('```diff'));
    assert.ok(prompt.includes('+hello'));
  });

  it('quotes the annotated line and tells removed lines apart from added ones', () => {
    const files = ReviewDiff.parseMultiFileDiff(`diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -12,2 +12,2 @@
-const secret = 1;
+const secret = readEnv();
 tail();
`);
    const text = ReviewPrompt.formatAnnotations(
      { 'a.js': { 'new:12': '确认异常处理', 'old:12': '为什么删掉？' } },
      'zh',
      files
    );
    assert.ok(text.includes('**原行 12（已删除）** `const secret = 1;`: 为什么删掉？'));
    assert.ok(text.includes('**行 12** `const secret = readEnv();`: 确认异常处理'));

    const en = ReviewPrompt.formatAnnotations({ 'a.js': { 'old:12': 'why?' } }, 'en', files);
    assert.ok(en.includes('**Old line 12 (removed)**'));
  });

  it('sorts notes by line and strips backticks from quoted code', () => {
    const files = ReviewDiff.parseMultiFileDiff(`diff --git a/m.md b/m.md
--- a/m.md
+++ b/m.md
@@ -1,1 +1,2 @@
+use \`x\`
+second
`);
    const text = ReviewPrompt.formatAnnotations(
      { 'm.md': { 'new:2': 'B', 'new:1': 'A' } },
      'en',
      files
    );
    assert.ok(text.indexOf('Line 1') < text.indexOf('Line 2'));
    assert.ok(text.includes("`use 'x'`"));
  });

  it('uses a longer fence when the diff itself contains a code fence', () => {
    const rawDiff = 'diff --git a/R.md b/R.md\n+```js\n+x\n+```';
    const prompt = ReviewPrompt.buildReviewPrompt({
      files: [{ path: 'R.md', linesAdded: 3, linesRemoved: 0, status: 'modified' }],
      rawDiff,
      lang: 'en',
    });
    assert.ok(prompt.includes('````diff\n'));
    assert.ok(prompt.includes('+```\n````'));
    assert.equal(ReviewPrompt.fenceBlock('plain', 'diff'), '```diff\nplain\n```');
  });

  it('defaults the target label per language and flags truncated diffs', () => {
    const zh = ReviewPrompt.buildReviewPrompt({ files: [], lang: 'zh', truncated: true });
    assert.ok(zh.includes('代码审查请求 (未提交更改)'));
    assert.ok(zh.includes('已被截断'));
    const en = ReviewPrompt.buildReviewPrompt({ files: [], lang: 'en' });
    assert.ok(en.includes('Code Review Request (Uncommitted changes)'));
    assert.ok(!en.includes('truncated'));
  });

  it('switches to large diff advisory when diff is huge', () => {
    const hugeDiff = 'x'.repeat(50000);
    const prompt = ReviewPrompt.buildReviewPrompt({
      targetMode: 'branch',
      targetLabel: 'main 分支对比',
      files: [{ path: 'src/big.js', linesAdded: 2000, linesRemoved: 100, status: 'modified' }],
      rawDiff: hugeDiff,
      lang: 'zh',
    });

    assert.ok(prompt.includes('代码差异提示'));
    assert.ok(prompt.includes('代码差异较大'));
    assert.ok(!prompt.includes('```diff\n' + hugeDiff));
  });
});
