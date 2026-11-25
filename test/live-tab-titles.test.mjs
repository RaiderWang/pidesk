/**
 * test/live-tab-titles.test.mjs
 *
 * live/tab-titles.js in isolation (real window.SessionTitle for the naming
 * rules): id resolution, omp-reported titles, first-prompt auto-naming.
 *
 * Run: node --test test/live-tab-titles.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['app/session-title.js', 'live/tab-titles.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}

const { TabTitles } = globalThis._Live;

let reg, rt, notified, h;

beforeEach(() => {
  reg = new Map([
    ['a', { id: 'a', name: 'PiDesk', path: '' }],
    ['b', { id: 'b', name: 'PiDesk (2)', path: '', savedSessionId: 'saved-b' }],
  ]);
  rt = { conn: { activeSessionId: 'a' } };
  notified = 0;
  h = TabTitles.create({ rt, sessionRegistry: reg, notify: () => { notified++; } });
});

describe('tab-titles — resolveSessionId', () => {
  it('maps a tab id, a saved omp id, and falls back to the active tab', () => {
    assert.equal(h.resolveSessionId('b'), 'b');
    assert.equal(h.resolveSessionId('saved-b'), 'b');
    assert.equal(h.resolveSessionId('unknown'), 'a');
    assert.equal(h.resolveSessionId(null), 'a');
  });
});

describe('tab-titles — setTabTitle', () => {
  it('renames and locks the active tab, notifying', () => {
    h.setTabTitle('Fix the build');
    const e = reg.get('a');
    assert.match(e.name, /Fix the build/);
    assert.equal(e.titleLocked, true);
    assert.equal(e.userTitled, true);
    assert.equal(notified, 1);
  });

  it('a background tab is renamed without notifying', () => {
    h.setTabTitle('Background work', 'b');
    assert.match(reg.get('b').name, /Background work/);
    assert.equal(notified, 0);
  });

  it('never binds savedSessionId for an unmatched target', () => {
    h.setTabTitle('Whatever', 'stranger');
    assert.equal(reg.get('a').savedSessionId, undefined);
  });

  it('empty title / no active tab: no-op', () => {
    h.setTabTitle('');
    rt.conn.activeSessionId = null;
    h.setTabTitle('x', 'nope');
    assert.equal(notified, 0);
    assert.equal(reg.get('a').name, 'PiDesk');
  });
});

describe('tab-titles — updateTabTitleIfDefault', () => {
  it('names an untouched tab after the first prompt, once', () => {
    h.updateTabTitleIfDefault('refactor the parser');
    const first = reg.get('a').name;
    assert.match(first, /refactor the parser/);
    assert.equal(notified, 1);
    h.updateTabTitleIfDefault('something else entirely');
    assert.equal(reg.get('a').name, first);
    assert.equal(notified, 1);
  });

  it('slash commands do not name the tab', () => {
    h.updateTabTitleIfDefault('/compact');
    assert.equal(reg.get('a').name, 'PiDesk');
    assert.equal(notified, 0);
  });
});
