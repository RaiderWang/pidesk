/* ═════════════════════════════════════════════════════════════════════
   branch-session.js — pure logic for "branch from this message".

   Maps a UI bubble to the omp session entry that backs it, so the Rust side
   can cut the session file at a stable entry id instead of a message count.

   Why not a count: `state.messages` is head-trimmed (`_trimMessages`, 169
   cap) and the file stores toolResult/developer rows as "message" events, so
   "Nth user/assistant bubble from the start" does not line up with the file.
   The newest bubbles always do — count from the end and verify every bubble
   from the target to the end (strict, whitespace-insensitive). Any mismatch
   → `null`; the caller must refuse to branch rather than guess.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BranchSession = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function contentBlocks(content) {
    if (typeof content === "string") return [{ type: "text", text: content }];
    return Array.isArray(content) ? content : [];
  }

  function joinBlocks(content, type, field) {
    return contentBlocks(content)
      .filter((b) => b && b.type === type)
      .map((b) => b[field] ?? "")
      .join("");
  }

  /** Whitespace-insensitive: UI joins text blocks with "\n", omp with "". */
  function textKey(text) {
    return String(text ?? "").replace(/\s+/g, "");
  }

  /** Comparable identity of a stored message entry; "" when it has no bubble. */
  function entryKey(entry) {
    const m = entry?.message;
    if (entry?.type !== "message" || !m) return "";
    if (m.role === "user") {
      const text = textKey(joinBlocks(m.content, "text", "text"));
      const image = contentBlocks(m.content).some((b) => b && b.type === "image");
      return text || image ? `u|${text}|${image ? 1 : 0}` : "";
    }
    if (m.role === "assistant") {
      const text = textKey(joinBlocks(m.content, "text", "text"));
      if (text) return `a|${text}`;
      const thought = textKey(joinBlocks(m.content, "thinking", "thinking"));
      return thought ? `t|${thought}` : ""; // tool-call-only turns have no bubble
    }
    return "";
  }

  /** Comparable identity of a UI bubble; "" for non-text / empty bubbles. */
  function bubbleKey(msg) {
    if (msg?.kind === "user") {
      const text = textKey(msg.text);
      const image = (msg.images?.length ?? 0) > 0;
      return text || image ? `u|${text}|${image ? 1 : 0}` : "";
    }
    if (msg?.kind === "assistant") {
      if (msg.notice) return ""; // client-side notice: not in the session file
      const text = textKey(
        (msg.blocks ?? [])
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join(""),
      );
      if (text) return `a|${text}`;
      const thought = textKey(msg.thought);
      return thought ? `t|${thought}` : "";
    }
    return "";
  }

  /** Message entries (with a bubble) on the leaf → root chain, root-first. */
  function activeBubbleEntries(entries, leafId) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const byId = new Map();
    for (const e of entries) if (e && e.id != null) byId.set(e.id, e);

    let cursor = leafId != null && byId.has(leafId) ? leafId : entries[entries.length - 1]?.id;
    const path = [];
    const seen = new Set();
    while (cursor != null && byId.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      const e = byId.get(cursor);
      path.push(e);
      cursor = e.parentId ?? null;
    }
    path.reverse();
    return path.filter((e) => entryKey(e) !== "");
  }

  /**
   * Entry id backing the UI bubble at `uiIdx` (a user or assistant bubble),
   * or `null` when it cannot be located with certainty.
   */
  function resolveTarget(uiMessages, uiIdx, entries, leafId) {
    if (!Array.isArray(uiMessages) || !Number.isInteger(uiIdx)) return null;
    const target = uiMessages[uiIdx];
    if (!target || bubbleKey(target) === "") return null;

    const chain = activeBubbleEntries(entries, leafId);
    const tail = [];
    for (let i = uiIdx; i < uiMessages.length; i++) {
      const key = bubbleKey(uiMessages[i]);
      if (key !== "") tail.push(key);
    }
    if (tail.length === 0 || tail.length > chain.length) return null;

    const first = chain.length - tail.length;
    for (let i = 0; i < tail.length; i++) {
      if (entryKey(chain[first + i]) !== tail[i]) return null;
    }
    return chain[first].id ?? null;
  }

  /**
   * Session file to fork from. `sessions` is the saved-session scan
   * (`{ id, path }`, newest first). Prefers the file omp reports it is
   * writing (path, then session id); the newest scan entry is only a last
   * resort for tabs that have not reported a file yet.
   */
  function pickSourcePath(sessions, activePath, activeId) {
    const list = Array.isArray(sessions) ? sessions : [];
    const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
    if (activePath) {
      const byPath = list.find((s) => norm(s.path) === norm(activePath));
      if (byPath) return byPath.path;
    }
    if (activeId) {
      const byId = list.find((s) => s.id === activeId);
      if (byId) return byId.path;
    }
    if (activePath) return activePath;
    return list[0]?.path ?? null;
  }

  return { entryKey, bubbleKey, activeBubbleEntries, resolveTarget, pickSourcePath };
});
