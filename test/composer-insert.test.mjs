import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ComposerInsert = require('../src/app/composer-insert.js');

// Mimics React's controlled-input trap: the instance owns a tracked `value`
// property, while the prototype holds the native setter.
class FakeTextarea {
  constructor(initial = '') {
    this._native = initial;
    this._tracked = initial;
    this.events = [];
    this.focused = false;
    Object.defineProperty(this, 'value', {
      configurable: true,
      get: () => this._native,
      set: (v) => {
        this._tracked = v; // React tracker swallows the change
        this._native = v;
      },
    });
  }
  dispatchEvent(ev) {
    // onChange only fires if the tracker still differs from the DOM value.
    this.events.push({ type: ev.type, changed: this._tracked !== this._native });
    this._tracked = this._native;
    return true;
  }
  focus() {
    this.focused = true;
  }
}
Object.defineProperty(FakeTextarea.prototype, 'value', {
  configurable: true,
  get() {
    return this._native;
  },
  set(v) {
    this._native = v; // bypasses the tracker
  },
});

describe('ComposerInsert', () => {
  it('joins with a blank line only when the composer already has text', () => {
    assert.equal(ComposerInsert.joinText('', 'a'), 'a');
    assert.equal(ComposerInsert.joinText('x', 'a'), 'x\n\na');
  });

  it('writes through the prototype setter so React sees a real change', () => {
    const el = new FakeTextarea('draft');
    assert.equal(ComposerInsert.appendToElement(el, 'review prompt'), true);
    assert.equal(el.value, 'draft\n\nreview prompt');
    assert.deepEqual(el.events, [{ type: 'input', changed: true }]);
    assert.equal(el.focused, true);
  });

  it('falls back to plain assignment when there is no prototype setter', () => {
    const el = { value: 'a', dispatchEvent() {}, focus() {} };
    ComposerInsert.setNativeValue(el, 'b');
    assert.equal(el.value, 'b');
  });

  it('reports failure when the textarea is missing or the text is empty', () => {
    assert.equal(ComposerInsert.appendToElement(null, 'x'), false);
    assert.equal(ComposerInsert.appendToElement(new FakeTextarea(), ''), false);
    assert.equal(ComposerInsert.appendToComposer('x'), false); // no document in node
  });
});
