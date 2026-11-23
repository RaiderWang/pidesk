import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Marked } = require('../src/marked.min.js');
const MarkedCjk = require('../src/app/marked-cjk.js');

const stock = new Marked();
const cjk = MarkedCjk.install(new Marked());
const render = (s) => cjk.parse(s).trim();
const stockRender = (s) => stock.parse(s).trim();

describe('bold next to CJK punctuation', () => {
  it('renders the reported sentence', () => {
    assert.equal(
      render('这是一个**"用 pythia-70m 在金融 QA 数据上做完整微调实验"的教程/实验记录**，其他'),
      '<p>这是一个<strong>&quot;用 pythia-70m 在金融 QA 数据上做完整微调实验&quot;的教程/实验记录</strong>，其他</p>',
    );
  });
  it('closes on a fullwidth bracket instead of mis-nesting', () => {
    assert.equal(
      render('这是**教程（一）**和**二**。'),
      '<p>这是<strong>教程（一）</strong>和<strong>二</strong>。</p>',
    );
    assert.equal(
      render('前缀**A（B）**后缀，再来**C**结束'),
      '<p>前缀<strong>A（B）</strong>后缀，再来<strong>C</strong>结束</p>',
    );
  });
  it('handles curly quotes and fullwidth punctuation inside', () => {
    assert.equal(render('这是**“教程”**其他'), '<p>这是<strong>“教程”</strong>其他</p>');
    assert.equal(render('这是**（教程）**其他'), '<p>这是<strong>（教程）</strong>其他</p>');
  });
  it('handles a non-CJK outer side with fullwidth punctuation inside', () => {
    assert.equal(render('GPT4**（最新）**版本'), '<p>GPT4<strong>（最新）</strong>版本</p>');
    assert.equal(render('GPT4**（最新）**'), '<p>GPT4<strong>（最新）</strong></p>');
    assert.equal(render('foo**（中文）**bar'), '<p>foo<strong>（中文）</strong>bar</p>');
  });
});

describe('CJK before the run, ASCII everywhere after', () => {
  const cases = [
    ['中文**"foo"**', '<p>中文<strong>&quot;foo&quot;</strong></p>'],
    ['查看**"README.md"**!', '<p>查看<strong>&quot;README.md&quot;</strong>!</p>'],
    ['使用**"strict"** mode', '<p>使用<strong>&quot;strict&quot;</strong> mode</p>'],
    ['支持**(optional)**', '<p>支持<strong>(optional)</strong></p>'],
    ['中文*"foo"*', '<p>中文<em>&quot;foo&quot;</em></p>'],
    ['中文**"a" `x ** y` end**', '<p>中文<strong>&quot;a&quot; <code>x ** y</code> end</strong></p>'],
  ];
  for (const [src, html] of cases) {
    it(`renders ${src}`, () => assert.equal(render(src), html));
  }
});

describe('non-BMP symbols (emoji are \\p{S})', () => {
  it('matches stock marked for ASCII-only emphasis around an emoji', () => {
    for (const s of ['a**🔥foo**b 中', 'a**foo🔥**b 中']) {
      assert.equal(render(s), stockRender(s));
      assert.equal(render(s), `<p>${s}</p>`); // stays literal
    }
  });
  it('still relaxes next to CJK', () => {
    assert.equal(render('中文**🔥重点**后'), '<p>中文<strong>🔥重点</strong>后</p>');
    assert.equal(render('中文**重点🔥**后'), '<p>中文<strong>重点🔥</strong>后</p>');
  });
});

describe('underscores around the run', () => {
  it('matches stock where "_" is adjacent', () => {
    assert.equal(render('a_**foo**_b 中'), stockRender('a_**foo**_b 中'));
    assert.equal(render('a_**"foo"**_b 中'), stockRender('a_**"foo"**_b 中'));
  });
  it('renders bold around underscore italics next to CJK', () => {
    assert.equal(render('中文**_foo_**中文'), '<p>中文<strong><em>foo</em></strong>中文</p>');
  });
});

describe('italic and mixed runs', () => {
  it('renders single-star italics', () => {
    assert.equal(
      render('这是一个*"用 x"的教程*，其他'),
      '<p>这是一个<em>&quot;用 x&quot;的教程</em>，其他</p>',
    );
    assert.equal(render('2*3*4中'), '<p>2<em>3</em>4中</p>');
  });
  it('renders bold-italic and nested runs', () => {
    assert.equal(render('中文***（粗斜）***中文'), '<p>中文<em><strong>（粗斜）</strong></em>中文</p>');
    assert.equal(
      render('中文**外层*内层***中文'),
      '<p>中文<strong>外层<em>内层</em></strong>中文</p>',
    );
  });
});

describe('opaque inner syntax (maskedSrc)', () => {
  it('keeps inline code containing ** inside the bold', () => {
    assert.equal(
      render('中文**"说明"里的 `a ** b` 表达式**继续'),
      '<p>中文<strong>&quot;说明&quot;里的 <code>a ** b</code> 表达式</strong>继续</p>',
    );
  });
  it('keeps links containing ** inside the bold', () => {
    assert.equal(
      render('中文**"文档"见 [链接](https://x.com/**a**) 说明**继续'),
      '<p>中文<strong>&quot;文档&quot;见 <a href="https://x.com/**a**">链接</a> 说明</strong>继续</p>',
    );
  });
  it('keeps escaped asterisks inside the bold', () => {
    assert.equal(
      render('中文**"星号"写作 \\*\\* 即可**继续'),
      '<p>中文<strong>&quot;星号&quot;写作 ** 即可</strong>继续</p>',
    );
  });
});

describe('cases that must stay unrendered / unchanged', () => {
  const same = [
    '中文** 不是粗体 **中文',
    '中文****',
    '第1**"a"**个',
    'a**"x"**b 中',
    '这是一个**"未闭合的流式文本',
    '**bold** and *it* and 2*3*4',
    'plain **bold** __under__ _em_',
    'a_b_c 中文',
    '中文 _斜体_ 和 __粗体__',
  ];
  for (const s of same) {
    it(`matches stock marked: ${s}`, () => {
      assert.equal(render(s), stockRender(s));
    });
  }
  it('leaves the unclosed/space cases as literal asterisks', () => {
    assert.equal(render('中文** 不是粗体 **中文'), '<p>中文** 不是粗体 **中文</p>');
    assert.equal(render('这是一个**"未闭合的流式文本'), '<p>这是一个**&quot;未闭合的流式文本</p>');
  });
  it('is identical to stock for CJK-free text', () => {
    for (const s of ['**a** *b* ***c***', 'x**"y"**z', '(**a**)', '*a **b** c*', '**a*b***']) {
      assert.equal(render(s), stockRender(s));
    }
  });
});

describe('streaming and tokens', () => {
  it('does not throw or hang on long unclosed input', () => {
    const long = '这是一个**"' + '未闭合的中文*'.repeat(3000);
    const t = Date.now();
    assert.doesNotThrow(() => cjk.parse(long));
    assert.ok(Date.now() - t < 2000);
  });
  it('works through lexer + parser (plan-annotations path)', () => {
    const tokens = cjk.lexer('这是**教程（一）**和**二**。');
    assert.equal(cjk.parser(tokens).trim(), '<p>这是<strong>教程（一）</strong>和<strong>二</strong>。</p>');
  });
  it('install is idempotent and ignores non-marked input', () => {
    const m = new Marked();
    assert.equal(MarkedCjk.install(m), m);
    MarkedCjk.install(m);
    assert.equal(m.parse('这是**教程（一）**和**二**。').trim(), '<p>这是<strong>教程（一）</strong>和<strong>二</strong>。</p>');
    assert.equal(MarkedCjk.install(null), null);
  });
});

describe('flank', () => {
  it('follows CommonMark outside CJK', () => {
    assert.deepEqual(MarkedCjk.flank('a', '"'), { open: false, close: true });
    assert.deepEqual(MarkedCjk.flank('"', 'a'), { open: true, close: false });
    assert.deepEqual(MarkedCjk.flank(' ', 'a'), { open: true, close: false });
    assert.deepEqual(MarkedCjk.flank('a', ' '), { open: false, close: true });
  });
  it('relaxes next to CJK', () => {
    assert.equal(MarkedCjk.flank('个', '"').open, true);
    assert.equal(MarkedCjk.flank('4', '（').open, true);
    assert.equal(MarkedCjk.flank('"', '其').close, true);
    assert.equal(MarkedCjk.flank('）', 'b').close, true);
    assert.equal(MarkedCjk.flank('a', '"').open, false);
  });
});
