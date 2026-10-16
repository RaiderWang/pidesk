/* ═════════════════════════════════════════════════════════════════════
   app/file-mention.js — pure helpers for "@path" file references.
   omp auto-reads "@path" tokens found in a prompt (utils/file-mentions.ts);
   the rules below mirror its regex / boundary handling so the UI renders
   exactly what omp will treat as a file reference.

   formatMention(rel)         -> "@rel" (quoted when the path has whitespace)
   buildMessage(files, text)  -> final prompt text (chips + body)
   splitMentions(text)        -> [{ type: "text"|"mention", value, path? }]
   findAtQuery(text, caret)   -> { start, end, query } | null  (autocomplete)
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FileMention = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Same pattern omp uses; a fresh RegExp per call avoids shared lastIndex.
  const MENTION_SRC = "@(?:\"([^\"]+)\"|'([^']+)'|([^\\s@]+))";
  const BOUNDARY_RE = /[\s([{<"'`]/;
  const LEADING_RE = /^[`"'([{<]+/;
  const TRAILING_RE = /[)\]}>.,;:!?"'`]+$/;
  const WHITESPACE_RE = /\s/;

  function normalizePath(p) {
    return String(p || "").trim().replace(/\\/g, "/");
  }

  function formatMention(rel) {
    const p = normalizePath(rel);
    if (!p) return "";
    if (!WHITESPACE_RE.test(p)) return `@${p}`;
    if (!p.includes('"')) return `@"${p}"`;
    if (!p.includes("'")) return `@'${p}'`;
    return `@${p}`;
  }

  /**
   * Chips go in front of the body so the agent reads them first — except for
   * slash-commands, which omp only recognises at the very start of the prompt.
   */
  function buildMessage(files, text) {
    const body = String(text || "").trim();
    const tokens = (files || []).map(formatMention).filter(Boolean).join(" ");
    if (!tokens) return body;
    if (!body) return tokens;
    return body.startsWith("/") ? `${body} ${tokens}` : `${tokens} ${body}`;
  }

  // Unquoted tokens count as file references only when they look like paths
  // ("@alice" stays prose); quoted tokens are always explicit references.
  function looksLikePath(p) {
    return /[\\/]/.test(p) || /\.\w{1,10}$/.test(p);
  }

  function splitMentions(text) {
    const src = String(text || "");
    const out = [];
    let cursor = 0;
    const pushText = (end) => {
      if (end > cursor) out.push({ type: "text", value: src.slice(cursor, end) });
    };

    for (const m of src.matchAll(new RegExp(MENTION_SRC, "g"))) {
      const index = m.index ?? 0;
      if (index < cursor) continue;
      if (index > 0 && !BOUNDARY_RE.test(src[index - 1])) continue;

      let path;
      let consumed;
      if (m[1] !== undefined || m[2] !== undefined) {
        path = (m[1] ?? m[2]).trim();
        consumed = m[0].length;
      } else {
        const raw = m[3];
        const lead = raw.length - raw.replace(LEADING_RE, "").length;
        path = raw.slice(lead).replace(TRAILING_RE, "").trim();
        if (!path || !looksLikePath(path)) continue;
        consumed = 1 + lead + path.length; // trailing punctuation stays prose
      }
      if (!path) continue;

      pushText(index);
      out.push({ type: "mention", value: src.slice(index, index + consumed), path });
      cursor = index + consumed;
    }
    pushText(src.length);
    return out;
  }

  /**
   * Autocomplete state for the token under the caret. `start`..`end` is the
   * whole "@token" range (end extends past the caret to the next whitespace)
   * so a selection can replace it in one splice.
   */
  function findAtQuery(text, caret) {
    const src = String(text || "");
    const pos = Math.max(0, Math.min(caret ?? src.length, src.length));
    let i = pos - 1;
    while (i >= 0 && !WHITESPACE_RE.test(src[i]) && src[i] !== "@") i--;
    if (i < 0 || src[i] !== "@") return null;
    if (i > 0 && !BOUNDARY_RE.test(src[i - 1])) return null;
    const query = src.slice(i + 1, pos);
    if (query.includes('"') || query.includes("'")) return null;
    let end = pos;
    while (end < src.length && !WHITESPACE_RE.test(src[end])) end++;
    return { start: i, end, query };
  }

  /** Replace the "@token" range with `replacement` (may be empty). */
  function replaceRange(text, start, end, replacement) {
    const src = String(text || "");
    const before = src.slice(0, start);
    const after = src.slice(end);
    // Collapse the double space left behind when a mention is removed mid-text.
    if (!replacement && before.endsWith(" ") && after.startsWith(" ")) {
      return before + after.slice(1);
    }
    return before + (replacement || "") + after;
  }

  return { formatMention, buildMessage, splitMentions, findAtQuery, replaceRange, normalizePath };
});
