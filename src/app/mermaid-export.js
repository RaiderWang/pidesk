/* ═════════════════════════════════════════════════════════════════════
   app/mermaid-export.js — rasterise a rendered Mermaid SVG to a PNG.

   Pure helpers (tested in Node): prepareSvg, layout, defaultFilename,
   needsPlainLabels. Browser side: toPngBase64, exportPng.

   - The SVG is loaded through an <img> whose parser is strict XML, but
     Mermaid emits HTML-serialised markup (`&nbsp;`, `<br>`): prepareSvg
     normalises that, then DOMParser pre-checks it for a readable error.
   - UTF-8 data URL (never `btoa`, which throws on CJK, never `blob:`).
   - WebKit (macOS WKWebView / WebKitGTK) taints a canvas that drew an SVG
     holding <foreignObject>, and may silently drop its text. There we go
     straight to MermaidRender.renderForExport (plain SVG labels); elsewhere
     the card's own svg is tried first and falls back on any failure.
   - Canvas background = the theme's `themeVariables.background`, the same
     colour as Mermaid's edge-label background.

   UMD: module.exports in Node, window.MermaidExport in browser.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MermaidExport = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SCALE = 2;
  const PADDING = 20; // logical px around the diagram
  const MAX_EDGE = 8192; // canvas px, padding included
  const MAX_PIXELS = 32 * 1024 * 1024;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";
  const PNG_PREFIX = "data:image/png;base64,";

  // HTML named entities XML does not define → numeric references.
  const ENTITIES = {
    nbsp: 160, copy: 169, reg: 174, middot: 183, laquo: 171, raquo: 187,
    times: 215, divide: 247, ndash: 8211, mdash: 8212, hellip: 8230,
    lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, bull: 8226,
    rarr: 8594, larr: 8592, harr: 8596, deg: 176, plusmn: 177,
  };
  const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

  // ── pure helpers ───────────────────────────────────────────────────

  // Make HTML-serialised Mermaid output safe for a strict XML parser.
  // Idempotent.
  function prepareSvg(svg) {
    let out = String(svg || "");
    out = out.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
      if (XML_ENTITIES.has(name)) return m;
      return Object.prototype.hasOwnProperty.call(ENTITIES, name)
        ? "&#" + ENTITIES[name] + ";"
        : "&amp;" + name + ";"; // unknown: show literally instead of failing
    });
    out = out.replace(/<(br|hr)\b([^>]*?)\s*\/?>/gi, "<$1$2/>");
    out = out.replace(/^([\s\S]*?<svg\b)([^>]*)(>[\s\S]*)$/, (_, head, attrs, tail) => {
      let a = attrs;
      if (!/\sxmlns=/.test(a)) a += ` xmlns="${SVG_NS}"`;
      if (/\bxlink:/.test(out) && !/\sxmlns:xlink=/.test(a)) a += ` xmlns:xlink="${XLINK_NS}"`;
      return head + a + tail;
    });
    return out;
  }

  // Intrinsic size from the root <svg> width/height (set by sizeSvg).
  function svgSize(svg) {
    const m = /<svg\b[^>]*>/.exec(String(svg || ""));
    if (!m) return null;
    const w = /\swidth="([\d.]+)(?:px)?"/.exec(m[0]);
    const h = /\sheight="([\d.]+)(?:px)?"/.exec(m[0]);
    if (!w || !h) return null;
    const out = { w: Number(w[1]), h: Number(h[1]) };
    return out.w > 0 && out.h > 0 ? out : null;
  }

  // Canvas geometry: diagram + padding, scaled up to `scale` but never past
  // maxEdge / maxPixels (padding counts toward both). null for bad input.
  function layout(w, h, opts) {
    const o = Object.assign({ scale: SCALE, padding: PADDING, maxEdge: MAX_EDGE, maxPixels: MAX_PIXELS }, opts);
    if (![w, h, o.scale, o.padding, o.maxEdge, o.maxPixels].every(Number.isFinite)) return null;
    if (!(w > 0 && h > 0 && o.scale > 0 && o.maxEdge > 0 && o.maxPixels > 0 && o.padding >= 0)) return null;
    const totalW = w + 2 * o.padding;
    const totalH = h + 2 * o.padding;
    const byEdge = o.maxEdge / Math.max(totalW, totalH);
    const byPixels = Math.sqrt(o.maxPixels / (totalW * totalH));
    const s = Math.min(o.scale, byEdge, byPixels);
    return {
      scale: s,
      width: Math.max(1, Math.floor(totalW * s)),
      height: Math.max(1, Math.floor(totalH * s)),
      x: o.padding * s,
      y: o.padding * s,
      drawW: w * s,
      drawH: h * s,
    };
  }

  function defaultFilename(now) {
    const d = now instanceof Date ? now : new Date();
    const p = (n) => String(n).padStart(2, "0");
    return (
      `diagram-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
      `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`
    );
  }

  // Safari / WKWebView / WebKitGTK identify as AppleWebKit without a
  // Chrome/Chromium/Edg token; those taint canvases on <foreignObject>.
  function needsPlainLabels(ua) {
    const s = String(ua || "");
    return /AppleWebKit/.test(s) && !/Chrome|Chromium|Edg\//.test(s);
  }

  // ── browser side ───────────────────────────────────────────────────

  function validateXml(svg) {
    if (typeof root.DOMParser !== "function") return null;
    const doc = new root.DOMParser().parseFromString(svg, "image/svg+xml");
    const bad = doc.getElementsByTagName("parsererror")[0];
    return bad ? String(bad.textContent || "invalid svg").trim().slice(0, 200) : null;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new root.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("svg could not be loaded as an image"));
      img.src = src;
    });
  }

  // → base64 PNG (no data: prefix). Throws on invalid svg, a tainted canvas
  // (SecurityError) or a canvas the browser refused to encode.
  async function toPngBase64(svg, bg) {
    const prepared = prepareSvg(svg);
    const bad = validateXml(prepared);
    if (bad) throw new Error("invalid svg: " + bad);
    const size = svgSize(prepared);
    const geo = size && layout(size.w, size.h);
    if (!geo) throw new Error("diagram has no usable size");
    const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(prepared));
    const canvas = root.document.createElement("canvas");
    canvas.width = geo.width;
    canvas.height = geo.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, geo.width, geo.height);
    ctx.drawImage(img, geo.x, geo.y, geo.drawW, geo.drawH);
    const url = canvas.toDataURL("image/png");
    if (!url.startsWith(PNG_PREFIX) || url.length <= PNG_PREFIX.length) {
      throw new Error("canvas could not be encoded");
    }
    return url.slice(PNG_PREFIX.length);
  }

  // { svg, code, style: { theme, accent } } → base64 PNG.
  async function exportPng({ svg, code, style }) {
    const bg = root.MermaidTheme.variables(style.theme, style.accent).themeVariables.background;
    const viaPlain = async () => {
      const r = await root.MermaidRender.renderForExport(code, style);
      if (!r.ok) throw new Error(r.error || "export render failed");
      return toPngBase64(r.svg, bg);
    };
    const ua = root.navigator && root.navigator.userAgent;
    if (needsPlainLabels(ua)) return viaPlain();
    try {
      return await toPngBase64(svg, bg);
    } catch (_) {
      return viaPlain();
    }
  }

  return {
    prepareSvg, svgSize, layout, defaultFilename, needsPlainLabels,
    toPngBase64, exportPng,
    _constants: { SCALE, PADDING, MAX_EDGE, MAX_PIXELS },
  };
});
