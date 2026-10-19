/* ═════════════════════════════════════════════════════════════════════
   message-merge.js — pure logic for reconciling live UI messages with
   persisted turns from omp's `get_messages`.

   Why alignment instead of positions:
   `state.messages` is head-trimmed (`_trimMessages`, 169 cap), and omp's
   compaction drops older turns from `get_messages`. Pairing the Nth local
   text bubble with the Nth persisted turn therefore mis-maps content and
   re-appends already-shown turns at the end.

   Here the local user/assistant bubbles are aligned against the persisted
   list by an exact key match (tail first, so the newest turns — which are
   what both sides always share — win):
     shift ≥ 0  local[i] ↔ completed[i + shift]  (local was head-trimmed)
     shift < 0  completed is a suffix of local   (omp compacted old turns;
                local-only older bubbles are kept as they are)
   Ephemeral tool/ask/compact cards stay where they are; persisted turns
   beyond the aligned window (finished while the tab was in the background)
   are appended. No alignment → persisted list wins, cards go last.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MessageMerge = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EPHEMERAL = new Set(["tool", "ask", "compact"]);
  // Client-side notice bubbles (`notice: true`) never exist in omp's session
  // file: they must not take part in alignment, and they stay where they are.
  const isNotice = (m) => Boolean(m && m.notice);
  const isText = (m) => m && (m.kind === "user" || m.kind === "assistant") && !isNotice(m);
  const isEphemeral = (m) => EPHEMERAL.has(m.kind) || isNotice(m);

  /** Whitespace-insensitive: UI joins text blocks with "\n", omp with "". */
  function textKey(text) {
    return String(text ?? "").replace(/\s+/g, "");
  }

  function blocksText(msg) {
    if (!Array.isArray(msg.blocks)) return "";
    return msg.blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }

  /** Comparable identity of a user/assistant bubble (computed once per message). */
  function messageKey(msg) {
    if (msg.kind === "user") return `u|${textKey(msg.text)}|${msg.images?.length ?? 0}`;
    const text = textKey(blocksText(msg));
    return text ? `a|${text}` : `t|${textKey(msg.thought)}`; // thought-only turn
  }

  /**
   * Tool-only assistant turns open an assistant bubble with no text and no
   * thought (live `message_start`), but omp persists nothing displayable for
   * them and `get_messages` yields no bubble. They carry no content, so they
   * must neither take part in alignment nor survive the merge.
   */
  function isEmptyBubble(msg) {
    return isText(msg) && (messageKey(msg) === "t|" || messageKey(msg) === "u||0");
  }

  /** True when local[i] ↔ completed[i + shift] holds over the whole overlap. */
  function overlapMatches(localKeys, compKeys, shift) {
    const from = Math.max(0, -shift);
    const to = Math.min(localKeys.length, compKeys.length - shift);
    for (let i = from; i < to; i++) {
      if (localKeys[i] !== compKeys[i + shift]) return false;
    }
    return true;
  }

  /**
   * Offset `shift` aligning local keys onto persisted keys, or `null`.
   * Tail alignment (`n - m`) is tried first, then earlier windows. When
   * there are more local bubbles than persisted turns only the exact tail
   * alignment is meaningful (everything persisted must match the local tail).
   */
  function findShift(localKeys, compKeys) {
    const top = compKeys.length - localKeys.length;
    if (top < 0) return overlapMatches(localKeys, compKeys, top) ? top : null;
    for (let shift = top; shift >= 0; shift--) {
      if (overlapMatches(localKeys, compKeys, shift)) return shift;
    }
    return null;
  }

  /**
   * Merge the current UI messages (possibly head-trimmed, interleaved with
   * ephemeral cards) with the authoritative persisted turns.
   */
  function merge(currentMessages, completed) {
    const comp = Array.isArray(completed) ? completed : [];
    if (!Array.isArray(currentMessages) || currentMessages.length === 0) return [...comp];

    // Streaming bubbles are re-attached by the caller.
    const local = currentMessages.filter((m) => m && !m.streaming && !isEmptyBubble(m));
    const localText = local.filter(isText);
    if (localText.length === 0) return [...comp, ...local];

    const shift = findShift(localText.map(messageKey), comp.map(messageKey));
    if (shift === null) {
      return [...comp, ...local.filter(isEphemeral)];
    }

    const out = [];
    let textIdx = 0;
    for (const m of local) {
      if (!isText(m)) {
        out.push(m);
        continue;
      }
      const persisted = comp[textIdx + shift];
      // Keep the local React key so the bubble isn't remounted.
      out.push(persisted ? (m._id ? { ...persisted, _id: m._id } : persisted) : m);
      textIdx++;
    }
    // Turns that completed while this tab was in the background.
    out.push(...comp.slice(Math.max(0, localText.length + shift)));
    return out;
  }

  return { messageKey, isEmptyBubble, findShift, merge };
});
