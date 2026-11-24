import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../src/app/mermaid-export.js');

describe('prepareSvg', () => {
  it('turns HTML-only entities into XML numeric references', () => {
    const out = E.prepareSvg('<svg><text>a&nbsp;b &copy; &hellip;</text></svg>');
    assert.ok(!out.includes('&nbsp;'));
    assert.match(out, /a&#160;b &#169; &#8230;/);
  });
  it('keeps XML entities and numeric references untouched', () => {
    const s = '<svg xmlns="http://www.w3.org/2000/svg"><text>&amp; &lt; &gt; &quot; &apos; &#160; &#xA0;</text></svg>';
    assert.equal(E.prepareSvg(s), s);
  });
  it('escapes unknown named entities instead of failing the XML parse', () => {
    assert.match(E.prepareSvg('<svg><text>&bogus;</text></svg>'), /&amp;bogus;/);
  });
  it('self-closes <br> including ones with attributes', () => {
    const out = E.prepareSvg('<svg><div>a<br>b<br />c<br class="x">d<br/></div></svg>');
    assert.equal((out.match(/<br\/>/g) || []).length, 3);
    assert.ok(out.includes('<br class="x"/>'));
    assert.ok(!/<br>/.test(out));
  });
  it('self-closes <hr> as well', () => {
    const out = E.prepareSvg('<svg><div>a<hr>b<hr class="x"></div></svg>');
    assert.ok(out.includes('<hr/>'));
    assert.ok(out.includes('<hr class="x"/>'));
    assert.ok(!/<hr>/.test(out));
  });
  it('adds xmlns (and xlink when used) to the root only when missing', () => {
    const bare = E.prepareSvg('<svg width="10" height="5"><use xlink:href="#a"/></svg>');
    assert.ok(bare.includes('xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(bare.includes('xmlns:xlink="http://www.w3.org/1999/xlink"'));
    const done = '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>';
    assert.equal(E.prepareSvg(done), done);
  });
  it('is idempotent and keeps CJK text', () => {
    const s = '<svg width="10" height="5"><text>流程图&nbsp;节点<br></text></svg>';
    const once = E.prepareSvg(s);
    assert.equal(E.prepareSvg(once), once);
    assert.ok(once.includes('流程图'));
  });
});

describe('svgSize', () => {
  it('reads width/height from the root element', () => {
    assert.deepEqual(E.svgSize('<svg width="813" height="240" viewBox="0 0 1 1"></svg>'), { w: 813, h: 240 });
  });
  it('returns null without usable dimensions', () => {
    assert.equal(E.svgSize('<svg width="100%"></svg>'), null);
    assert.equal(E.svgSize('<svg width="0" height="5"></svg>'), null);
    assert.equal(E.svgSize('nope'), null);
  });
});

describe('layout', () => {
  it('scales 2x and adds padding on every side', () => {
    const g = E.layout(100, 50);
    assert.equal(g.scale, 2);
    assert.equal(g.width, (100 + 40) * 2);
    assert.equal(g.height, (50 + 40) * 2);
    assert.equal(g.x, 40);
    assert.equal(g.y, 40);
    assert.equal(g.drawW, 200);
    assert.equal(g.drawH, 100);
  });
  it('counts padding toward the max edge', () => {
    const g = E.layout(8000, 100, { maxEdge: 8192, padding: 20 });
    assert.ok(g.width <= 8192);
    assert.ok(g.scale < 1.03);
    // the drawn diagram plus both margins fills the canvas
    assert.ok(Math.abs(g.x * 2 + g.drawW - g.width) <= 1);
  });
  it('caps total pixels for very large diagrams', () => {
    const g = E.layout(6000, 6000, { maxEdge: 100000, maxPixels: 1000000 });
    assert.ok(g.width * g.height <= 1000000);
  });
  it('rejects invalid sizes', () => {
    assert.equal(E.layout(0, 10), null);
    assert.equal(E.layout(10, NaN), null);
    assert.equal(E.layout(-1, 10), null);
    assert.equal(E.layout(10, 10, { padding: -1 }), null);
  });
});

describe('defaultFilename', () => {
  it('formats a local timestamp as a .png name', () => {
    assert.equal(E.defaultFilename(new Date(2026, 10, 24, 9, 5, 7)), 'diagram-2026-11-24_09-05-07.png');
  });
});

describe('needsPlainLabels', () => {
  it('is true for WebKit without a Chromium token (WKWebView, WebKitGTK)', () => {
    assert.equal(E.needsPlainLabels('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'), true);
  });
  it('is false for WebView2/Chromium', () => {
    assert.equal(
      E.needsPlainLabels('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0'),
      false,
    );
    assert.equal(E.needsPlainLabels(''), false);
  });
});

// ── exportPng orchestration with stubbed browser pieces ─────────────────
describe('exportPng', () => {
  const style = { theme: 'daylight', accent: '#1F8A5B' };
  function stub(ua, { failFirst, noCtx = false }) {
    const modPath = require.resolve('../src/app/mermaid-export.js');
    delete require.cache[modPath];
    const calls = { plainRenders: 0, images: [] };
    globalThis.MermaidTheme = require('../src/app/mermaid-theme.js');
    globalThis.MermaidRender = {
      async renderForExport() { calls.plainRenders += 1; return { ok: true, svg: '<svg width="10" height="5"><text>plain</text></svg>' }; },
    };
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true });
    globalThis.DOMParser = undefined;
    globalThis.Image = class {
      set src(v) {
        calls.images.push(decodeURIComponent(v.split(',').slice(1).join(',')));
        const bad = failFirst && calls.images.length === 1;
        queueMicrotask(() => (bad ? this.onerror() : this.onload()));
      }
    };
    globalThis.document = {
      createElement: () => ({
        getContext: () => (noCtx ? null : { fillRect() {}, drawImage() {}, set fillStyle(v) { calls.bg = v; } }),
        toDataURL: () => 'data:image/png;base64,QUJD',
      }),
    };
    return { X: require(modPath), calls };
  }
  function restore() {
    for (const k of ['MermaidTheme', 'MermaidRender', 'DOMParser', 'Image', 'document']) delete globalThis[k];
    delete globalThis.navigator;
  }
  const CARD_SVG = '<svg width="20" height="10"><text>card</text></svg>';
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0';
  const WEBKIT = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko)';

  it('Chromium: rasterises the card svg directly with the theme background', async () => {
    const { X, calls } = stub(CHROME, { failFirst: false });
    try {
      const b64 = await X.exportPng({ svg: CARD_SVG, code: 'A-->B', style });
      assert.equal(b64, 'QUJD');
      assert.equal(calls.plainRenders, 0);
      assert.ok(calls.images[0].includes('card'));
      assert.equal(calls.bg, '#F6F3EB');
    } finally { restore(); }
  });

  it('Chromium: falls back to the plain-label render when the first attempt fails', async () => {
    const { X, calls } = stub(CHROME, { failFirst: true });
    try {
      assert.equal(await X.exportPng({ svg: CARD_SVG, code: 'A-->B', style }), 'QUJD');
      assert.equal(calls.plainRenders, 1);
      assert.ok(calls.images[1].includes('plain'));
    } finally { restore(); }
  });

  it('WebKit: goes straight to the plain-label render', async () => {
    const { X, calls } = stub(WEBKIT, { failFirst: false });
    try {
      assert.equal(await X.exportPng({ svg: CARD_SVG, code: 'A-->B', style }), 'QUJD');
      assert.equal(calls.plainRenders, 1);
      assert.equal(calls.images.length, 1);
      assert.ok(calls.images[0].includes('plain'));
    } finally { restore(); }
  });

  it('reports a readable error when no 2d context is available', async () => {
    const { X } = stub(WEBKIT, { failFirst: false, noCtx: true });
    try {
      await assert.rejects(
        () => X.exportPng({ svg: CARD_SVG, code: 'A-->B', style }),
        /2d canvas context unavailable/,
      );
    } finally { restore(); }
  });

  it('encodes CJK through a UTF-8 data URL without btoa', async () => {
    const { X, calls } = stub(CHROME, { failFirst: false });
    try {
      await X.exportPng({ svg: '<svg width="20" height="10"><text>中文节点</text></svg>', code: 'x', style });
      assert.ok(calls.images[0].includes('中文节点'));
    } finally { restore(); }
  });
});
