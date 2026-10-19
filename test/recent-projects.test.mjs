import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');

// Setup mock global environment
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};
globalThis.window = globalThis;

// Load recent-projects.js
const code = readFileSync(join(SRC, 'app/recent-projects.js'), 'utf-8');
new Function(code)();

const { RecentProjects } = globalThis;

test('RecentProjects unit tests', async (t) => {
  t.beforeEach(() => {
    localStorage.clear();
  });

  await t.test('getRecentProjects returns empty array initially', () => {
    assert.deepEqual(RecentProjects.getRecentProjects(), []);
  });

  await t.test('addRecentProject adds a project and bumps it to top', () => {
    RecentProjects.addRecentProject('F:\\Project\\A', 'Project A');
    RecentProjects.addRecentProject('F:\\Project\\B', 'Project B');

    let list = RecentProjects.getRecentProjects();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'Project B');
    assert.equal(list[1].name, 'Project A');

    // Adding Project A again moves it to top
    RecentProjects.addRecentProject('F:/project/a', 'Project A');
    list = RecentProjects.getRecentProjects();
    assert.equal(list.length, 2);
    assert.equal(list[0].path, 'F:/project/a');
    assert.equal(list[1].name, 'Project B');
  });

  await t.test('normPath handles backslashes, trailing slashes, and case', () => {
    assert.equal(RecentProjects.normPath('F:\\Projects\\App\\'), 'f:/projects/app');
    assert.equal(RecentProjects.normPath('f:/projects/app'), 'f:/projects/app');
  });

  await t.test('getProjectName extracts folder name correctly', () => {
    assert.equal(RecentProjects.getProjectName('F:\\Project\\omp-desktop'), 'omp-desktop');
    assert.equal(RecentProjects.getProjectName('/home/user/my-app/'), 'my-app');
  });

  await t.test('removeRecentProject removes by path', () => {
    RecentProjects.addRecentProject('F:\\Project\\A');
    RecentProjects.addRecentProject('F:\\Project\\B');
    RecentProjects.removeRecentProject('F:/project/a');

    const list = RecentProjects.getRecentProjects();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'B');
  });

  await t.test('syncFromSavedSessions imports and sorts by timestamp', () => {
    const saved = [
      {
        cwd: 'F:\\Project\\Old',
        project_name: 'Old',
        timestamp: '2026-09-01T10:00:00.000Z',
      },
      {
        cwd: 'F:\\Project\\Newer',
        project_name: 'Newer',
        timestamp: '2026-10-01T10:00:00.000Z',
      },
      {
        cwd: '',
        project_name: 'Default',
        timestamp: '2026-10-05T10:00:00.000Z',
      },
    ];

    const result = RecentProjects.syncFromSavedSessions(saved);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Newer');
    assert.equal(result[1].name, 'Old');
  });

  await t.test('filters out debug and PiDesk standalone sessions', () => {
    // Attempting to add dev target/debug directory should be rejected
    RecentProjects.addRecentProject('F:\\Project\\omp-desktop\\src-tauri\\target\\debug', 'debug');
    assert.equal(RecentProjects.getRecentProjects().length, 0);

    // Attempting to add Program Files PiDesk should be rejected
    RecentProjects.addRecentProject('E:\\Program Files\\PiDesk', 'PiDesk');
    assert.equal(RecentProjects.getRecentProjects().length, 0);

    // Attempting to add Program Files OMP Desktop should be rejected
    RecentProjects.addRecentProject('C:\\Program Files\\OMP Desktop', 'OMP Desktop');
    assert.equal(RecentProjects.getRecentProjects().length, 0);

    // Syncing saved sessions with standalone sessions should skip them
    const saved = [
      {
        cwd: 'F:\\Project\\omp-desktop\\src-tauri\\target\\debug',
        project_name: 'debug',
        timestamp: '2026-10-09T00:00:00.000Z',
      },
      {
        cwd: 'E:\\Program Files\\PiDesk',
        project_name: 'PiDesk',
        timestamp: '2026-10-09T00:00:00.000Z',
      },
      {
        cwd: 'F:\\Project\\my-real-project',
        project_name: 'my-real-project',
        timestamp: '2026-10-09T00:00:00.000Z',
      },
    ];

    const result = RecentProjects.syncFromSavedSessions(saved);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'my-real-project');
  });

  await t.test('recognises the dedicated no-project workspace on every platform', () => {
    const standalone = [
      'C:\\Users\\me\\AppData\\Local\\com.raiderwang.pidesk\\workspace',
      '/Users/me/Library/Application Support/com.raiderwang.pidesk/workspace',
      '/home/me/.local/share/com.raiderwang.pidesk/workspace/',
      '/home/me/.local/share/com.raiderwang.pidesk/workspace/sub',
    ];
    for (const p of standalone) {
      assert.equal(RecentProjects.isStandalonePath(p, 'workspace'), true, p);
    }
    // Unrelated "workspace" folders and look-alikes stay real projects.
    assert.equal(RecentProjects.isStandalonePath('F:\\Project\\workspace', 'workspace'), false);
    assert.equal(
      RecentProjects.isStandalonePath('/home/me/com.raiderwang.pidesk/workspace-old', 'workspace-old'),
      false
    );
  });

  await t.test('purges pre-existing standalone entries from storage', () => {
    // Simulate pre-existing localStorage containing debug and PiDesk
    localStorage.setItem('pidesk:recent_projects', JSON.stringify([
      { path: 'F:\\Project\\omp-desktop\\src-tauri\\target\\debug', name: 'debug', lastOpened: 100 },
      { path: 'E:\\Program Files\\PiDesk', name: 'PiDesk', lastOpened: 90 },
      { path: 'F:\\Project\\real-project', name: 'real-project', lastOpened: 80 },
    ]));

    const list = RecentProjects.getRecentProjects();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'real-project');

    // Storage should have been rewritten without the standalone entries
    const stored = JSON.parse(localStorage.getItem('pidesk:recent_projects'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].name, 'real-project');
  });
});
