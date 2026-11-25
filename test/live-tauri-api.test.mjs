/**
 * test/live-tauri-api.test.mjs
 *
 * live/tauri-api.js — OMP_BRIDGE methods that wrap a single Tauri command.
 * Run: node --test test/live-tauri-api.test.mjs
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';
import { loadLive } from './helpers/load-live.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['peer-session.js', 'app/undo-message.js', 'undo-bridge.js', 'export-bridge.js']) {
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
loadLive(); // demo mode: no __TAURI__ yet

const api = globalThis._Live.TauriApi;
const calls = [];

function mockTauri(handler = () => null) {
  calls.length = 0;
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (name, args) => {
        calls.push({ name, args });
        return handler(name, args);
      },
    },
  };
}

const silent = async (fn) => {
  const err = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = err; }
};

describe('live/tauri-api.js — merged into OMP_BRIDGE', () => {
  it('every TauriApi method is exposed on window.OMP_BRIDGE unchanged', () => {
    const names = Object.keys(api);
    assert.ok(names.includes('pickFolder') && names.includes('getDefaultCwd'));
    for (const n of names) assert.equal(globalThis.OMP_BRIDGE[n], api[n], n);
  });
});

describe('live/tauri-api.js — no Tauri runtime (demo mode)', () => {
  afterEach(() => { delete globalThis.window.__TAURI__; });

  it('returns the documented fallbacks', async () => {
    delete globalThis.window.__TAURI__;
    assert.deepEqual(await api.listSavedSessions(), []);
    assert.equal(await api.getDefaultCwd(), null);
    assert.equal(await api.pickFolder(), null);
    assert.deepEqual(await api.readModelsConfig(), { path: '', content: '', exists: false });
    assert.deepEqual(await api.listDirectory('/x'), []);
    assert.equal(await api.getAppVersion(), '0.3.0');
    assert.equal(await api.writeModelsConfig('x'), undefined);
    assert.equal(await api.deleteSavedSession('/a.jsonl'), undefined);
  });
});

describe('live/tauri-api.js — invoke wiring', () => {
  afterEach(() => { delete globalThis.window.__TAURI__; });

  it('forwards command names and argument shapes', async () => {
    mockTauri();
    await api.listSavedSessions('C:/p');
    await api.deleteSavedSession('/s/a.jsonl');
    await api.writeModelsConfig('yaml');
    await api.openModelsFile();
    await api.openModelsFolder();
    await api.listDirectory('/d');
    await api.renameFile('/a', '/b');
    await api.deleteFileOrDir('/c');
    await api.openPathDefault('/e');
    await api.openWithEditor('code', '/f');
    await api.revealInExplorer('/g');
    await api.startFilesWatch('w1', '/h');
    await api.stopFilesWatch('w1');
    await api.pickFolder();
    assert.deepEqual(calls.map((c) => [c.name, c.args]), [
      ['list_saved_sessions', { cwd: 'C:/p' }],
      ['delete_saved_session', { path: '/s/a.jsonl' }],
      ['write_models_config', { content: 'yaml' }],
      ['open_models_file', undefined],
      ['open_models_folder', undefined],
      ['list_directory', { path: '/d' }],
      ['rename_file', { oldPath: '/a', newPath: '/b' }],
      ['delete_file_or_dir', { path: '/c' }],
      ['open_path_default', { path: '/e' }],
      ['open_with_editor', { editor: 'code', path: '/f' }],
      ['reveal_in_explorer', { path: '/g' }],
      ['start_file_watch', { watchId: 'w1', path: '/h' }],
      ['stop_file_watch', { watchId: 'w1' }],
      ['open_project', undefined],
    ]);
  });

  it('listSavedSessions passes null cwd by default and swallows errors into []', async () => {
    mockTauri(() => { throw new Error('nope'); });
    assert.deepEqual(await silent(() => api.listSavedSessions()), []);
    assert.deepEqual(calls[0].args, { cwd: null });
  });

  it('listSavedSessions maps a null result to []', async () => {
    mockTauri(() => null);
    assert.deepEqual(await api.listSavedSessions(), []);
  });

  it('getDefaultCwd records the directory in RecentProjects as a side effect', async () => {
    const seen = [];
    globalThis.RecentProjects = { setDefaultCwd: (d) => seen.push(d) };
    try {
      mockTauri(() => 'C:/ws');
      assert.equal(await api.getDefaultCwd(), 'C:/ws');
      assert.deepEqual(seen, ['C:/ws']);
    } finally {
      delete globalThis.RecentProjects;
    }
  });

  it('getDefaultCwd works without RecentProjects and returns null on failure', async () => {
    delete globalThis.RecentProjects;
    mockTauri(() => 'C:/ws');
    assert.equal(await api.getDefaultCwd(), 'C:/ws');
    mockTauri(() => { throw new Error('x'); });
    assert.equal(await api.getDefaultCwd(), null);
  });

  it('mutating commands rethrow backend errors, watch commands swallow them', async () => {
    mockTauri(() => { throw new Error('denied'); });
    await silent(async () => {
      await assert.rejects(api.renameFile('/a', '/b'), /denied/);
      await assert.rejects(api.readModelsConfig(), /denied/);
      await assert.rejects(api.writeModelsConfig('x'), /denied/);
      await api.startFilesWatch('w', '/p');
      await api.stopFilesWatch('w');
    });
  });

  it('getAppVersion returns the backend value and falls back on error', async () => {
    mockTauri(() => '1.2.3');
    assert.equal(await api.getAppVersion(), '1.2.3');
    mockTauri(() => { throw new Error('x'); });
    assert.equal(await silent(() => api.getAppVersion()), '0.3.0');
  });
});
