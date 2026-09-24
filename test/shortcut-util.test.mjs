/**
 * test/shortcut-util.test.mjs
 *
 * Unit tests for src/design/tweaks/shortcut-util.js:
 *   - normalizeKey: modifiers, single chars, special keys, digits
 *   - parseKeyCombo: KeyboardEvent simulation -> canonical string
 *   - formatDisplayShortcut: visual display string
 *   - matchesShortcut: matching logic with modifiers
 *
 * Run: node --test test/shortcut-util.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');

// Load script in global scope
globalThis.window = globalThis;
const code = readFileSync(join(SRC, 'design/tweaks/shortcut-util.js'), 'utf-8');
new Function(code)();

const { parseKeyCombo, formatDisplayShortcut, matchesShortcut, normalizeKey } = globalThis.ShortcutUtil;

describe('normalizeKey', () => {
  it('returns empty string for modifier keys', () => {
    assert.equal(normalizeKey('Control'), '');
    assert.equal(normalizeKey('Shift'), '');
    assert.equal(normalizeKey('Alt'), '');
    assert.equal(normalizeKey('Meta'), '');
  });

  it('normalizes space and special keys', () => {
    assert.equal(normalizeKey(' '), 'Space');
    assert.equal(normalizeKey('Escape'), 'Esc');
    assert.equal(normalizeKey('ArrowUp'), 'Up');
  });

  it('normalizes letter codes', () => {
    assert.equal(normalizeKey('s', 'KeyS'), 'S');
    assert.equal(normalizeKey('a', 'KeyA'), 'A');
  });

  it('normalizes function keys', () => {
    assert.equal(normalizeKey('F1'), 'F1');
    assert.equal(normalizeKey('f12'), 'F12');
  });
});

describe('parseKeyCombo', () => {
  it('parses single non-modifier key', () => {
    const e = { key: 's', code: 'KeyS', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    assert.equal(parseKeyCombo(e), 'S');
  });

  it('parses Alt+S', () => {
    const e = { key: 's', code: 'KeyS', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
    assert.equal(parseKeyCombo(e), 'Alt+S');
  });

  it('parses Ctrl+Shift+Space', () => {
    const e = { key: ' ', code: 'Space', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
    assert.equal(parseKeyCombo(e), 'CmdOrCtrl+Shift+Space');
  });

  it('parses Meta+Shift+A as CmdOrCtrl+Shift+A', () => {
    const e = { key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: true, metaKey: true };
    assert.equal(parseKeyCombo(e), 'CmdOrCtrl+Shift+A');
  });

  it('returns null when only modifier key is pressed', () => {
    const e = { key: 'Control', code: 'ControlLeft', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
    assert.equal(parseKeyCombo(e), null);
  });
});

describe('formatDisplayShortcut', () => {
  it('formats Alt+S with spaces', () => {
    assert.equal(formatDisplayShortcut('Alt+S'), 'Alt + S');
  });

  it('formats CmdOrCtrl+Shift+Space', () => {
    const res = formatDisplayShortcut('CmdOrCtrl+Shift+Space');
    assert.ok(res.includes('Shift + Space'));
    assert.ok(res.includes('Ctrl') || res.includes('⌘'));
  });
});

describe('matchesShortcut', () => {
  it('matches exact Alt+S', () => {
    const e = { key: 's', code: 'KeyS', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
    assert.equal(matchesShortcut(e, 'Alt+S'), true);
    assert.equal(matchesShortcut(e, 'Alt+A'), false);
    assert.equal(matchesShortcut(e, 'Ctrl+S'), false);
  });

  it('matches CmdOrCtrl with ctrlKey or metaKey', () => {
    const eCtrl = { key: ' ', code: 'Space', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
    assert.equal(matchesShortcut(eCtrl, 'CmdOrCtrl+Shift+Space'), true);

    const eMeta = { key: ' ', code: 'Space', ctrlKey: false, altKey: false, shiftKey: true, metaKey: true };
    assert.equal(matchesShortcut(eMeta, 'CmdOrCtrl+Shift+Space'), true);
  });
});
