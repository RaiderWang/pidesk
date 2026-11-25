/* app/tool-target.js — display target for a running tool (Agent Hub, peer rail
   card, split peer pane).

   `raw(toolName, args)` picks the original target text; `of(toolName, args)`
   turns it into a one-line label: only a `path` is reduced to its last
   segment, commands / patterns / queries keep their text (a `command` such as
   `... 2>/dev/null` must never be cut at its last "/"). Whitespace is folded
   and the result is capped at MAX_LEN characters; the UI ellipsises further.
   Exposes: window.ToolTarget */
(function () {
  "use strict";

  const MAX_LEN = 200;
  const KEYS = ["path", "pattern", "command", "query"];

  const asArgs = (args) =>
    (typeof args === "object" && args !== null && !Array.isArray(args)) ? args : {};

  /** First non-blank of path/pattern/command/query (or the hub op), with its source key. */
  function pick(toolName, args) {
    const a = asArgs(args);
    for (const key of KEYS) {
      const v = a[key];
      if (v == null) continue;
      const s = String(v);
      if (s.trim()) return { key, value: s };
    }
    const op = a.op != null ? String(a.op).trim() : "";
    if (toolName === "hub" && op) {
      const ids = Array.isArray(a.ids) ? a.ids : [];
      return { key: "hub", value: `${op}${ids.length ? ` ${ids.join(", ")}` : ""}` };
    }
    return { key: "", value: "" };
  }

  /** Unfolded, untruncated original target ("" when none). */
  function raw(toolName, args) {
    return pick(toolName, args).value;
  }

  function basename(p) {
    const stripped = p.replace(/[\\/]+$/, "");
    if (!stripped) return p;
    return stripped.split(/[\\/]/).pop() || stripped;
  }

  /** One-line display label, at most MAX_LEN characters. */
  function of(toolName, args) {
    const { key, value } = pick(toolName, args);
    let s = key === "path" ? basename(value.trim()) : value;
    s = s.replace(/\s+/g, " ").trim();
    return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;
  }

  window.ToolTarget = { raw, of, MAX_LEN };
})();
