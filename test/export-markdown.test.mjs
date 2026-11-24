/**
 * test/export-markdown.test.mjs
 *
 * ExportMarkdown (app/export-markdown.js): session entries → Markdown.
 * Run: npm run test:js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { UndoMessage, t, setLocale } from './helpers/shim.mjs';

const require = createRequire(import.meta.url);
const { buildBranch, toMarkdown, closeDanglingFence } = require('../src/app/export-markdown.js');

let seq = 0;
function entry(role, content, parentId, extra = {}) {
  const { type = 'message', ...msgExtra } = extra;
  return { type, id: `e${++seq}`, parentId, message: { role, content, ...msgExtra } };
}
const text = (s) => ({ type: 'text', text: s });
const LABELS = { user: 'U', assistant: 'A', image: '[img]' };

/** Chain entries so each one's parent is the previous. */
function chain(...specs) {
  const out = [];
  let parent = null;
  for (const [role, content, extra] of specs) {
    const e = entry(role, content, parent, extra);
    out.push(e);
    parent = e.id;
  }
  return out;
}
const leafOf = (list) => list[list.length - 1].id;

describe('buildBranch', () => {
  it('follows parentId from the leaf, root first', () => {
    const list = chain(['user', 'a'], ['assistant', 'b'], ['user', 'c']);
    assert.deepEqual(buildBranch(list, leafOf(list)).map((e) => e.id), list.map((e) => e.id));
  });

  it('drops entries on abandoned branches', () => {
    const [u, a] = chain(['user', 'q'], ['assistant', 'old answer']);
    const fork = entry('assistant', 'new answer', u.id);
    const ids = buildBranch([u, a, fork], fork.id).map((e) => e.id);
    assert.deepEqual(ids, [u.id, fork.id]);
  });

  it('falls back to the last entry for null or unknown leafId', () => {
    const list = chain(['user', 'a'], ['assistant', 'b']);
    assert.equal(buildBranch(list, null).length, 2);
    assert.equal(buildBranch(list, 'nope').length, 2);
  });

  it('terminates on a parentId cycle', () => {
    const a = { type: 'message', id: 'a', parentId: 'b', message: { role: 'user', content: 'x' } };
    const b = { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: 'y' } };
    assert.equal(buildBranch([a, b], 'b').length, 2);
  });

  it('returns [] for empty or non-array input', () => {
    assert.deepEqual(buildBranch([], null), []);
    assert.deepEqual(buildBranch(null, null), []);
  });
});

describe('toMarkdown content selection', () => {
  it('renders user and assistant text with # headings and no rules', () => {
    const list = chain(['user', [text('hi')]], ['assistant', [text('hello')]]);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\nhi\n\n# A\n\nhello\n');
  });

  it('accepts string content', () => {
    const list = chain(['user', 'plain'], ['assistant', 'reply']);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\nplain\n\n# A\n\nreply\n');
  });

  it('skips developer, fileMention, toolResult and non-message entries', () => {
    const list = chain(
      ['developer', [text('system')]],
      ['user', [text('q')]],
      ['fileMention', [text('file body')]],
      ['assistant', [text('a')]],
      ['toolResult', [text('tool out')]],
    );
    list.push({ type: 'compaction', id: 'c1', parentId: leafOf(list), summary: 'sum' });
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.equal(md, '# U\n\nq\n\n# A\n\na\n');
  });

  it('drops thinking and toolCall blocks', () => {
    const list = chain(
      ['user', [text('q')]],
      ['assistant', [{ type: 'thinking', thinking: 'secret' }, text('answer'), { type: 'toolCall', name: 'bash' }]],
    );
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\nq\n\n# A\n\nanswer\n');
  });

  it('joins text blocks around a tool call with a blank line', () => {
    const list = chain(
      ['user', 'q'],
      ['assistant', [text('before'), { type: 'toolCall', name: 'x' }, text('after')]],
    );
    assert.match(toMarkdown(list, leafOf(list), LABELS), /before\n\nafter/);
  });

  it('ignores blank text blocks', () => {
    const list = chain(['user', 'q'], ['assistant', [text('  '), text('real'), text('')]]);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\nq\n\n# A\n\nreal\n');
  });

  it('skips assistant turns that only carry tool calls', () => {
    const list = chain(['user', 'q'], ['assistant', [{ type: 'toolCall', name: 'x' }]]);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\nq\n');
  });

  it('returns "" when nothing is exportable', () => {
    assert.equal(toMarkdown([], null, LABELS), '');
    const list = chain(['assistant', [{ type: 'toolCall', name: 'x' }]], ['toolResult', 'out']);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '');
  });
});

describe('toMarkdown user images', () => {
  it('emits a placeholder for an image-only user turn', () => {
    const list = chain(['user', [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]], ['assistant', 'seen']);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\n[img]\n\n# A\n\nseen\n');
  });

  it('appends one placeholder per image after the text', () => {
    const img = { type: 'image', data: 'A', mimeType: 'image/png' };
    const list = chain(['user', [text('look'), img, img]]);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\nlook\n\n[img]\n\n[img]\n');
  });
});

describe('toMarkdown assistant merging', () => {
  it('merges assistant turns separated only by tool rows', () => {
    const list = chain(
      ['user', 'q'],
      ['assistant', [text('step 1'), { type: 'toolCall', name: 'a' }]],
      ['toolResult', 'r1'],
      ['assistant', [text('step 2'), { type: 'toolCall', name: 'b' }]],
      ['toolResult', 'r2'],
      ['assistant', [text('final')]],
    );
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.equal(md, '# U\n\nq\n\n# A\n\nstep 1\n\nstep 2\n\nfinal\n');
    assert.equal(md.match(/# A/g).length, 1);
  });

  it('starts a new assistant section after the next user turn', () => {
    const list = chain(['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']);
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.equal(md.match(/# A/g).length, 2);
  });
});

describe('toMarkdown stopReason', () => {
  it('keeps partial text of an aborted turn', () => {
    const list = chain(['user', 'q'], ['assistant', [text('half an ans')], { stopReason: 'aborted' }]);
    assert.match(toMarkdown(list, leafOf(list), LABELS), /half an ans/);
  });

  it('skips an errored turn without text', () => {
    const list = chain(['user', 'q'], ['assistant', [], { stopReason: 'error', errorMessage: 'boom' }]);
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.equal(md, '# U\n\nq\n');
    assert.ok(!md.includes('boom'));
  });
});

describe('toMarkdown plan framing', () => {
  it('strips the PiDesk plan framing in every locale', () => {
    for (const loc of ['en', 'zh-CN']) {
      setLocale(loc);
      const framed = t('plan.intentFraming', { intent: 'build a thing' });
      assert.notEqual(framed, 'build a thing', `framing template missing for ${loc}`);
      const list = chain(['user', [text(framed)]], ['assistant', 'ok']);
      const md = toMarkdown(list, leafOf(list), LABELS);
      assert.equal(md, '# U\n\nbuild a thing\n\n# A\n\nok\n', loc);
    }
    setLocale('en');
    assert.ok(UndoMessage);
  });

  it('accepts an injected stripper and leaves text alone when it returns nothing useful', () => {
    const list = chain(['user', 'raw']);
    assert.match(toMarkdown(list, leafOf(list), LABELS, { stripPlanFraming: (s) => ({ text: s.toUpperCase() }) }), /RAW/);
  });
});

describe('toMarkdown content fidelity', () => {
  it('keeps CJK text, headings and rules from the model verbatim', () => {
    const body = '## 小结\n\n**重点**：完成。\n\n---\n\n- 一\n- 二';
    const list = chain(['user', '你好'], ['assistant', body]);
    const md = toMarkdown(list, leafOf(list), { user: '用户', assistant: '助手' });
    assert.equal(md, `# 用户\n\n你好\n\n# 助手\n\n${body}\n`);
  });

  it('uses English default labels when none are given', () => {
    const list = chain(['user', 'q']);
    assert.match(toMarkdown(list, leafOf(list)), /^# User\n/);
  });

  it('exports only the active branch', () => {
    const [u, old] = chain(['user', 'q'], ['assistant', 'discarded']);
    const fresh = entry('assistant', 'kept', u.id);
    const md = toMarkdown([u, old, fresh], fresh.id, LABELS);
    assert.ok(md.includes('kept'));
    assert.ok(!md.includes('discarded'));
  });
});

describe('closeDanglingFence', () => {
  it('closes an unterminated backtick fence', () => {
    assert.equal(closeDanglingFence('```js\nlet a;'), '```js\nlet a;\n```');
  });

  it('leaves balanced fences alone', () => {
    const s = '```\ncode\n```\n\ntext';
    assert.equal(closeDanglingFence(s), s);
  });

  it('respects fence length and character', () => {
    assert.equal(closeDanglingFence('````md\n```\ninner\n```'), '````md\n```\ninner\n```\n````');
    assert.equal(closeDanglingFence('~~~\nx'), '~~~\nx\n~~~');
  });

  it('stops an unclosed fence swallowing the next role heading', () => {
    const list = chain(['user', 'q'], ['assistant', '```\nunterminated'], ['user', 'next']);
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.ok(md.includes('```\nunterminated\n```\n\n# U\n\nnext'));
  });

  it('closes each merged assistant part separately', () => {
    const list = chain(['user', 'q'], ['assistant', '```\nopen'], ['assistant', 'after']);
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.ok(md.includes('```\nopen\n```\n\nafter'));
  });
});

describe('closeDanglingFence — inline triple backticks', () => {
  it('does not treat a line starting with inline ```code``` as an opening fence', () => {
    for (const s of ['```code``` is inline code', 'before\n```js``` after\nmore', '  ```a`b\nx']) {
      assert.equal(closeDanglingFence(s), s, JSON.stringify(s));
    }
  });

  it('still opens a tilde fence whose info string contains a backtick', () => {
    assert.equal(closeDanglingFence('~~~ a`b\nx'), '~~~ a`b\nx\n~~~');
  });

  it('does not append anything to a message that only uses inline triple backticks', () => {
    const list = chain(['user', 'q'], ['assistant', '```code``` shows a block\n\nnext paragraph']);
    assert.equal(
      toMarkdown(list, leafOf(list), LABELS),
      '# U\n\nq\n\n# A\n\n```code``` shows a block\n\nnext paragraph\n',
    );
  });
});

describe('toMarkdown whitespace', () => {
  it('keeps the first line indentation (indented code / list)', () => {
    const list = chain(['user', '    indented()\nplain']);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\n    indented()\nplain\n');
  });

  it('drops leading blank lines and trailing whitespace only', () => {
    const list = chain(['user', '\n \n\t- item\n\n  '], ['assistant', '\n\nanswer  \n\n']);
    assert.equal(toMarkdown(list, leafOf(list), LABELS), '# U\n\n\t- item\n\n# A\n\nanswer\n');
  });

  it('normalises CRLF and lone CR to LF', () => {
    const list = chain(['user', 'a\r\nb\rc'], ['assistant', [text('x\r\ny')]]);
    const md = toMarkdown(list, leafOf(list), LABELS);
    assert.ok(!md.includes('\r'));
    assert.equal(md, '# U\n\na\nb\nc\n\n# A\n\nx\ny\n');
  });
});
