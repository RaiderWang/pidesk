/**
 * test/tool-target.test.mjs
 *
 * app/tool-target.js: display target of a running tool. Only `path` is cut to
 * its basename; commands / patterns / queries keep their text.
 *
 * Run: node --test test/tool-target.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolTarget } from './helpers/shim.mjs';

const { raw, of, MAX_LEN } = ToolTarget;

describe('ToolTarget.of — path', () => {
  it('takes the basename of Windows and POSIX paths', () => {
    assert.equal(of('read', { path: 'C:\\proj\\src\\main.rs' }), 'main.rs');
    assert.equal(of('read', { path: 'src/a/b.js' }), 'b.js');
  });

  it('strips trailing separators before taking the last segment', () => {
    assert.equal(of('ls', { path: 'src/' }), 'src');
    assert.equal(of('ls', { path: 'C:\\a\\b\\' }), 'b');
    assert.equal(of('ls', { path: 'a//' }), 'a');
  });

  it('falls back to the original text for root paths', () => {
    assert.equal(of('ls', { path: '/' }), '/');
    assert.equal(of('ls', { path: '\\' }), '\\');
  });
});

describe('ToolTarget.of — non-path args keep their text', () => {
  it('keeps an iconv pipeline ending in 2>/dev/null', () => {
    const cmd = 'cat data.txt | iconv -f gbk -t utf-8 2>/dev/null';
    assert.equal(of('bash', { command: cmd }), cmd);
  });

  it('keeps a curl command with a quoted URL', () => {
    const cmd = 'a || curl -s "http://qt.gtimg.cn/q=sh563020"';
    assert.equal(of('bash', { command: cmd }), cmd);
  });

  it('keeps pattern and query containing slashes', () => {
    assert.equal(of('find', { pattern: 'src/**/*.js' }), 'src/**/*.js');
    assert.equal(of('web_search', { query: 'a/b c' }), 'a/b c');
  });
});

describe('ToolTarget — selection', () => {
  it('prefers path > pattern > command > query', () => {
    assert.equal(of('x', { query: 'q', command: 'c', pattern: 'p', path: 'a/b' }), 'b');
    assert.equal(of('x', { query: 'q', command: 'c', pattern: 'p' }), 'p');
    assert.equal(of('x', { query: 'q', command: 'c' }), 'c');
  });

  it('empty or blank values do not shadow later args', () => {
    assert.equal(of('x', { path: '', pattern: 'foo' }), 'foo');
    assert.equal(of('x', { path: '   ', command: 'ls' }), 'ls');
    assert.equal(of('x', { path: null, command: 'ls' }), 'ls');
  });

  it('formats hub op with ids; ids must be an array', () => {
    assert.equal(of('hub', { op: 'wait', ids: ['a', 'b'] }), 'wait a, b');
    assert.equal(of('hub', { op: 'list' }), 'list');
    assert.equal(of('hub', { op: 'list', ids: 'oops' }), 'list');
    assert.equal(of('bash', { op: 'list' }), '');
  });

  it('a blank hub op yields "" from both raw and of', () => {
    assert.equal(raw('hub', { op: '   ', ids: ['a'] }), '');
    assert.equal(of('hub', { op: '   ', ids: ['a'] }), '');
    assert.equal(raw('hub', { op: ' wait ' }), 'wait');
  });

  it('tolerates bad args', () => {
    for (const a of [null, undefined, 'str', 42, [], [1, 2]]) {
      assert.equal(of('bash', a), '');
      assert.equal(raw('bash', a), '');
    }
    assert.equal(of('bash', { command: 123 }), '123');
  });
});

describe('ToolTarget — folding and cap', () => {
  it('folds whitespace and trims multi-line commands', () => {
    assert.equal(of('bash', { command: '\n  echo a\n\techo   b \n' }), 'echo a echo b');
  });

  it('keeps exactly MAX_LEN chars, truncates beyond with an ellipsis', () => {
    assert.equal(MAX_LEN, 200);
    const ok = 'x'.repeat(200);
    assert.equal(of('bash', { command: ok }), ok);
    const cut = of('bash', { command: 'x'.repeat(201) });
    assert.equal(cut.length, 200);
    assert.ok(cut.endsWith('…'));
  });

  it('caps a hub label with many ids', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `task-${i}`);
    assert.equal(of('hub', { op: 'wait', ids }).length, 200);
  });
});

describe('ToolTarget.raw', () => {
  it('returns the unfolded, untruncated original', () => {
    const p = 'C:\\proj\\src\\main.rs';
    assert.equal(raw('read', { path: p }), p);
    const cmd = 'echo  a\n' + 'y'.repeat(300);
    assert.equal(raw('bash', { command: cmd }), cmd);
  });
});
