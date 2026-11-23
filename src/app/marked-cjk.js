/* ═════════════════════════════════════════════════════════════════════
   app/marked-cjk.js — CJK-friendly `*` / `**` emphasis for marked 12.

   CommonMark only lets a delimiter run open/close next to punctuation when
   the other side is whitespace or punctuation. CJK text has no spaces, so
   `一个**"foo"的教程**` or `**教程（一）**和**二**` leave literal asterisks
   or even mis-nest. This replaces marked's `emStrong` tokenizer for
   `*`-delimited runs when the text contains CJK, with two relaxations:

     open : next char is punctuation AND (prev is CJK OR next is CJK punct)
     close: prev char is punctuation AND (next is CJK OR prev is CJK punct)

   Everything else follows marked's own algorithm (delimTotal / rules 9-10,
   scanning `maskedSrc` so code spans, links and `\*` stay opaque). With the
   relaxations off it is output-identical to stock marked 12.0.2 (checked
   by differential fuzzing). `_` delimiters and CJK-free text fall back to
   the stock tokenizer (`return false`). "CJK in the text" means CJK in
   `src` or in the char just before the run.

   Characters inside `src` are read by code point (emoji count as \p{S}
   like stock). Known limit: marked passes `prevChar = raw.slice(-1)`, so a
   surrogate-pair character right before the run (CJK Ext-B+ or an emoji)
   arrives as a lone low surrogate and is neither CJK nor punctuation —
   same as stock marked.

   API: install(markedOrMarkedInstance) — idempotent; flank(prev, next).
   Browser: auto-installs on window.marked. Node/tests: module.exports only.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MarkedCjk = api;
    if (root.marked) api.install(root.marked);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STAR = 42; // "*"
  const WS = /\s/;
  const PUNCT = /[\p{P}\p{S}]/u;
  // Radicals, iteration marks (々〆〇), kana, bopomofo, Han, hangul, halfwidth
  // katakana. CJK punctuation lives in CJK_PUNCT below, not here.
  const CJK = /[\u2E80-\u2FDF\u3005-\u3007\u3040-\u30FF\u3100-\u312F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF66-\uFF9F]/;
  // CJK / fullwidth punctuation (curly quotes are deliberately excluded:
  // they are ordinary punctuation in non-CJK text too).
  const CJK_PUNCT = /[\u3001-\u303F\uFE10-\uFE1F\uFE30-\uFE4F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/;
  const HAS_CJK = new RegExp(CJK.source + "|" + CJK_PUNCT.source);

  // Stock marked never counts "*" as punctuation (this matters for runs like
  // `***`); "_" is punctuation here. Differential fuzzing against stock
  // 12.0.2 (relaxations off) showed no difference with exactly this rule.
  const isPunct = (c) => c !== "*" && PUNCT.test(c);

  // Whole code point starting at `i` ("" past the end). charAt() would hand
  // back a lone surrogate for emoji, which is never \p{P}/\p{S}.
  const charAfter = (s, i) => (i < s.length ? String.fromCodePoint(s.codePointAt(i)) : "");
  // Whole code point ending just before `i` ("" at the start).
  function charBefore(s, i) {
    if (i <= 0) return "";
    const lo = s.charCodeAt(i - 1);
    if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
      const hi = s.charCodeAt(i - 2);
      if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(i - 2, i);
    }
    return s.charAt(i - 1);
  }

  /** Flanking of a delimiter run between `prev` and `next` ("" = edge). */
  function flank(prev, next) {
    const prevWs = !prev || WS.test(prev);
    const nextWs = !next || WS.test(next);
    const prevPunct = !prevWs && isPunct(prev);
    const nextPunct = !nextWs && isPunct(next);
    let open = !nextWs && (!nextPunct || prevWs || prevPunct);
    let close = !prevWs && (!prevPunct || nextWs || nextPunct);
    if (!open && !nextWs && nextPunct && (CJK.test(prev) || CJK_PUNCT.test(next))) open = true;
    if (!close && !prevWs && prevPunct && (CJK.test(next) || CJK_PUNCT.test(prev))) close = true;
    return { open, close };
  }

  function emStrong(src, maskedSrc, prevChar = "") {
    // CJK before the run (`中文**"foo"**`) matters even when `src` is ASCII.
    if (src.charCodeAt(0) !== STAR || !(HAS_CJK.test(src) || CJK.test(prevChar))) return false;
    let lLength = 0;
    while (src.charCodeAt(lLength) === STAR) lLength++;
    if (!flank(prevChar, charAfter(src, lLength)).open) return undefined;

    // Same section of the masked text as `src`, past the opening run.
    const masked = maskedSrc.slice(maskedSrc.length - src.length + lLength);
    let delimTotal = lLength;
    let midDelimTotal = 0;
    let i = 0;
    while ((i = masked.indexOf("*", i)) !== -1) {
      let j = i;
      while (masked.charCodeAt(j) === STAR) j++;
      const rLength = j - i;
      const at = i;
      i = j;
      const f = flank(at ? charBefore(masked, at) : "*", charAfter(masked, j));
      if (!f.open && !f.close) continue;
      if (f.open && !f.close) {
        delimTotal += rLength; // nested left delimiter
        continue;
      }
      if (f.open && f.close && lLength % 3 && !((lLength + rLength) % 3)) {
        midDelimTotal += rLength; // CommonMark rules 9-10
        continue;
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue; // still need more closers
      const closeLen = Math.min(rLength, rLength + delimTotal + midDelimTotal);
      const raw = src.slice(0, lLength + at + closeLen);
      const strong = Math.min(lLength, closeLen) % 2 === 0;
      const text = raw.slice(strong ? 2 : 1, strong ? -2 : -1);
      return { type: strong ? "strong" : "em", raw, text, tokens: this.lexer.inlineTokens(text) };
    }
    return undefined;
  }

  const installed = new WeakSet();
  /** Register the tokenizer on `m` (the `marked` singleton or `new Marked()`). */
  function install(m) {
    if (!m || typeof m.use !== "function" || installed.has(m)) return m;
    installed.add(m);
    m.use({ tokenizer: { emStrong } });
    return m;
  }

  return { install, flank };
});
