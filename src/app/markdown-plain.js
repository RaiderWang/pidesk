/* ═════════════════════════════════════════════════════════════════════
   app/markdown-plain.js — Markdown → plain text for "copy as plain text".

   Pure logic (UMD, same shape as markdown-segments.js). Walks the tokens
   from `marked.lexer` instead of parsing rendered HTML, so it needs no DOM
   and behaves the same on WebView2 and WKWebView.

   API: toPlainText(md, markedInstance?)  → string
     `markedInstance` defaults to the global `marked` only when omitted
     (explicit `null` = no marked). Non-string input → "";
     no marked / lexer failure → the original text, untouched.

   marked 12 escaping (verified against the vendored build):
     ESCAPED (decode): inline `text`, `codespan`, `escape`, `image.text`.
     NOT escaped (keep literal): block `code.text`, `link.href`, raw `html`.
   Entities are decoded in a single pass so `&amp;lt;` stays `&lt;`.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MarkdownPlain = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  const BR = /<br\s*\/?>/gi;
  const COMMENT = /<!--[\s\S]*?-->/g;
  const TAG = /<\/?[a-zA-Z][^>]*>/g;

  function unescapeHtml(s) {
    return String(s ?? "").replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
  }

  // Raw HTML fragment → text. `<br>` becomes `brText`, comments and tags vanish.
  function stripHtml(html, brText) {
    return String(html ?? "").replace(COMMENT, "").replace(BR, brText).replace(TAG, "");
  }

  function linkText(tok, opts) {
    const label = inline(tok.tokens, opts);
    const href = tok.href || "";
    if (!label) return href;
    if (!href || label === href || `mailto:${label}` === href) return label;
    return `${label} (${href})`;
  }

  function inlineToken(tok, opts) {
    switch (tok.type) {
      case "escape":
      case "codespan":
      case "image":
        return unescapeHtml(tok.text);
      case "link":
        return linkText(tok, opts);
      case "br":
        return opts.br;
      case "html":
        return stripHtml(tok.text, opts.br);
      default:
        return tok.tokens ? inline(tok.tokens, opts) : unescapeHtml(tok.text);
    }
  }

  function inline(tokens, opts) {
    return (tokens || []).map((t) => inlineToken(t, opts)).join("");
  }

  const PARA = { br: "\n" };
  const CELL = { br: " " };

  function indentBlock(text, pad) {
    return text.split("\n").map((l, i) => (i === 0 || !l ? l : pad + l)).join("\n");
  }

  function listItem(item, marker) {
    const body = blockParts(item.tokens || []).join("\n");
    const task = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
    return marker + indentBlock(task + body, " ".repeat(marker.length));
  }

  function list(tok) {
    const first = Number.isFinite(Number(tok.start)) && tok.start !== "" ? Number(tok.start) : 1;
    return (tok.items || [])
      .map((item, i) => listItem(item, tok.ordered ? `${first + i}. ` : "- "))
      .join("\n");
  }

  function table(tok) {
    const row = (cells) => cells.map((c) => inline(c.tokens, CELL)).join("\t");
    return [row(tok.header || []), ...(tok.rows || []).map(row)].join("\n");
  }

  function blockToken(tok) {
    switch (tok.type) {
      case "space":
      case "hr":
      case "def":
        return null;
      case "code":
        return tok.text;
      case "blockquote":
        return blockParts(tok.tokens || []).join("\n\n");
      case "list":
        return list(tok);
      case "table":
        return table(tok);
      case "html":
        return stripHtml(tok.text, "\n").trim() || null;
      default:
        return tok.tokens ? inline(tok.tokens, PARA) : unescapeHtml(tok.text);
    }
  }

  // Top-level blocks of a token list; empty ones are dropped.
  function blockParts(tokens) {
    const out = [];
    for (const tok of tokens) {
      const s = blockToken(tok);
      if (s) out.push(s);
    }
    return out;
  }

  function toPlainText(md, markedInstance) {
    if (typeof md !== "string") return "";
    // Only an omitted argument falls back to the global; an explicit null means "no marked".
    const m = markedInstance !== undefined
      ? markedInstance
      : (typeof globalThis !== "undefined" ? globalThis.marked : null);
    if (!m || typeof m.lexer !== "function") return md;
    let tokens;
    try {
      tokens = m.lexer(md);
    } catch {
      return md;
    }
    // `hr`/`space` tokens yield no block, so blocks are already separated by
    // exactly one blank line; no 3+ newline collapsing (it would mangle code).
    return blockParts(tokens)
      .join("\n\n")
      .replace(/^(?:[ \t]*\n)+/, "")
      .trimEnd();
  }

  return { toPlainText, unescapeHtml };
});
