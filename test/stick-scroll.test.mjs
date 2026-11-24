/**
 * test/stick-scroll.test.mjs
 *
 * Unit tests for src/app/stick-scroll.js (pin-to-bottom decisions).
 *
 * Run: node --test test/stick-scroll.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StickScroll } from './helpers/shim.mjs';

const box = (scrollHeight, scrollTop, clientHeight) => ({ scrollHeight, scrollTop, clientHeight });

describe('StickScroll.isNearBottom', () => {
  it('is true exactly at the bottom and at the threshold edge', () => {
    assert.equal(StickScroll.isNearBottom(box(500, 320, 180)), true);
    assert.equal(StickScroll.isNearBottom(box(500, 280, 180)), true); // 40px away
  });

  it('is false beyond the threshold', () => {
    assert.equal(StickScroll.isNearBottom(box(500, 279, 180)), false);
    assert.equal(StickScroll.isNearBottom(box(500, 0, 180)), false);
  });

  it('honours a custom threshold', () => {
    assert.equal(StickScroll.isNearBottom(box(500, 300, 180), 10), false);
    assert.equal(StickScroll.isNearBottom(box(500, 300, 180), 20), true);
  });

  it('is true when content does not fill the box', () => {
    assert.equal(StickScroll.isNearBottom(box(100, 0, 180)), true);
  });

  it('treats a missing element as pinned', () => {
    assert.equal(StickScroll.isNearBottom(null), true);
  });
});

describe('StickScroll.nextStick', () => {
  it('scrolling up pauses pinning', () => {
    const r = StickScroll.nextStick({ stuck: true, active: true, wasActive: true, nearBottom: false });
    assert.equal(r, false);
  });

  it('scrolling back to the bottom resumes pinning', () => {
    const r = StickScroll.nextStick({ stuck: false, active: true, wasActive: true, nearBottom: true });
    assert.equal(r, true);
  });

  it('new content keeps a paused state paused', () => {
    const r = StickScroll.nextStick({ stuck: false, active: true, wasActive: true });
    assert.equal(r, false);
  });

  it('new content keeps a pinned state pinned', () => {
    const r = StickScroll.nextStick({ stuck: true, active: true, wasActive: true });
    assert.equal(r, true);
  });

  it('inactive -> active re-pins even if the user had scrolled up before', () => {
    const r = StickScroll.nextStick({ stuck: false, active: true, wasActive: false });
    assert.equal(r, true);
  });

  it('inactive content updates do not change the state', () => {
    const r = StickScroll.nextStick({ stuck: false, active: false, wasActive: false });
    assert.equal(r, false);
  });
});
