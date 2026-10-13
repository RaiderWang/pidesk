import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../src/review/review-drawer-width.js');

describe('ReviewDrawerWidth', () => {
  it('caps the drawer at 85% of the viewport but never below the minimum', () => {
    assert.equal(W.maxWidth(1000), 850);
    assert.equal(W.maxWidth(300), W.MIN_WIDTH);
    assert.equal(W.maxWidth(NaN), Math.floor(W.DEFAULT_WIDTH * 2 * W.MAX_VIEWPORT_RATIO));
  });

  it('clamps widths into [min, max] and rejects NaN', () => {
    assert.equal(W.clampWidth(100, 1200), W.MIN_WIDTH);
    assert.equal(W.clampWidth(5000, 1200), 1020);
    assert.equal(W.clampWidth(640.4, 1200), 640);
    assert.equal(W.clampWidth(NaN, 1200), W.DEFAULT_WIDTH);
    // Default itself is clamped on narrow windows.
    assert.equal(W.clampWidth(NaN, 600), 510);
  });

  it('sanitises persisted values (missing, garbage, oversized)', () => {
    assert.equal(W.parseSavedWidth(null, 1400), W.DEFAULT_WIDTH);
    assert.equal(W.parseSavedWidth('', 1400), W.DEFAULT_WIDTH);
    assert.equal(W.parseSavedWidth('abc', 1400), W.DEFAULT_WIDTH);
    assert.equal(W.parseSavedWidth('700', 1400), 700);
    assert.equal(W.parseSavedWidth('9999', 1000), 850);
  });

  it('widens when dragging left and narrows when dragging right', () => {
    assert.equal(W.widthAfterDrag(580, 800, 700, 1400), 680);
    assert.equal(W.widthAfterDrag(580, 800, 900, 1400), 480);
    assert.equal(W.widthAfterDrag(580, 800, 0, 1000), 850);
    assert.equal(W.widthAfterDrag(580, 800, 2000, 1000), W.MIN_WIDTH);
  });
});
