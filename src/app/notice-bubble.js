/* ═════════════════════════════════════════════════════════════════════
   notice-bubble.js — builds a client-side assistant notice bubble.

   AssistantBubble renders `msg.blocks` only; a bubble carrying a bare
   `text` field shows as an empty shell (avatar + time, no body). Every
   locally-injected notice must therefore go through `make()`.

   `make()` also tags the bubble `notice: true`. Notices exist only in the
   UI (never in omp's session file), so MessageMerge, BranchSession, undo,
   plan annotation and "last assistant" lookups must skip them — see
   `NoticeBubble.isNotice`.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NoticeBubble = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** Completed assistant bubble with a single Markdown text block. */
  function make(text, time, model = null) {
    return {
      kind: "assistant",
      notice: true,
      time: time ?? (typeof window !== "undefined" && window.timeNow ? window.timeNow() : ""),
      model,
      blocks: [{ type: "text", text: String(text ?? "") }],
      thought: null,
      lead: null,
      streaming: false,
      completed: true,
    };
  }

  /** True for client-side notice bubbles created by `make()`. */
  function isNotice(msg) {
    return Boolean(msg && msg.notice === true);
  }

  return { make, isNotice };
});
