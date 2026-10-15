/**
 * test/fuzzy.test.mjs
 *
 * Unit tests for src/app/fuzzy.js — subsequence matcher used by the palette.
 *
 * Run: node --test test/fuzzy.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Fuzzy } from './helpers/shim.mjs';

const { fuzzyMatch, fuzzyRank, highlightSegments } = Fuzzy;

describe('fuzzyMatch', () => {
  it('returns null when the query is not a subsequence', () => {
    assert.equal(fuzzyMatch('xyz', 'compact'), null);
    assert.equal(fuzzyMatch('tpc', 'compact'), null); // order matters
  });

  it('returns null when the query is longer than the text', () => {
    assert.equal(fuzzyMatch('compaction', 'compact'), null);
  });

  it('empty query matches with score 0 and no ranges', () => {
    assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, ranges: [] });
    assert.deepEqual(fuzzyMatch('   ', 'anything'), { score: 0, ranges: [] });
  });

  it('is case-insensitive', () => {
    assert.ok(fuzzyMatch('COMP', 'compact'));
    assert.ok(fuzzyMatch('comp', 'COMPACT'));
  });

  it('ignores whitespace inside the query', () => {
    assert.ok(fuzzyMatch('co mp', 'compact'));
  });

  it('reports contiguous ranges for a prefix match', () => {
    const m = fuzzyMatch('com', 'compact');
    assert.deepEqual(m.ranges, [[0, 3]]);
  });

  it('reports split ranges for scattered matches', () => {
    const m = fuzzyMatch('cpt', 'compact');
    assert.deepEqual(m.ranges.flat().length >= 4, true);
    const hit = m.ranges.map(([a, b]) => 'compact'.slice(a, b)).join('');
    assert.equal(hit, 'cpt');
  });

  it('a word-start match outranks a mid-word match', () => {
    const start = fuzzyMatch('mod', 'manage models');
    const mid = fuzzyMatch('mod', 'accommodate');
    assert.ok(start.score > mid.score, `${start.score} <= ${mid.score}`);
  });

  it('a consecutive run outranks scattered letters', () => {
    const run = fuzzyMatch('mod', 'models');
    const scattered = fuzzyMatch('mod', 'mxxoxxd');
    assert.ok(run.score > scattered.score);
  });

  it('camelCase boundaries count as word starts', () => {
    const camel = fuzzyMatch('tp', 'togglePlan');
    const flat = fuzzyMatch('tp', 'tmpupdate');
    assert.ok(camel.score > flat.score);
  });
});

describe('fuzzyRank', () => {
  const items = ['history', 'models', 'manage models', 'new session', 'review'];

  it('keeps the original order for an empty query', () => {
    const out = fuzzyRank(items, '');
    assert.deepEqual(out.map((r) => r.item), items);
  });

  it('filters out non-matching items', () => {
    const out = fuzzyRank(items, 'rev');
    assert.deepEqual(out.map((r) => r.item), ['review']);
  });

  it('sorts better matches first', () => {
    const out = fuzzyRank(items, 'mod');
    assert.equal(out[0].item, 'models');
    assert.equal(out[1].item, 'manage models');
  });

  it('keeps original order for equal scores (stable)', () => {
    const out = fuzzyRank(['aa', 'aa', 'aa'], 'a');
    assert.deepEqual(out.map((r) => r.item), ['aa', 'aa', 'aa']);
  });

  it('uses getText to read objects', () => {
    const objs = [{ n: 'alpha' }, { n: 'beta' }];
    const out = fuzzyRank(objs, 'bet', (o) => o.n);
    assert.equal(out.length, 1);
    assert.equal(out[0].item.n, 'beta');
  });
});

describe('highlightSegments', () => {
  it('splits text into hit and non-hit segments', () => {
    const segs = highlightSegments('compact', [[0, 2], [4, 5]]);
    assert.deepEqual(segs, [
      { text: 'co', hit: true },
      { text: 'mp', hit: false },
      { text: 'a', hit: true },
      { text: 'ct', hit: false },
    ]);
  });

  it('returns one plain segment when there are no ranges', () => {
    assert.deepEqual(highlightSegments('abc', []), [{ text: 'abc', hit: false }]);
  });

  it('reassembles to the original text', () => {
    const text = 'manage models';
    const m = fuzzyMatch('mmod', text);
    assert.equal(highlightSegments(text, m.ranges).map((s) => s.text).join(''), text);
  });
});
