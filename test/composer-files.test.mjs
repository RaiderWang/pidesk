import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CF = require('../src/app/composer-files.js');

describe('ComposerFiles', () => {
  it('add() reports false when no composer is subscribed', () => {
    assert.equal(CF.add('a.js'), false);
  });

  it('delivers normalised paths to subscribers and stops after unsubscribe', () => {
    const got = [];
    const off = CF.subscribe((p) => got.push(p));
    assert.equal(CF.add('src\\a.js'), true);
    assert.deepEqual(got, ['src/a.js']);
    off();
    assert.equal(CF.add('b.js'), false);
    assert.deepEqual(got, ['src/a.js']);
  });

  it('ignores empty paths', () => {
    const got = [];
    const off = CF.subscribe((p) => got.push(p));
    assert.equal(CF.add('  '), false);
    off();
    assert.deepEqual(got, []);
  });

  it('addUnique appends once and keeps identity when unchanged', () => {
    const base = ['a.js'];
    assert.deepEqual(CF.addUnique(base, 'b.js'), ['a.js', 'b.js']);
    assert.equal(CF.addUnique(base, 'a.js'), base);
    assert.equal(CF.addUnique(base, 'a.js'), base);
    assert.deepEqual(CF.addUnique(['x/y.js'], 'x\\y.js'), ['x/y.js']);
  });
});
