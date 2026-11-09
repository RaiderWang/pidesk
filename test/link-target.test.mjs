import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classify } = require('../src/app/link-target.js');

const path = (p) => ({ kind: 'path', path: p });
const ignore = { kind: 'ignore' };

describe('classify: external / ignored', () => {
  it('treats http, https and mailto as external', () => {
    assert.deepEqual(classify('https://x.com/a?b=1#c'), { kind: 'external', url: 'https://x.com/a?b=1#c' });
    assert.deepEqual(classify('HTTP://x.com'), { kind: 'external', url: 'HTTP://x.com' });
    assert.deepEqual(classify('mailto:a@b.c'), { kind: 'external', url: 'mailto:a@b.c' });
  });
  it('ignores dangerous or unknown schemes and bare anchors', () => {
    assert.deepEqual(classify('javascript:alert(1)'), ignore);
    assert.deepEqual(classify('data:text/html,x'), ignore);
    assert.deepEqual(classify('tauri://localhost/x'), ignore);
    assert.deepEqual(classify('#section'), ignore);
    assert.deepEqual(classify('//evil.com/x'), ignore);
    assert.deepEqual(classify(''), ignore);
    assert.deepEqual(classify(null), ignore);
  });
});

describe('classify: relative paths', () => {
  it('joins relative paths onto cwd', () => {
    assert.deepEqual(classify('src/live.js', 'C:\\proj'), path('C:/proj/src/live.js'));
    assert.deepEqual(classify('./a.md', '/home/u/proj/'), path('/home/u/proj/a.md'));
    assert.deepEqual(classify('../a.md', '/home/u/proj'), path('/home/u/a.md'));
  });
  it('decodes percent-encoded CJK names produced by marked', () => {
    const href = encodeURI('路由配置说明.md');
    assert.deepEqual(classify(href, '/p'), path('/p/路由配置说明.md'));
  });
  it('survives a literal percent sign', () => {
    assert.deepEqual(classify('100%覆盖率.md', '/p'), path('/p/100%覆盖率.md'));
    assert.deepEqual(classify('a%20b%.md', '/p'), path('/p/a b%.md'));
  });
  it('ignores relative paths when cwd is unknown', () => {
    assert.deepEqual(classify('a.md', ''), ignore);
    assert.deepEqual(classify('a.md'), ignore);
  });
});

describe('classify: absolute paths and file URLs', () => {
  it('normalises Windows absolute paths without touching the drive colon', () => {
    assert.deepEqual(classify('C:\\a\\b.md', '/ignored'), path('C:/a/b.md'));
    assert.deepEqual(classify('d:/x/y.txt'), path('d:/x/y.txt'));
  });
  it('keeps POSIX absolute paths', () => {
    assert.deepEqual(classify('/usr/local/a.md'), path('/usr/local/a.md'));
  });
  it('converts file:// URLs on Windows and POSIX', () => {
    assert.deepEqual(classify('file:///f:/Project/a.jsx#L5-L24'), path('f:/Project/a.jsx'));
    assert.deepEqual(classify('file:///C:/My%20Docs/a.md'), path('C:/My Docs/a.md'));
    assert.deepEqual(classify('file:///Users/a/b.md'), path('/Users/a/b.md'));
    assert.deepEqual(classify('file://localhost/Users/a/b.md'), path('/Users/a/b.md'));
    assert.deepEqual(classify('file://server/share/a.md'), path('//server/share/a.md'));
  });
});

describe('classify: suffix stripping', () => {
  it('drops query, fragment and line:col suffixes', () => {
    assert.deepEqual(classify('a.md#L12', '/p'), path('/p/a.md'));
    assert.deepEqual(classify('a.md?x=1', '/p'), path('/p/a.md'));
    assert.deepEqual(classify('a.md:12:3', '/p'), path('/p/a.md'));
    assert.deepEqual(classify('a.md:12', '/p'), path('/p/a.md'));
    assert.deepEqual(classify('C:\\a\\b.md:7', '/p'), path('C:/a/b.md'));
  });
  it('does not strip a drive-only path', () => {
    assert.deepEqual(classify('C:/', '/p'), path('C:/'));
  });
});
