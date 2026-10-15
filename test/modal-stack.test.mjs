/**
 * test/modal-stack.test.mjs
 *
 * Unit tests for src/app/modal-stack.js — topmost-modal bookkeeping.
 *
 * Run: node --test test/modal-stack.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModalStack } from './helpers/shim.mjs';

describe('ModalStack — ordering', () => {
  it('starts empty', () => {
    const s = ModalStack.create();
    assert.equal(s.size(), 0);
    assert.equal(s.top(), null);
    assert.equal(s.isTop('a'), false);
  });

  it('the most recently pushed modal is on top', () => {
    const s = ModalStack.create();
    s.push('a');
    s.push('b');
    assert.equal(s.top(), 'b');
    assert.equal(s.isTop('b'), true);
    assert.equal(s.isTop('a'), false);
  });

  it('Escape routing: only the top entry reports isTop', () => {
    const s = ModalStack.create();
    s.push('manager');
    s.push('confirm');
    assert.deepEqual(['manager', 'confirm'].map((id) => s.isTop(id)), [false, true]);
  });

  it('removing the top restores the previous modal', () => {
    const s = ModalStack.create();
    s.push('a');
    s.push('b');
    s.remove('b');
    assert.equal(s.top(), 'a');
    assert.equal(s.size(), 1);
  });

  it('removing a non-top modal keeps the top unchanged', () => {
    const s = ModalStack.create();
    s.push('a');
    s.push('b');
    s.remove('a');
    assert.equal(s.top(), 'b');
  });

  it('pushing a duplicate id moves it to the top without duplicating', () => {
    const s = ModalStack.create();
    s.push('a');
    s.push('b');
    s.push('a');
    assert.equal(s.size(), 2);
    assert.equal(s.top(), 'a');
  });

  it('removing an unknown id is a no-op', () => {
    const s = ModalStack.create();
    s.push('a');
    s.remove('zzz');
    assert.equal(s.size(), 1);
  });

  it('independent stacks do not share state', () => {
    const s1 = ModalStack.create();
    const s2 = ModalStack.create();
    s1.push('a');
    assert.equal(s2.size(), 0);
  });
});

describe('ModalStack — layers', () => {
  it('nested layer is above base layer', () => {
    assert.ok(ModalStack.zIndexFor('nested') > ModalStack.zIndexFor('base'));
  });

  it('unknown layer falls back to base', () => {
    assert.equal(ModalStack.zIndexFor('nope'), ModalStack.zIndexFor('base'));
  });

  it('exposes a shared stack instance', () => {
    assert.equal(typeof ModalStack.shared.push, 'function');
  });
});
