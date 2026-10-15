/**
 * test/shortcuts.test.mjs
 *
 * Unit tests for src/app/shortcuts.js — registry, event matching, display.
 *
 * Run: node --test test/shortcuts.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppShortcuts } from './helpers/shim.mjs';

const { REGISTRY, matchAction, formatKeys, keysFor, findById, listForDisplay } = AppShortcuts;

const ev = (key, mods = {}, code) => ({
  key,
  code: code ?? (key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : ''),
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
});

describe('registry', () => {
  it('has unique ids', () => {
    const ids = REGISTRY.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('has unique key combos', () => {
    const keys = REGISTRY.map((s) => s.keys.toLowerCase());
    assert.equal(new Set(keys).size, keys.length);
  });

  it('every entry has a label key and a known group', () => {
    for (const s of REGISTRY) {
      assert.ok(s.labelKey, `${s.id} missing labelKey`);
      assert.ok(AppShortcuts.GROUP_ORDER.includes(s.group), `${s.id} has unknown group ${s.group}`);
    }
  });

  it('findById / keysFor resolve known ids and tolerate unknown ones', () => {
    assert.equal(findById('palette').keys, 'CmdOrCtrl+K');
    assert.equal(keysFor('history'), 'CmdOrCtrl+H');
    assert.equal(findById('nope'), null);
    assert.equal(keysFor('nope'), '');
  });
});

describe('matchAction', () => {
  it('matches Ctrl+<key> for each registered letter shortcut', () => {
    assert.equal(matchAction(ev('k', { ctrlKey: true })), 'palette');
    assert.equal(matchAction(ev('h', { ctrlKey: true })), 'history');
    assert.equal(matchAction(ev('m', { ctrlKey: true })), 'models');
    assert.equal(matchAction(ev('o', { ctrlKey: true })), 'openProject');
    assert.equal(matchAction(ev('t', { ctrlKey: true })), 'newSession');
    assert.equal(matchAction(ev('b', { ctrlKey: true })), 'toggleFiles');
    assert.equal(matchAction(ev('j', { ctrlKey: true })), 'togglePlan');
  });

  it('Cmd (meta) also satisfies CmdOrCtrl', () => {
    assert.equal(matchAction(ev('k', { metaKey: true })), 'palette');
  });

  it('matches Ctrl+/ for help', () => {
    assert.equal(matchAction(ev('/', { ctrlKey: true }, 'Slash')), 'help');
  });

  it('does not match without the modifier', () => {
    assert.equal(matchAction(ev('k')), null);
  });

  it('does not match when extra modifiers are held', () => {
    assert.equal(matchAction(ev('k', { ctrlKey: true, shiftKey: true })), null);
    assert.equal(matchAction(ev('k', { ctrlKey: true, altKey: true })), null);
  });

  it('ignores unregistered keys and IME composition', () => {
    assert.equal(matchAction(ev('z', { ctrlKey: true })), null);
    assert.equal(matchAction({ ...ev('k', { ctrlKey: true }), isComposing: true }), null);
    assert.equal(matchAction(null), null);
  });
});

describe('formatKeys', () => {
  it('uses Ctrl+ text off macOS', () => {
    assert.equal(formatKeys('CmdOrCtrl+K', false), 'Ctrl+K');
    assert.equal(formatKeys('CmdOrCtrl+Shift+Space', false), 'Ctrl+Shift+Space');
    assert.equal(formatKeys('Alt+S', false), 'Alt+S');
  });

  it('uses symbols on macOS', () => {
    assert.equal(formatKeys('CmdOrCtrl+K', true), '⌘K');
    assert.equal(formatKeys('CmdOrCtrl+Shift+Space', true), '⌘⇧Space');
    assert.equal(formatKeys('Alt+S', true), '⌥S');
  });

  it('returns empty string for empty input', () => {
    assert.equal(formatKeys('', false), '');
    assert.equal(formatKeys(undefined, true), '');
  });
});

describe('listForDisplay', () => {
  it('returns only registry entries without system shortcuts', () => {
    assert.equal(listForDisplay().length, REGISTRY.length);
  });

  it('appends configured system shortcuts', () => {
    const rows = listForDisplay({ quickBar: 'CmdOrCtrl+Shift+Space', screenshot: 'Alt+S' });
    assert.equal(rows.length, REGISTRY.length + 2);
    const qb = rows.find((r) => r.id === 'quickBar');
    assert.equal(qb.group, 'system');
    assert.equal(qb.keys, 'CmdOrCtrl+Shift+Space');
  });

  it('does not mutate the registry', () => {
    const before = REGISTRY.length;
    listForDisplay({ quickBar: 'X' });
    assert.equal(REGISTRY.length, before);
  });
});

describe('shouldDispatch', () => {
  const { shouldDispatch, MODAL_SAFE } = AppShortcuts;

  it('runs every shortcut when no modal is open', () => {
    for (const s of REGISTRY) assert.equal(shouldDispatch(s.id, { modalOpen: false }), true, s.id);
  });

  it('only palette and help stay live while a modal is open', () => {
    assert.deepEqual([...MODAL_SAFE].sort(), ['help', 'palette']);
    for (const s of REGISTRY) {
      const expected = s.id === 'palette' || s.id === 'help';
      assert.equal(shouldDispatch(s.id, { modalOpen: true }), expected, s.id);
    }
  });

  it('rejects events another handler already consumed', () => {
    assert.equal(shouldDispatch('palette', { defaultPrevented: true }), false);
    assert.equal(shouldDispatch('history', { modalOpen: false, defaultPrevented: true }), false);
  });

  it('rejects a missing id and tolerates omitted state', () => {
    assert.equal(shouldDispatch(null, {}), false);
    assert.equal(shouldDispatch('palette'), true);
  });
});
