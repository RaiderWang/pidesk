/**
 * test/live-custom-models.test.mjs
 *
 * live/custom-models.js — model entry building, models.yml reading and merging
 * custom models into omp's list.
 * Run: node --test test/live-custom-models.test.mjs
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
new Function(readFileSync(join(SRC, 'live/custom-models.js'), 'utf-8'))();

const { buildModelEntry, loadFromConfig, mergeModels } = globalThis._Live.CustomModels;

const YML = [
  'providers:',
  '  arkcode:',
  '    baseUrl: http://x/v1',
  '    api: openai-completions',
  '    models:',
  '      - id: m-a',
  '        name: Model A',
  '        contextWindow: 1000',
  '        reasoning: true',
  '      - id: m-b',
  '',
].join('\n');

function mockTauri(handler) {
  globalThis.window.__TAURI__ = { core: { invoke: async (name, args) => handler(name, args) } };
}

describe('buildModelEntry', () => {
  it('maps an RPC model and marks it current', () => {
    const e = buildModelEntry({ id: 'x', name: 'X', provider: 'p', reasoning: true, input: ['text'] });
    assert.equal(e.id, 'x');
    assert.equal(e.name, 'X');
    assert.equal(e.provider, 'p');
    assert.equal(e.note, 'p');
    assert.equal(e.current, true);
    assert.equal(e.reasoning, true);
    assert.deepEqual(e.input, ['text']);
  });

  it('derives a display name when the RPC model has none', () => {
    const e = buildModelEntry({ id: 'claude-sonnet-4-5', provider: 'p' });
    assert.equal(typeof e.name, 'string');
    assert.ok(e.name.length > 0);
  });
});

describe('loadFromConfig', () => {
  afterEach(() => { delete globalThis.window.__TAURI__; });

  it('returns empty data without a Tauri runtime', async () => {
    delete globalThis.window.__TAURI__;
    const r = await loadFromConfig();
    assert.deepEqual(r.customModels, []);
    assert.equal(r.customProviders.size, 0);
  });

  it('parses providers and models from models.yml', async () => {
    mockTauri((name) => (name === 'read_models_config' ? { content: YML } : null));
    const { customModels, customProviders } = await loadFromConfig();
    assert.deepEqual([...customProviders], ['arkcode']);
    assert.deepEqual(customModels.map((m) => m.id), ['m-a', 'm-b']);
    const a = customModels[0];
    assert.equal(a.provider, 'arkcode');
    assert.equal(a.name, 'Model A');
    assert.equal(a.contextWindow, 1000);
    assert.equal(a.reasoning, true);
    assert.deepEqual(customModels[1].input, ['text']);
    assert.equal(customModels[1].name, 'm-b');
  });

  it('evaluates isCurrent after the file read, not at call time', async () => {
    let active = 'other';
    let release;
    const gate = new Promise((r) => { release = r; });
    mockTauri(async () => { await gate; return { content: YML }; });
    const pending = loadFromConfig((id) => id === active);
    active = 'm-b'; // model switch lands while the read is in flight
    release();
    const { customModels } = await pending;
    assert.deepEqual(customModels.map((m) => [m.id, m.current]), [['m-a', false], ['m-b', true]]);
  });

  it('returns empty data when the read fails', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      mockTauri(() => { throw new Error('boom'); });
      const r = await loadFromConfig();
      assert.deepEqual(r.customModels, []);
      assert.equal(r.customProviders.size, 0);
    } finally {
      console.warn = warn;
    }
  });

  it('returns empty data when models.yml is empty', async () => {
    mockTauri(() => ({ content: '' }));
    const r = await loadFromConfig();
    assert.deepEqual(r.customModels, []);
  });
});

describe('mergeModels', () => {
  const custom = (id, provider, extra = {}) => ({ id, provider, name: `${id}-custom`, ...extra });

  it('enriches a base model that matches provider/id and keeps base order', () => {
    const base = [{ id: 'a', provider: 'p', name: 'A' }, { id: 'b', provider: 'q', name: 'B' }];
    const out = mergeModels(base, { customModels: [custom('b', 'q', { contextWindow: 5 })] });
    assert.deepEqual(out.map((m) => m.id), ['a', 'b']);
    assert.equal(out[1].name, 'b-custom');
    assert.equal(out[1].contextWindow, 5);
    assert.equal(out[0].name, 'A');
  });

  it('matches by id alone when the provider differs', () => {
    const out = mergeModels([{ id: 'a', provider: 'p', name: 'A' }], { customModels: [custom('a', 'other')] });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'a-custom');
  });

  it('appends custom models absent from the base list', () => {
    const out = mergeModels([{ id: 'a', provider: 'p' }], { customModels: [custom('z', 'zp')] });
    assert.deepEqual(out.map((m) => m.id), ['a', 'z']);
  });

  it('tolerates missing lists', () => {
    assert.deepEqual(mergeModels(undefined, { customModels: undefined }), []);
    assert.deepEqual(mergeModels(undefined), []);
    assert.deepEqual(mergeModels([{ id: 'a' }]), [{ id: 'a' }]);
    assert.deepEqual(mergeModels([{ id: 'a' }], { customModels: [] }), [{ id: 'a' }]);
  });
});
