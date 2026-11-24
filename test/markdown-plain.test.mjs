import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Marked } = require('../src/marked.min.js');
const MarkedCjk = require('../src/app/marked-cjk.js');
const { toPlainText, unescapeHtml } = require('../src/app/markdown-plain.js');

const stock = new Marked();
const cjk = MarkedCjk.install(new Marked());
const plain = (s) => toPlainText(s, stock);

describe('entity decoding', () => {
  it('decodes codespan, escape and image alt', () => {
    assert.equal(plain('`a && b < c`'), 'a && b < c');
    assert.equal(plain('x \\& y'), 'x & y');
    assert.equal(plain('![a&b <1>](u.png)'), 'a&b <1>');
  });

  it('decodes inline text entities', () => {
    assert.equal(plain('Tom & Jerry say "hi" it\'s <ok>'), 'Tom & Jerry say "hi" it\'s');
  });

  it('decodes &lt; / &gt; in plain text tokens', () => {
    assert.equal(plain('1 < 2 && 3 > 1'), '1 < 2 && 3 > 1');
  });

  it('keeps literal entities inside fenced code blocks', () => {
    assert.equal(plain('```\n&amp; < x\n```'), '&amp; < x');
  });

  it('does not double-decode (&amp;lt; stays &lt;)', () => {
    assert.equal(unescapeHtml('&amp;lt;'), '&lt;');
    assert.equal(plain('`&lt;`'), '&lt;');
  });

  it('keeps href literal when a link needs its url shown', () => {
    assert.equal(plain('[doc](http://a/?x=1&y=2)'), 'doc (http://a/?x=1&y=2)');
  });
});

describe('inline formatting', () => {
  it('strips strong / em / del / codespan markers', () => {
    assert.equal(plain('**b** _i_ ~~d~~ `c`'), 'b i d c');
  });

  it('strips markers around CJK punctuation with marked-cjk', () => {
    assert.equal(
      toPlainText('这是**"教程（一）"**和**二**。', cjk),
      '这是"教程（一）"和二。',
    );
  });
});

describe('links and images', () => {
  it('recurses into link text', () => {
    assert.equal(plain('[**x**](http://u)'), 'x (http://u)');
  });

  it('shows only the text when it equals the url', () => {
    assert.equal(plain('<http://u.com>'), 'http://u.com');
  });

  it('treats mailto autolink as same as its label', () => {
    assert.equal(plain('<a@b.com>'), 'a@b.com');
  });

  it('outputs the url for an empty-label link', () => {
    assert.equal(plain('[](http://u)'), 'http://u');
  });
});

describe('lists', () => {
  it('recurses into list item text (bold / link / code)', () => {
    assert.equal(
      plain('- **b** and [l](http://u) `c`'),
      '- b and l (http://u) c',
    );
  });

  it('honours the ordered list start number', () => {
    assert.equal(plain('3. a\n4. b'), '3. a\n4. b');
  });

  it('indents nested lists', () => {
    assert.equal(plain('- a\n  - b\n  - c\n- d'), '- a\n  - b\n  - c\n- d');
  });

  it('restores task list state', () => {
    assert.equal(plain('- [x] done\n- [ ] todo'), '- [x] done\n- [ ] todo');
  });

  it('keeps a code block inside an item', () => {
    assert.equal(
      plain('- a\n\n  ```\n  x < y\n  ```'),
      '- a\n  x < y',
    );
  });
});

describe('html, br, hr, tables', () => {
  it('turns <br> in a paragraph into a newline', () => {
    assert.equal(plain('a<br>b<br/>c'), 'a\nb\nc');
  });

  it('turns <br> in table cells into a space and joins cells with tabs', () => {
    assert.equal(plain('| a | b |\n|---|---|\n| x<br>y | **z** |'), 'a\tb\nx y\tz');
  });

  it('drops html comments and tags', () => {
    assert.equal(plain('a\n\n<!-- hidden -->\n\nb'), 'a\n\nb');
    assert.equal(plain('x <span>y</span> z'), 'x y z');
  });

  it('ignores hr without stacking blank lines', () => {
    assert.equal(plain('a\n\n---\n\nb'), 'a\n\nb');
  });

  it('strips heading / blockquote markers', () => {
    assert.equal(plain('# T\n\n> q1\n>\n> q2'), 'T\n\nq1\n\nq2');
  });

  it('removes fences but keeps code content and indentation', () => {
    assert.equal(plain('```js\nif (a) {\n  b();\n}\n```'), 'if (a) {\n  b();\n}');
  });
});

describe('robustness', () => {
  it('returns "" for non-strings', () => {
    assert.equal(toPlainText(null, stock), '');
    assert.equal(toPlainText(undefined, stock), '');
    assert.equal(toPlainText(42, stock), '');
  });

  it('returns the empty string for empty input', () => {
    assert.equal(plain(''), '');
  });

  it('returns the original text when no marked is available', () => {
    assert.equal(toPlainText('**x**', null), '**x**');
  });

  it('explicit null does not fall back to a global marked; omitted does', () => {
    globalThis.marked = stock;
    try {
      assert.equal(toPlainText('**x**', null), '**x**');
      assert.equal(toPlainText('**x**'), 'x');
    } finally {
      delete globalThis.marked;
    }
  });

  it('returns the original text when lexer throws', () => {
    const bad = { lexer() { throw new Error('boom'); } };
    assert.equal(toPlainText('**x**', bad), '**x**');
  });

  it('joins paragraphs with a single blank line', () => {
    assert.equal(plain('a\n\n\n\nb'), 'a\n\nb');
  });
});
