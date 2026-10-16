import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FM = require('../src/app/file-mention.js');

describe('formatMention', () => {
  it('prefixes plain paths and normalises separators', () => {
    assert.equal(FM.formatMention('src/app.js'), '@src/app.js');
    assert.equal(FM.formatMention('src\\app.js'), '@src/app.js');
  });
  it('quotes paths containing whitespace', () => {
    assert.equal(FM.formatMention('my docs/a b.md'), '@"my docs/a b.md"');
    assert.equal(FM.formatMention('it\'s a "x".md'), '@it\'s a "x".md');
  });
  it('returns empty for empty input', () => {
    assert.equal(FM.formatMention(''), '');
  });
});

describe('buildMessage', () => {
  it('puts chips before the body', () => {
    assert.equal(FM.buildMessage(['a.js', 'b/c.ts'], 'fix these'), '@a.js @b/c.ts fix these');
  });
  it('works with chips only or text only', () => {
    assert.equal(FM.buildMessage(['a.js'], '  '), '@a.js');
    assert.equal(FM.buildMessage([], ' hi '), 'hi');
  });
  it('keeps slash commands at the start of the prompt', () => {
    assert.equal(FM.buildMessage(['a.js'], '/compact now'), '/compact now @a.js');
  });
});

describe('splitMentions', () => {
  const kinds = (t) => FM.splitMentions(t).map((s) => [s.type, s.value, s.path]);

  it('splits mentions from prose', () => {
    assert.deepEqual(kinds('look at @src/a.js please'), [
      ['text', 'look at ', undefined],
      ['mention', '@src/a.js', 'src/a.js'],
      ['text', ' please', undefined],
    ]);
  });
  it('leaves trailing punctuation as prose', () => {
    assert.deepEqual(kinds('see @a/b.ts.'), [
      ['text', 'see ', undefined],
      ['mention', '@a/b.ts', 'a/b.ts'],
      ['text', '.', undefined],
    ]);
  });
  it('supports quoted paths with spaces', () => {
    const segs = FM.splitMentions('read @"my docs/a b.md" now');
    assert.equal(segs[1].type, 'mention');
    assert.equal(segs[1].path, 'my docs/a b.md');
    assert.equal(segs[1].value, '@"my docs/a b.md"');
  });
  it('does not treat emails or bare handles as mentions', () => {
    assert.deepEqual(FM.splitMentions('mail foo@bar.com or ping @alice'), [
      { type: 'text', value: 'mail foo@bar.com or ping @alice' },
    ]);
  });
  it('recognises mentions after opening brackets and at line start', () => {
    const segs = FM.splitMentions('@a.js\n(see @b/c.md)');
    const mentions = segs.filter((s) => s.type === 'mention').map((s) => s.path);
    assert.deepEqual(mentions, ['a.js', 'b/c.md']);
    assert.equal(segs.map((s) => s.value).join(''), '@a.js\n(see @b/c.md)');
  });
  it('round-trips arbitrary text', () => {
    const t = 'x @a.js, y @"q r.md" z @bob @c/d';
    assert.equal(FM.splitMentions(t).map((s) => s.value).join(''), t);
  });
});

describe('findAtQuery', () => {
  it('finds the query before the caret', () => {
    assert.deepEqual(FM.findAtQuery('open @src/ap', 12), { start: 5, end: 12, query: 'src/ap' });
  });
  it('matches a bare @', () => {
    assert.deepEqual(FM.findAtQuery('@', 1), { start: 0, end: 1, query: '' });
  });
  it('extends end past the caret to the token end', () => {
    assert.deepEqual(FM.findAtQuery('open @src/app.js next', 9), { start: 5, end: 16, query: 'src' });
  });
  it('returns null once whitespace separates the caret from @', () => {
    assert.equal(FM.findAtQuery('open @src and more', 18), null);
  });
  it('ignores @ inside words such as emails', () => {
    assert.equal(FM.findAtQuery('foo@bar', 7), null);
  });
  it('returns null without an @', () => {
    assert.equal(FM.findAtQuery('hello', 5), null);
  });
});

describe('replaceRange', () => {
  it('splices a replacement in', () => {
    assert.equal(FM.replaceRange('a @x b', 2, 4, 'Z'), 'a Z b');
  });
  it('collapses doubled spaces on removal', () => {
    assert.equal(FM.replaceRange('a @x b', 2, 4, ''), 'a b');
  });
  it('removes cleanly at the end', () => {
    assert.equal(FM.replaceRange('go @x', 3, 5, ''), 'go ');
  });
});
