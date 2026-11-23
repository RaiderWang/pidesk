/* ═════════════════════════════════════════════════════════════════════
   empty-bubble.js — pure predicate for assistant bubbles with nothing to
   show.

   A tool-only assistant turn (`content` = toolCalls only) opens a placeholder
   bubble on `message_start`; omp persists nothing displayable for it. When
   the turn ends without text / thought / plan / error the bubble would stay
   in the timeline as a header-only "blank bubble", so live.js drops it.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EmptyBubble = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const hasText = (s) => typeof s === "string" && s.trim().length > 0;

  /** True for an assistant bubble with no visible content of any kind. */
  function isContentless(msg) {
    if (!msg || msg.kind !== "assistant" || msg.notice) return false;
    if (hasText(msg.thought) || msg.error) return false;
    const blocks = Array.isArray(msg.blocks) ? msg.blocks : [];
    return !blocks.some((b) => b && (b.type === "plan" || (b.type === "text" && hasText(b.text))));
  }

  return { isContentless };
});
