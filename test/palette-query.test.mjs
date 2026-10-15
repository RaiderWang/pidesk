/**
 * test/palette-query.test.mjs
 *
 * Unit tests for src/app/palette-query.js (prefix modes, ranking, grouping)
 * and src/app/file-index.js (bounded project file index).
 *
 * Run: node --test test/palette-query.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaletteQuery, FileIndex } from './helpers/shim.mjs';

const { parsePaletteQuery, groupsForMode, buildPaletteView } = PaletteQuery;
const { buildFileIndex, relativePath } = FileIndex;

const items = [
  { id: 'c1', group: 'commands', label: '/plan', hint: 'draft a plan before writing code' },
  { id: 'c2', group: 'commands', label: '/compact', hint: 'compact context window' },
  { id: 'a1', group: 'actions', label: 'Toggle files panel', keywords: ['sidebar', 'explorer'] },
  { id: 't1', group: 'tabs', label: 'omp-desktop' },
  { id: 'h1', group: 'history', label: 'Fix the reader bug', hint: 'pidesk' },
  { id: 'f1', group: 'files', label: 'src/app-live.jsx' },
];

describe('parsePaletteQuery', () => {
  it('plain text selects the "all" mode', () => {
    assert.deepEqual(parsePaletteQuery('  model '), { mode: 'all', text: 'model' });
  });

  it('maps each prefix to its mode and strips it', () => {
    assert.deepEqual(parsePaletteQuery('/plan'), { mode: 'commands', text: 'plan' });
    assert.deepEqual(parsePaletteQuery('#bug'), { mode: 'sessions', text: 'bug' });
    assert.deepEqual(parsePaletteQuery('@app'), { mode: 'files', text: 'app' });
    assert.deepEqual(parsePaletteQuery('?'), { mode: 'shortcuts', text: '' });
  });

  it('tolerates leading whitespace before the prefix', () => {
    assert.deepEqual(parsePaletteQuery('  @x'), { mode: 'files', text: 'x' });
  });

  it('handles empty / nullish input', () => {
    assert.deepEqual(parsePaletteQuery(''), { mode: 'all', text: '' });
    assert.deepEqual(parsePaletteQuery(undefined), { mode: 'all', text: '' });
  });
});

describe('groupsForMode', () => {
  it('hides history until the user types something', () => {
    assert.deepEqual(groupsForMode('all', ''), ['commands', 'actions', 'tabs']);
    assert.ok(groupsForMode('all', 'x').includes('history'));
  });

  it('never includes files outside @ mode', () => {
    assert.equal(groupsForMode('all', 'x').includes('files'), false);
    assert.deepEqual(groupsForMode('files', ''), ['files']);
  });

  it('shortcuts mode shows no item groups', () => {
    assert.deepEqual(groupsForMode('shortcuts', ''), []);
  });
});

describe('buildPaletteView', () => {
  it('empty query lists commands, actions and tabs in group order', () => {
    const v = buildPaletteView(items, '');
    assert.deepEqual(v.groups.map((g) => g.group), ['commands', 'actions', 'tabs']);
    assert.equal(v.flat.length, 4);
  });

  it('"/" restricts to commands', () => {
    const v = buildPaletteView(items, '/');
    assert.deepEqual(v.groups.map((g) => g.group), ['commands']);
  });

  it('"/pl" filters commands by fuzzy label', () => {
    const v = buildPaletteView(items, '/pl');
    assert.deepEqual(v.flat.map((e) => e.item.id), ['c1']);
  });

  it('"#" lists tabs and history', () => {
    const v = buildPaletteView(items, '#');
    assert.deepEqual(v.groups.map((g) => g.group), ['tabs', 'history']);
  });

  it('"@" lists only files', () => {
    const v = buildPaletteView(items, '@');
    assert.deepEqual(v.flat.map((e) => e.item.id), ['f1']);
  });

  it('matches on hint text when the label does not match', () => {
    const v = buildPaletteView(items, 'writing code');
    assert.deepEqual(v.flat.map((e) => e.item.id), ['c1']);
    assert.deepEqual(v.flat[0].ranges, []); // hint hits carry no label ranges
  });

  it('matches on keywords', () => {
    const v = buildPaletteView(items, 'explorer');
    assert.deepEqual(v.flat.map((e) => e.item.id), ['a1']);
  });

  it('includes history once there is a query', () => {
    const v = buildPaletteView(items, 'reader');
    assert.deepEqual(v.flat.map((e) => e.item.id), ['h1']);
  });

  it('returns label ranges for highlighting', () => {
    const v = buildPaletteView(items, 'toggle');
    assert.deepEqual(v.flat[0].ranges, [[0, 6]]);
  });

  it('flat list order matches group order (cursor navigation)', () => {
    const v = buildPaletteView(items, '');
    const fromGroups = v.groups.flatMap((g) => g.entries.map((e) => e.item.id));
    assert.deepEqual(v.flat.map((e) => e.item.id), fromGroups);
  });

  it('returns no groups when nothing matches', () => {
    const v = buildPaletteView(items, 'zzzzzz');
    assert.equal(v.groups.length, 0);
    assert.equal(v.flat.length, 0);
  });
});

describe('relativePath', () => {
  it('strips the project root and normalizes separators', () => {
    assert.equal(relativePath('C:\\proj\\app', 'C:\\proj\\app\\src\\a.js'), 'src/a.js');
    assert.equal(relativePath('/home/u/app/', '/home/u/app/b.md'), 'b.md');
  });

  it('returns the path unchanged when outside the root', () => {
    assert.equal(relativePath('/a', '/b/c.js'), '/b/c.js');
  });

  it('does not treat a sibling with a shared prefix as inside the root', () => {
    assert.equal(relativePath('/a/app', '/a/app-other/x.js'), '/a/app-other/x.js');
  });
});

describe('buildFileIndex', () => {
  const tree = {
    '/r':          [{ name: 'a.js', path: '/r/a.js', is_dir: false }, { name: 'src', path: '/r/src', is_dir: true }, { name: 'node_modules', path: '/r/node_modules', is_dir: true }],
    '/r/src':      [{ name: 'b.js', path: '/r/src/b.js', is_dir: false }, { name: 'deep', path: '/r/src/deep', is_dir: true }],
    '/r/src/deep': [{ name: 'c.js', path: '/r/src/deep/c.js', is_dir: false }],
    '/r/node_modules': [{ name: 'x.js', path: '/r/node_modules/x.js', is_dir: false }],
  };
  const listDir = async (p) => tree[p] ?? [];

  it('collects files recursively with relative paths', async () => {
    const out = await buildFileIndex('/r', listDir);
    assert.deepEqual(out.map((f) => f.rel).sort(), ['a.js', 'src/b.js', 'src/deep/c.js']);
  });

  it('skips ignored directories', async () => {
    const out = await buildFileIndex('/r', listDir);
    assert.equal(out.some((f) => f.rel.includes('node_modules')), false);
  });

  it('honours maxDepth', async () => {
    const out = await buildFileIndex('/r', listDir, { maxDepth: 1 });
    assert.deepEqual(out.map((f) => f.rel).sort(), ['a.js', 'src/b.js']);
  });

  it('honours maxEntries', async () => {
    const out = await buildFileIndex('/r', listDir, { maxEntries: 2 });
    assert.equal(out.length, 2);
  });

  it('survives a failing directory listing', async () => {
    const flaky = async (p) => { if (p === '/r/src') throw new Error('denied'); return listDir(p); };
    const out = await buildFileIndex('/r', flaky);
    assert.deepEqual(out.map((f) => f.rel), ['a.js']);
  });
});
