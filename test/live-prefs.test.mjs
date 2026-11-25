/**
 * test/live-prefs.test.mjs
 *
 * live/prefs.js — localStorage persistence of the last model + thinking level.
 * Run: node --test test/live-prefs.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
new Function(readFileSync(join(SRC, 'live/prefs.js'), 'utf-8'))();

const { PREFS_KEY, loadPrefs, savePrefs, clearModelPrefs } = globalThis._Live.Prefs;
const stored = () => JSON.parse(localStorage.getItem(PREFS_KEY));

describe('live/prefs.js', () => {
  beforeEach(() => localStorage.clear());

  it('uses the pidesk:prefs key', () => {
    assert.equal(PREFS_KEY, 'pidesk:prefs');
  });

  it('loadPrefs returns {} when nothing is stored', () => {
    assert.deepEqual(loadPrefs(), {});
  });

  it('loadPrefs returns {} for corrupt JSON instead of throwing', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    assert.deepEqual(loadPrefs(), {});
  });

  it('savePrefs shallow-merges into the stored object', () => {
    savePrefs({ modelId: 'm1', modelProvider: 'p', thinkingLevel: 'low' });
    savePrefs({ thinkingLevel: 'high' });
    assert.deepEqual(stored(), { modelId: 'm1', modelProvider: 'p', thinkingLevel: 'high' });
    assert.deepEqual(loadPrefs(), stored());
  });

  it('savePrefs recovers from corrupt stored JSON', () => {
    localStorage.setItem(PREFS_KEY, 'garbage');
    savePrefs({ thinkingLevel: 'low' });
    assert.deepEqual(stored(), { thinkingLevel: 'low' });
  });

  it('clearModelPrefs drops the model fields and keeps the thinking level', () => {
    savePrefs({ modelId: 'm1', modelProvider: 'p', modelName: 'M', thinkingLevel: 'medium' });
    clearModelPrefs();
    assert.deepEqual(stored(), { thinkingLevel: 'medium' });
  });

  it('clearModelPrefs falls back to manual key removal without ModelPrefs', () => {
    const saved = globalThis.ModelPrefs;
    try {
      delete globalThis.ModelPrefs;
      savePrefs({ modelId: 'm1', modelProvider: 'p', modelName: 'M', thinkingLevel: 'low' });
      clearModelPrefs();
      assert.deepEqual(stored(), { thinkingLevel: 'low' });
    } finally {
      globalThis.ModelPrefs = saved;
    }
  });
});
