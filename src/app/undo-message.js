/* ═════════════════════════════════════════════════════════════════════
   undo-message.js — pure logic for "undo a sent message".
   Maps a UI user bubble to the omp session entry that backs it, so the
   bridge can call the native `branch` RPC. No side effects; loaded as a
   plain script (exposes window.UndoMessage) and testable under node.

   Why tail alignment: `state.messages` is head-trimmed (_trimMessages) and
   omp's compaction drops older turns from get_messages, so counting user
   bubbles "from the start" does not line up with the session file. The
   newest user bubbles always do — count from the end and verify the text.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.UndoMessage = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FRAMING_LOCALES = ["en", "zh-CN"];
  const FRAMING_MARK = "\u0000";

  function contentBlocks(content) {
    if (typeof content === "string") return [{ type: "text", text: content }];
    return Array.isArray(content) ? content : [];
  }

  /** Text of a stored user message, joined the way omp does (no separator). */
  function entryText(entry) {
    return contentBlocks(entry?.message?.content)
      .filter((b) => b && b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }

  function entryHasImage(entry) {
    return contentBlocks(entry?.message?.content).some((b) => b && b.type === "image");
  }

  /** Whitespace-insensitive key: UI joins text blocks with "\n", omp with "". */
  function textKey(text) {
    return String(text ?? "").replace(/\s+/g, "");
  }

  /**
   * User-message entries on the active branch (leaf → root), root-first.
   * Entries without text and images are skipped (they have no UI bubble).
   */
  function activeUserEntries(entries, leafId) {
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

    return path.filter(
      (e) =>
        e.type === "message" &&
        e.message?.role === "user" &&
        (textKey(entryText(e)) !== "" || entryHasImage(e)),
    );
  }

  /**
   * Resolve the session entry for the UI bubble at `uiIdx`.
   * Returns `{ entryId, text }` or `null` when the bubble cannot be located
   * with certainty (never guess — the branch RPC is destructive).
   */
  function resolveTarget(uiMessages, uiIdx, userEntries) {
    if (!Array.isArray(uiMessages) || !Array.isArray(userEntries)) return null;
    const target = uiMessages[uiIdx];
    if (!target || target.kind !== "user") return null;

    const tail = [];
    for (let i = uiIdx; i < uiMessages.length; i++) {
      if (uiMessages[i]?.kind === "user") tail.push(uiMessages[i]);
    }
    if (tail.length === 0 || tail.length > userEntries.length) return null;

    const firstEntry = userEntries.length - tail.length;
    for (let i = 0; i < tail.length; i++) {
      const entry = userEntries[firstEntry + i];
      if (textKey(tail[i].text) !== textKey(entryText(entry))) return null;
      if (!!tail[i].images?.length !== entryHasImage(entry)) return null;
    }
    const entry = userEntries[firstEntry];
    return { entryId: entry.id, text: entryText(entry) };
  }

  /**
   * What an undo at `uiIdx` will clear (for the confirmation dialog).
   * Note: in a live session finished tool cards are ephemeral and absent from
   * the message list while idle, so `tools` is effectively 0 there; it only
   * counts cards that are still in the list (e.g. restored/mock data).
   */
  function countAffected(uiMessages, uiIdx) {
    let messages = 0;
    let tools = 0;
    if (!Array.isArray(uiMessages)) return { messages, tools };
    for (let i = uiIdx + 1; i < uiMessages.length; i++) {
      const k = uiMessages[i]?.kind;
      if (uiMessages[i]?.notice) continue; // client-side notice, not a session message
      if (k === "user" || k === "assistant") messages++;
      else if (k === "tool") tools++;
    }
    return { messages, tools };
  }

  /**
   * Plan mode wraps the first send in the localized intent framing. Strip it
   * (for every locale — it may have been sent under another one) so the
   * composer gets the user's own words back.
   */
  function stripPlanFraming(text, tFn) {
    const src = typeof text === "string" ? text : "";
    const translate = tFn || (typeof window !== "undefined" ? window.t : null);
    if (typeof translate !== "function") return { text: src, stripped: false };
    for (const loc of FRAMING_LOCALES) {
      const tpl = translate("plan.intentFraming", { intent: FRAMING_MARK }, undefined, loc);
      const at = typeof tpl === "string" ? tpl.indexOf(FRAMING_MARK) : -1;
      if (at <= 0) continue;
      const prefix = tpl.slice(0, at);
      const suffix = tpl.slice(at + FRAMING_MARK.length);
      if (src.startsWith(prefix) && src.endsWith(suffix) && src.length >= prefix.length + suffix.length) {
        return { text: src.slice(prefix.length, src.length - suffix.length), stripped: true };
      }
    }
    return { text: src, stripped: false };
  }

  /** UI/RPC image blocks → the composer's attachment shape. */
  function toComposerImages(images) {
    if (!Array.isArray(images)) return [];
    const out = [];
    images.forEach((img, i) => {
      if (!img) return;
      const mimeType = img.mimeType || "image/png";
      const data = img.data || "";
      const dataUrl = img.dataUrl || (data ? `data:${mimeType};base64,${data}` : "");
      if (!dataUrl) return;
      const ext = mimeType.split("/")[1] || "png";
      out.push({
        id: `img_restored_${i}_${Math.random().toString(36).slice(2, 7)}`,
        name: img.name || `restored-${i + 1}.${ext}`,
        size: img.size ?? Math.round(data.length * 0.75),
        mimeType,
        dataUrl,
        data,
      });
    });
    return out;
  }

  return { activeUserEntries, resolveTarget, countAffected, stripPlanFraming, toComposerImages, textKey };
});
