/* ═════════════════════════════════════════════════════════════════════
   notice-bubble.js — builds a client-side assistant notice bubble.

   AssistantBubble renders `msg.blocks` only; a bubble carrying a bare
   `text` field shows as an empty shell (avatar + time, no body). Every
   locally-injected notice must therefore go through `make()`.
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
  function make(text, time) {
    return {
      kind: "assistant",
      time: time ?? (typeof window !== "undefined" && window.timeNow ? window.timeNow() : ""),
      model: null,
      blocks: [{ type: "text", text: String(text ?? "") }],
      thought: null,
      lead: null,
      streaming: false,
      completed: true,
    };
  }

  return { make };
});
