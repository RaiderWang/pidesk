import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Marked } = require('../src/marked.min.js');
const Seg = require('../src/app/markdown-segments.js');

const marked = new Marked();

const SAMPLE = [
  'flowchart LR',
  '  subgraph Phone["手机端 (React Native, bare)"]',
  '    A[TXT/EPUB 导入] --> B[分句归一化]',
  '    D[TTS 调度器<br/>云端主 + 端侧回落]',
  '  end',
  '  E -->|签名 URL| K[(Cloudflare R2)]',
  '  J <-->|WebSocket 时钟同步| L[Cast Web Receiver]',
].join('\n');

describe('hasMermaidFence', () => {
  it('detects ``` and ~~~ mermaid fences', () => {
    assert.equal(Seg.hasMermaidFence('hi\n```mermaid\nA-->B\n```'), true);
    assert.equal(Seg.hasMermaidFence('~~~mermaid\nA-->B\n~~~'), true);
    assert.equal(Seg.hasMermaidFence('````mermaid\nA-->B\n````'), true);
    assert.equal(Seg.hasMermaidFence('  ```Mermaid title\nA'), true);
  });
  it('ignores other languages and inline mentions', () => {
    assert.equal(Seg.hasMermaidFence('```js\nconst a = 1\n```'), false);
    assert.equal(Seg.hasMermaidFence('use `mermaid` for charts'), false);
    assert.equal(Seg.hasMermaidFence('```mermaidish\nx\n```'), false);
    assert.equal(Seg.hasMermaidFence(''), false);
    assert.equal(Seg.hasMermaidFence(null), false);
  });
});

describe('isClosedFence', () => {
  it('requires a matching closing fence', () => {
    assert.equal(Seg.isClosedFence('```mermaid\nA-->B\n```'), true);
    assert.equal(Seg.isClosedFence('```mermaid\nA-->B\n```\n'), true);
    assert.equal(Seg.isClosedFence('```mermaid\nA-->B'), false);
    assert.equal(Seg.isClosedFence('```mermaid'), false);
    assert.equal(Seg.isClosedFence('```mermaid\n'), false);
  });
  it('handles ~~~, longer fences and CRLF', () => {
    assert.equal(Seg.isClosedFence('~~~mermaid\nA\n~~~'), true);
    assert.equal(Seg.isClosedFence('~~~mermaid\nA\n```'), false);
    assert.equal(Seg.isClosedFence('````mermaid\nA\n```'), false);
    assert.equal(Seg.isClosedFence('```mermaid\nA\n````'), true);
    assert.equal(Seg.isClosedFence('```mermaid\r\nA\r\n```\r\n'), true);
  });
});

describe('split', () => {
  it('returns [] for empty text', () => {
    assert.deepEqual(Seg.split('', marked), []);
  });

  it('keeps text without mermaid as one md segment', () => {
    const segs = Seg.split('# Title\n\nbody\n\n```js\nx\n```', marked);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].type, 'md');
    assert.match(segs[0].html, /<h1>Title<\/h1>/);
  });

  it('splits md / mermaid / md in order', () => {
    const text = 'before\n\n```mermaid\n' + SAMPLE + '\n```\n\nafter';
    const segs = Seg.split(text, marked);
    assert.deepEqual(segs.map((s) => s.type), ['md', 'mermaid', 'md']);
    assert.equal(segs[1].code, SAMPLE);
    assert.equal(segs[1].closed, true);
    assert.equal(segs[1].ready, true);
    assert.match(segs[0].html, /before/);
    assert.match(segs[2].html, /after/);
  });

  it('merges consecutive non-mermaid tokens into one md segment', () => {
    const segs = Seg.split('a\n\nb\n\n- x\n- y\n\n```mermaid\nA-->B\n```', marked);
    assert.deepEqual(segs.map((s) => s.type), ['md', 'mermaid']);
    assert.match(segs[0].html, /<li>x<\/li>/);
  });

  it('marks a trailing unclosed fence as not ready while streaming', () => {
    const text = 'intro\n\n```mermaid\nflowchart LR\n  A --> B';
    const live = Seg.split(text, marked, { streaming: true });
    assert.equal(live[1].type, 'mermaid');
    assert.equal(live[1].closed, false);
    assert.equal(live[1].ready, false);
    const done = Seg.split(text, marked, { streaming: false });
    assert.equal(done[1].closed, false);
    assert.equal(done[1].ready, true);
  });

  it('treats a closed fence as ready even while streaming', () => {
    const segs = Seg.split('```mermaid\nA-->B\n```\n\nstill typing', marked, { streaming: true });
    assert.equal(segs[0].type, 'mermaid');
    assert.equal(segs[0].ready, true);
  });

  it('handles several diagrams and ~~~ fences', () => {
    const segs = Seg.split('```mermaid\nA-->B\n```\n\ntext\n\n~~~mermaid\nC-->D\n~~~', marked);
    assert.deepEqual(segs.map((s) => s.type), ['mermaid', 'md', 'mermaid']);
    assert.equal(segs[2].code, 'C-->D');
  });

  it('emits no empty md segment between adjacent diagrams', () => {
    const segs = Seg.split('```mermaid\nA-->B\n```\n\n```mermaid\nC-->D\n```', marked);
    assert.deepEqual(segs.map((s) => s.type), ['mermaid', 'mermaid']);
  });

  it('emits no empty md segment for trailing blank lines or link definitions', () => {
    const blank = Seg.split('```mermaid\nA-->B\n```\n\n\n', marked);
    assert.deepEqual(blank.map((s) => s.type), ['mermaid']);
    const def = Seg.split('```mermaid\nA-->B\n```\n\n[d]: https://example.com\n', marked);
    assert.deepEqual(def.map((s) => s.type), ['mermaid']);
    for (const s of [...blank, ...def]) {
      if (s.type === 'md') assert.notEqual(s.html.trim(), '');
    }
  });

  it('does not split mermaid fences nested in lists', () => {
    const segs = Seg.split('- item\n\n  ```mermaid\n  A-->B\n  ```', marked);
    assert.deepEqual(segs.map((s) => s.type), ['md']);
  });

  it('leaves other fences and indented code alone', () => {
    const segs = Seg.split('```js\nx\n```\n\n    mermaid\n    A-->B', marked);
    assert.deepEqual(segs.map((s) => s.type), ['md']);
  });
});
