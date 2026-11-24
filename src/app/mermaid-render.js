/* ═════════════════════════════════════════════════════════════════════
   app/mermaid-render.js — lazy, serialised, cached Mermaid → SVG.

   - `mermaid.min.js` (vendored single-file UMD) is injected on first use
     only; it is never loaded for chats without diagrams.
   - `initialize()` mutates library-global config, so every job runs
     `initialize + render` inside one Promise queue (no cross-theme bleed).
   - The cache keeps pure SVG (no UI copy). Each render handed to a card
     gets a fresh id prefix (`remapIds`) so two identical diagrams on one
     page never share `<svg id>`, `marker id` or `url(#…)` targets.
   - Failures never leak: with `suppressErrorRendering` Mermaid throws
     instead of appending an error SVG to <body>; leftovers are removed.

   API: render(code, { theme, accent }) → Promise<{ ok, svg } | { ok:false, error, tooLarge? }>
   Pure helpers (tested): remapIds, sizeSvg, createCache.
   UMD: module.exports in Node, window.MermaidRender in browser.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MermaidRender = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SCRIPT_SRC = "mermaid.min.js";
  const MAX_TEXT = 20000;
  const MAX_EDGES = 300;
  const CACHE_MAX = 64;
  const ID_PREFIX = "pidesk-mmd-";

  // ── pure helpers ───────────────────────────────────────────────────

  // Replace every occurrence of the render id (svg id, <style> selectors,
  // marker ids, url(#…) references) with a new one.
  function remapIds(svg, fromId, toId) {
    if (!fromId || fromId === toId) return svg;
    return svg.split(fromId).join(toId);
  }

  // Mermaid emits width="100%" + style="max-width: Npx". Replace that with
  // the diagram's natural size (from viewBox) so wide charts scroll
  // horizontally instead of shrinking to unreadable text.
  function sizeSvg(svg) {
    const m = /^([\s\S]*?<svg\b)([^>]*)(>[\s\S]*)$/.exec(svg);
    if (!m) return svg;
    let attrs = m[2];
    const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(attrs);
    if (!vb) return svg;
    const w = Math.ceil(Number(vb[1]));
    const h = Math.ceil(Number(vb[2]));
    if (!(w > 0 && h > 0)) return svg;
    attrs = attrs
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace(/max-width:\s*[\d.]+px;?/, "");
    attrs = attrs.replace(/\sstyle="\s*"/, "");
    return m[1] + attrs + ` width="${w}" height="${h}"` + m[3];
  }

  // Tiny LRU (Map keeps insertion order).
  function createCache(max) {
    const map = new Map();
    return {
      get(key) {
        if (!map.has(key)) return undefined;
        const v = map.get(key);
        map.delete(key);
        map.set(key, v);
        return v;
      },
      set(key, value) {
        map.delete(key);
        map.set(key, value);
        if (map.size > max) map.delete(map.keys().next().value);
      },
      get size() { return map.size; },
    };
  }

  // ── runtime ────────────────────────────────────────────────────────

  const cache = createCache(CACHE_MAX);
  const inflight = new Map();
  let counter = 0;
  let queue = Promise.resolve();
  let loading = null;

  function nextId() {
    counter += 1;
    return ID_PREFIX + counter;
  }

  function load() {
    if (root.mermaid) return Promise.resolve(root.mermaid);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const el = root.document.createElement("script");
      el.src = SCRIPT_SRC;
      el.onload = () => (root.mermaid ? resolve(root.mermaid) : reject(new Error("mermaid global missing")));
      el.onerror = () => reject(new Error("failed to load mermaid"));
      root.document.head.appendChild(el);
    }).catch((err) => {
      loading = null; // allow a retry on the next diagram
      throw err;
    });
    return loading;
  }

  // Mermaid parks a temp `d<id>` node (and, on errors, stray svgs) in <body>.
  function cleanupOrphans(id) {
    const doc = root.document;
    if (!doc) return;
    for (const sel of ["#d" + id, "#" + id]) {
      const el = doc.querySelector(sel);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  async function renderJob(code, style) {
    const mermaid = await load();
    const theme = root.MermaidTheme.variables(style.theme, style.accent);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: MAX_TEXT,
      maxEdges: MAX_EDGES,
      theme: theme.theme,
      themeVariables: theme.themeVariables,
      flowchart: { htmlLabels: true, useMaxWidth: false },
    });
    const id = nextId();
    try {
      const out = await mermaid.render(id, code);
      return { svg: sizeSvg(out.svg), id };
    } finally {
      cleanupOrphans(id);
    }
  }

  function render(code, style) {
    const src = String(code || "").trim();
    if (!src) return Promise.resolve({ ok: false, error: "empty" });
    if (src.length > MAX_TEXT) return Promise.resolve({ ok: false, error: "too large", tooLarge: true });
    const key = root.MermaidTheme.styleKey(style.theme, style.accent) + "\u0000" + src;

    const finish = (r) => ({ ok: true, svg: remapIds(r.svg, r.id, nextId()) });
    const fail = (err) => ({ ok: false, error: String((err && err.message) || err) });

    const hit = cache.get(key);
    if (hit) return Promise.resolve(finish(hit));
    if (inflight.has(key)) return inflight.get(key).then(finish, fail);

    const job = queue.then(() => renderJob(src, style));
    queue = job.catch(() => {}); // a failed job must not poison the queue
    inflight.set(key, job);
    const settled = () => inflight.delete(key);
    job.then(settled, settled);
    job.then((r) => cache.set(key, r), () => {});
    return job.then(finish, fail);
  }

  return { render, remapIds, sizeSvg, createCache, _constants: { MAX_TEXT, MAX_EDGES } };
});
