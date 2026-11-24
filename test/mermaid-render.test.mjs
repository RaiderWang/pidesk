import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../src/app/mermaid-render.js');

const SVG =
  '<svg id="pidesk-mmd-7" width="100%" xmlns="http://www.w3.org/2000/svg" ' +
  'viewBox="0 0 812.5 240" style="max-width: 812.5px;" role="graphics-document document">' +
  '<style>#pidesk-mmd-7{font-size:16px}#pidesk-mmd-7 .edge{stroke:#000}</style>' +
  '<defs><marker id="pidesk-mmd-7_flowchart-v2-pointEnd"/></defs>' +
  '<path marker-end="url(#pidesk-mmd-7_flowchart-v2-pointEnd)"/></svg>';

describe('remapIds', () => {
  it('rewrites svg id, style selectors, marker ids and url(#…) refs', () => {
    const out = R.remapIds(SVG, 'pidesk-mmd-7', 'pidesk-mmd-9');
    assert.ok(!out.includes('pidesk-mmd-7'));
    assert.ok(out.includes('<svg id="pidesk-mmd-9"'));
    assert.ok(out.includes('#pidesk-mmd-9 .edge'));
    assert.ok(out.includes('marker id="pidesk-mmd-9_flowchart-v2-pointEnd"'));
    assert.ok(out.includes('url(#pidesk-mmd-9_flowchart-v2-pointEnd)'));
  });
  it('two renders of the same SVG share no ids', () => {
    const a = R.remapIds(SVG, 'pidesk-mmd-7', 'pidesk-mmd-10');
    const b = R.remapIds(SVG, 'pidesk-mmd-7', 'pidesk-mmd-11');
    const ids = (s) => [...s.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const shared = ids(a).filter((x) => ids(b).includes(x));
    assert.deepEqual(shared, []);
  });
  it('is a no-op for identical or empty ids', () => {
    assert.equal(R.remapIds(SVG, 'pidesk-mmd-7', 'pidesk-mmd-7'), SVG);
    assert.equal(R.remapIds(SVG, '', 'x'), SVG);
  });
});

describe('sizeSvg', () => {
  it('replaces 100% width / max-width with the natural viewBox size', () => {
    const out = R.sizeSvg(SVG);
    assert.match(out, /width="813" height="240"/);
    assert.ok(!out.includes('width="100%"'));
    assert.ok(!out.includes('max-width'));
    assert.ok(out.includes('viewBox="0 0 812.5 240"'));
  });
  it('leaves an svg without viewBox untouched', () => {
    const s = '<svg width="100%"><g/></svg>';
    assert.equal(R.sizeSvg(s), s);
  });
  it('leaves non-svg input untouched', () => {
    assert.equal(R.sizeSvg('nope'), 'nope');
  });
});

describe('createCache', () => {
  it('evicts the least recently used entry', () => {
    const c = R.createCache(2);
    c.set('a', 1);
    c.set('b', 2);
    assert.equal(c.get('a'), 1); // a is now most recent
    c.set('c', 3); // evicts b
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('a'), 1);
    assert.equal(c.get('c'), 3);
    assert.equal(c.size, 2);
  });
});

describe('sizeSvg degenerate viewBox', () => {
  it('leaves a zero-size viewBox untouched', () => {
    const s = '<svg width="100%" viewBox="0 0 0 0"><g/></svg>';
    assert.equal(R.sizeSvg(s), s);
  });
});

// ── async orchestration, with a stubbed global `mermaid` ────────────────
function setup() {
  const modPath = require.resolve('../src/app/mermaid-render.js');
  delete require.cache[modPath]; // fresh queue / cache / inflight per test
  const stats = { active: 0, maxActive: 0, renders: [], inits: [] };
  globalThis.MermaidTheme = require('../src/app/mermaid-theme.js');
  globalThis.mermaid = {
    initialize(cfg) { stats.inits.push(cfg); },
    async render(id, code) {
      stats.active += 1;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      await new Promise((r) => setTimeout(r, 5));
      stats.active -= 1;
      stats.renders.push({ id, code });
      if (code.includes('BAD')) throw new Error('Parse error on line 1');
      return {
        svg: `<svg id="${id}" width="100%" viewBox="0 0 100 50"><style>#${id}{}</style><path marker-end="url(#${id}_end)"/></svg>`,
      };
    },
  };
  return { M: require(modPath), stats };
}
function teardown() {
  delete globalThis.mermaid;
  delete globalThis.MermaidTheme;
}
const aurora = { theme: 'aurora', accent: '#78E8BE' };

describe('render orchestration', () => {
  it('serialises concurrent renders (initialize + render never overlap)', async () => {
    const { M, stats } = setup();
    try {
      const out = await Promise.all(['A-->B', 'C-->D', 'E-->F'].map((c) => M.render(c, aurora)));
      assert.ok(out.every((r) => r.ok));
      assert.equal(stats.maxActive, 1);
      assert.equal(stats.renders.length, 3);
    } finally { teardown(); }
  });

  it('a failing diagram does not poison the queue', async () => {
    const { M } = setup();
    try {
      const [bad, good] = await Promise.all([M.render('BAD', aurora), M.render('A-->B', aurora)]);
      assert.equal(bad.ok, false);
      assert.match(bad.error, /Parse error/);
      assert.equal(good.ok, true);
    } finally { teardown(); }
  });

  it('de-duplicates identical in-flight renders but hands out distinct ids', async () => {
    const { M, stats } = setup();
    try {
      const [a, b] = await Promise.all([M.render('A-->B', aurora), M.render('A-->B', aurora)]);
      assert.equal(stats.renders.length, 1);
      const idOf = (s) => /<svg id="([^"]+)"/.exec(s)[1];
      assert.notEqual(idOf(a.svg), idOf(b.svg));
      assert.ok(a.svg.includes(`url(#${idOf(a.svg)}_end)`));
      assert.ok(b.svg.includes(`url(#${idOf(b.svg)}_end)`));
    } finally { teardown(); }
  });

  it('cache hits skip mermaid and remap ids; theme/accent change misses', async () => {
    const { M, stats } = setup();
    try {
      const first = await M.render('A-->B', aurora);
      const again = await M.render('A-->B', aurora);
      assert.equal(stats.renders.length, 1);
      assert.notEqual(first.svg, again.svg); // different ids
      await M.render('A-->B', { theme: 'phosphor', accent: '#39E557' });
      await M.render('A-->B', { theme: 'aurora', accent: '#FF7AC6' });
      assert.equal(stats.renders.length, 3);
    } finally { teardown(); }
  });

  it('does not cache failures (retry runs mermaid again)', async () => {
    const { M, stats } = setup();
    try {
      await M.render('BAD', aurora);
      await M.render('BAD', aurora);
      assert.equal(stats.renders.length, 2);
    } finally { teardown(); }
  });

  it('initialises mermaid per job with strict security and the job theme', async () => {
    const { M, stats } = setup();
    try {
      await M.render('A-->B', aurora);
      await M.render('C-->D', { theme: 'daylight', accent: '#1F8A5B' });
      assert.equal(stats.inits.length, 2);
      for (const cfg of stats.inits) {
        assert.equal(cfg.securityLevel, 'strict');
        assert.equal(cfg.suppressErrorRendering, true);
        assert.equal(cfg.startOnLoad, false);
        assert.equal(cfg.maxEdges, R._constants.MAX_EDGES);
      }
      assert.equal(stats.inits[0].themeVariables.darkMode, true);
      assert.equal(stats.inits[1].themeVariables.darkMode, false);
    } finally { teardown(); }
  });
});

describe('render guards', () => {
  it('rejects empty and oversized sources without touching mermaid', async () => {
    assert.deepEqual(await R.render('  ', { theme: 'aurora' }), { ok: false, error: 'empty' });
    const big = 'A-->B\n'.repeat(R._constants.MAX_TEXT);
    const r = await R.render(big, { theme: 'aurora' });
    assert.equal(r.ok, false);
    assert.equal(r.tooLarge, true);
  });
});
