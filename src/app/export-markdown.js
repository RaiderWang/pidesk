/* ═════════════════════════════════════════════════════════════════════
   app/export-markdown.js — session entries → Markdown transcript.

   Pure logic (UMD, same shape as markdown-plain.js). Input is the payload of
   the omp `get_entries` RPC (`entries` + `leafId`), never the UI list: the UI
   list is head-trimmed and carries client-side notices.

   Only the conversation itself is exported: user text and assistant text.
   Thinking, tool calls/results, developer/fileMention rows, compaction and
   every other entry type are dropped.

   API:
     buildBranch(entries, leafId)              → entry[] (root → leaf)
     toMarkdown(entries, leafId, labels?, opts?) → string ("" = nothing to export)
       labels: { user, assistant, image }   (defaults are English)
       opts:   { stripPlanFraming(text) → { text } }  (defaults to window.UndoMessage)

   Rules: the active branch only; blank text blocks are dropped and the rest
   joined with a blank line; image-only user turns keep an image placeholder;
   consecutive assistant turns (separated only by tool rows) merge into one
   section; PiDesk's plan-mode framing is stripped; role headings are `# `
   with no `---` rules (model text already uses both); a dangling code fence
   is closed so it cannot swallow the next heading.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ExportMarkdown = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_LABELS = { user: "User", assistant: "Assistant", image: "[Image]" };
  const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/;

  /** Active branch, root → leaf. Unknown/null `leafId` falls back to the last entry; cycles terminate. */
  function buildBranch(entries, leafId) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const byId = new Map();
    for (const e of entries) {
      if (e && typeof e.id === "string") byId.set(e.id, e);
    }
    let cur = (typeof leafId === "string" && byId.get(leafId)) || entries[entries.length - 1];
    const path = [];
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = typeof cur.parentId === "string" ? byId.get(cur.parentId) : null;
    }
    return path.reverse();
  }

  /** Close an unterminated fenced block so later headings stay headings. */
  function closeDanglingFence(text) {
    let open = null;
    for (const line of text.split("\n")) {
      const m = FENCE_RE.exec(line);
      if (!m) continue;
      const mark = m[1];
      if (!open) {
        // CommonMark: a backtick fence's info string cannot contain a backtick,
        // so "```code``` text" is inline code, not an opening fence.
        if (mark[0] === "`" && m[2].includes("`")) continue;
        open = { ch: mark[0], len: mark.length };
      } else if (mark[0] === open.ch && mark.length >= open.len && m[2].trim() === "") {
        open = null;
      }
    }
    return open ? `${text}\n${open.ch.repeat(open.len)}` : text;
  }

  function blocksOf(content) {
    if (typeof content === "string") return [{ type: "text", text: content }];
    return Array.isArray(content) ? content.filter(Boolean) : [];
  }

  /** LF line endings, no leading blank lines (the first line's indentation is kept: it can be an indented code block) and no trailing whitespace. */
  function tidy(text) {
    return text.replace(/\r\n?/g, "\n").replace(LEADING_BLANK_LINES, "").trimEnd();
  }

  function textOf(blocks) {
    return blocks
      .filter((b) => b.type === "text" && typeof b.text === "string" && b.text.trim() !== "")
      .map((b) => tidy(b.text))
      .join("\n\n");
  }

  function defaultStrip(text) {
    const um = typeof globalThis !== "undefined" ? globalThis.UndoMessage : null;
    if (um && typeof um.stripPlanFraming === "function") {
      try {
        const r = um.stripPlanFraming(text);
        if (r && typeof r.text === "string") return r;
      } catch (_) { /* keep original */ }
    }
    return { text };
  }

  function toMarkdown(entries, leafId, labels, opts) {
    const L = { ...DEFAULT_LABELS, ...(labels || {}) };
    const strip = (opts && opts.stripPlanFraming) || defaultStrip;
    const sections = [];

    for (const e of buildBranch(entries, leafId)) {
      const msg = e && e.type === "message" ? e.message : null;
      if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
      const blocks = blocksOf(msg.content);
      let body = textOf(blocks);

      if (msg.role === "user") {
        if (body) body = tidy(strip(body).text);
        const images = blocks.filter((b) => b.type === "image").map(() => L.image);
        body = [body, ...images].filter(Boolean).join("\n\n");
        if (!body) continue;
        sections.push({ role: "user", parts: [body] });
        continue;
      }

      if (!body) continue;
      const last = sections[sections.length - 1];
      if (last && last.role === "assistant") last.parts.push(body);
      else sections.push({ role: "assistant", parts: [body] });
    }

    if (sections.length === 0) return "";
    const out = sections.map((s) => {
      const text = s.parts.map(closeDanglingFence).join("\n\n");
      return `# ${s.role === "user" ? L.user : L.assistant}\n\n${text}`;
    });
    return `${out.join("\n\n")}\n`;
  }

  return { buildBranch, toMarkdown, closeDanglingFence };
});
