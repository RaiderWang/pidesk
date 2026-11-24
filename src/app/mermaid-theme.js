/* ═════════════════════════════════════════════════════════════════════
   app/mermaid-theme.js — Mermaid `themeVariables` for PiDesk's 4 themes.

   Mermaid parses theme colours with khroma (darken/lighten/…), so values
   must be concrete hex — never `var(--x)` or `color-mix(...)`. Each PiDesk
   theme therefore has a static hex palette (mirrors design/styles.css);
   node/cluster tints are derived from the current accent (`--accent`,
   always a hex — see appearance.js).

   API:
     THEMES                         → ["aurora","phosphor","daylight","clarity"]
     resolveTheme(className)        → theme name from <html> class string
     variables(theme, accent)       → { theme: "base", themeVariables }
     styleKey(theme, accent)        → cache-key fragment
     current()                      → { theme, accent } read from <html>
   UMD: module.exports in Node (tests), window.MermaidTheme in browser.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MermaidTheme = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const THEMES = ["aurora", "phosphor", "daylight", "clarity"];
  const DEFAULT_THEME = "daylight";
  const HEX6 = /^#[0-9a-f]{6}$/i;

  // bg = card background, surface = node base, fg/fg2 = text, line = edges,
  // border = cluster borders. Values mirror design/styles.css.
  const PALETTES = {
    daylight: { dark: false, bg: "#F6F3EB", surface: "#FFFFFF", fg: "#14181F", fg2: "#34394A", line: "#5E6478", border: "#C7BEA8" },
    clarity:  { dark: false, bg: "#F8F9FA", surface: "#FFFFFF", fg: "#111827", fg2: "#374151", line: "#6B7280", border: "#CED4DA" },
    aurora:   { dark: true,  bg: "#1e2025", surface: "#25282e", fg: "#F0F2F7", fg2: "#C5CAD6", line: "#8A92A3", border: "#444957" },
    phosphor: { dark: true,  bg: "#2b302e", surface: "#333936", fg: "#D2F8B8", fg2: "#A0E878", line: "#78B868", border: "#525c57" },
  };
  const FALLBACK_ACCENT = { daylight: "#1F8A5B", clarity: "#2563EB", aurora: "#78E8BE", phosphor: "#39E557" };
  const FONT = '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

  function toRgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  // Linear blend of two #rrggbb colours: t=0 → a, t=1 → b.
  function mix(a, b, t) {
    const ra = toRgb(a);
    const rb = toRgb(b);
    const out = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
    return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function resolveTheme(className) {
    const m = /(?:^|\s)theme-(aurora|phosphor|daylight|clarity)(?:\s|$)/.exec(String(className || ""));
    return m ? m[1] : DEFAULT_THEME;
  }

  function normalizeAccent(theme, accent) {
    return HEX6.test(accent || "") ? String(accent).toLowerCase() : FALLBACK_ACCENT[theme].toLowerCase();
  }

  function variables(theme, accent) {
    const name = THEMES.includes(theme) ? theme : DEFAULT_THEME;
    const p = PALETTES[name];
    const acc = normalizeAccent(name, accent);
    const node = mix(p.surface, acc, p.dark ? 0.22 : 0.12);
    const cluster = mix(p.bg, p.fg, p.dark ? 0.06 : 0.04);
    return {
      theme: "base",
      themeVariables: {
        darkMode: p.dark,
        fontFamily: FONT,
        background: p.bg,
        primaryColor: node,
        primaryTextColor: p.fg,
        primaryBorderColor: mix(p.surface, acc, 0.65),
        secondaryColor: mix(p.surface, acc, 0.1),
        secondaryTextColor: p.fg,
        tertiaryColor: cluster,
        tertiaryTextColor: p.fg,
        textColor: p.fg,
        titleColor: p.fg,
        lineColor: p.line,
        mainBkg: node,
        nodeBorder: mix(p.surface, acc, 0.65),
        nodeTextColor: p.fg,
        clusterBkg: cluster,
        clusterBorder: p.border,
        edgeLabelBackground: p.bg,
        noteBkgColor: mix(p.surface, acc, 0.08),
        noteTextColor: p.fg2,
        noteBorderColor: p.border,
      },
    };
  }

  function styleKey(theme, accent) {
    const name = THEMES.includes(theme) ? theme : DEFAULT_THEME;
    return name + "|" + normalizeAccent(name, accent);
  }

  function current() {
    const el = typeof document !== "undefined" ? document.documentElement : null;
    if (!el) return { theme: DEFAULT_THEME, accent: FALLBACK_ACCENT[DEFAULT_THEME] };
    const theme = resolveTheme(el.className);
    const accent = (el.style.getPropertyValue("--accent") || "").trim();
    return { theme, accent: normalizeAccent(theme, accent) };
  }

  return { THEMES, resolveTheme, variables, styleKey, current, mix };
});
