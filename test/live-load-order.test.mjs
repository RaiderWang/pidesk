/**
 * test/live-load-order.test.mjs
 *
 * Drift guard: the `live/*` scripts + live.js that tests load (LIVE_PARTS in
 * helpers/load-live.mjs) must match, in files and order, what src/index.html
 * loads — and every file under src/live/ must be listed. Script order is the
 * dependency graph; there is no resolver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { LIVE_PARTS } from './helpers/load-live.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
/** `src` of every plain `<script>` that is live.js or under live/ (HTML comments ignored). */
function scanLiveScripts(rawHtml) {
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of html.matchAll(/<script\s+src="([^"]+)"\s*>\s*<\/script>/g)) {
    if (m[1] === 'live.js' || m[1].startsWith('live/')) out.push(m[1]);
  }
  return out;
}

const indexHtml = readFileSync(join(SRC, 'index.html'), 'utf-8');

describe('live script load order', () => {
  it('LIVE_PARTS matches index.html (files and order)', () => {
    assert.deepEqual(LIVE_PARTS, scanLiveScripts(indexHtml));
  });

  it('live.js is last', () => {
    assert.equal(LIVE_PARTS.at(-1), 'live.js');
  });

  it('every part exists on disk', () => {
    for (const rel of LIVE_PARTS) assert.ok(existsSync(join(SRC, rel)), rel);
  });

  it('no orphan scripts: every file in src/live/ is listed in LIVE_PARTS', () => {
    const onDisk = readdirSync(join(SRC, 'live'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => `live/${f}`)
      .sort();
    const listed = LIVE_PARTS.filter((p) => p.startsWith('live/')).sort();
    assert.deepEqual(onDisk, listed);
  });

  it('commented-out script tags are ignored by the scanner', () => {
    const sample = '<!-- <script src="live/ghost.js"></script> -->\n<script src="live/real.js"></script>';
    assert.deepEqual(scanLiveScripts(sample), ['live/real.js']);
  });
});
