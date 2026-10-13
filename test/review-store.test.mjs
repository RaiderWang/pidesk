import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function installLocalStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
  return data;
}

const Store = require('../src/review/review-store.js');

describe('ReviewStore', () => {
  let data;
  beforeEach(() => {
    data = installLocalStorage();
  });

  it('hashes the whole diff, not just its first 5000 characters', () => {
    const prefix = 'x'.repeat(6000);
    assert.notEqual(Store.computeDiffHash(prefix + 'A'), Store.computeDiffHash(prefix + 'B'));
    assert.equal(Store.computeDiffHash(prefix + 'A'), Store.computeDiffHash(prefix + 'A'));
    assert.equal(Store.computeDiffHash(''), 'empty');
    assert.equal(Store.computeDiffHash(null), 'empty');
  });

  it('round-trips annotations per session + diff and isolates scopes', () => {
    const notes = { 'a.js': { 'new:1': 'hi' } };
    Store.saveAnnotations('s1', 'h1', notes);
    assert.deepEqual(Store.loadAnnotations('s1', 'h1'), notes);
    assert.deepEqual(Store.loadAnnotations('s2', 'h1'), {});
    assert.deepEqual(Store.loadAnnotations('s1', 'h2'), {});
  });

  it('removes the entry (and its index record) when the last note is deleted', () => {
    Store.saveAnnotations('s1', 'h1', { 'a.js': { 'new:1': 'hi' } });
    Store.saveAnnotations('s1', 'h1', {});
    assert.deepEqual(Store.loadAnnotations('s1', 'h1'), {});
    assert.deepEqual(JSON.parse(data.get('pidesk_review_notes_index')), []);
  });

  it('evicts the least recently used entries beyond the cap', () => {
    const notes = { 'a.js': { 'new:1': 'n' } };
    for (let i = 0; i < Store.MAX_ENTRIES + 5; i++) {
      Store.saveAnnotations('s', `h${i}`, notes);
    }
    const noteKeys = [...data.keys()].filter((k) => k.startsWith('pidesk_review_notes_s_'));
    assert.equal(noteKeys.length, Store.MAX_ENTRIES);
    assert.deepEqual(Store.loadAnnotations('s', 'h0'), {});
    assert.deepEqual(Store.loadAnnotations('s', `h${Store.MAX_ENTRIES + 4}`), notes);
  });

  it('ignores corrupt or non-object stored values', () => {
    data.set('pidesk_review_notes_s_h', '{not json');
    assert.deepEqual(Store.loadAnnotations('s', 'h'), {});
    data.set('pidesk_review_notes_s_h', '[1,2]');
    assert.deepEqual(Store.loadAnnotations('s', 'h'), {});
  });
});
