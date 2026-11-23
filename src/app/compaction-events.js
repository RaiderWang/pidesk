/* ═════════════════════════════════════════════════════════════════════
   compaction-events.js — pure reducers for omp's `manual_compaction_start`
   / `manual_compaction_end` events (19.x).

   PiDesk's own Compact button already owns a `pending` card that the RPC
   `compact` response resolves (and back-fills tokensAfter for). These
   events additionally fire for compactions started elsewhere (extension
   `ctx.compact()`, `/compact`), where no card exists. To leave the RPC path
   untouched, the reducers only create and resolve cards flagged
   `external: true`.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CompactionEvents = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const isPending = m => m?.kind === "compact" && m.status === "pending";

  /**
   * `manual_compaction_start`. No-op while any compact card is pending
   * (PiDesk-initiated); otherwise appends an external pending card.
   * @returns {{ messages: object[], changed: boolean }}
   */
  function onStart(messages, { id, time, contextTokens } = {}) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.some(isPending)) return { messages: list, changed: false };
    const card = {
      kind: "compact",
      status: "pending",
      external: true,
      id: id || `ext-cmpct-${list.length}`,
      time,
      tokensBefore: contextTokens > 0 ? contextTokens : null,
    };
    return { messages: [...list, card], changed: true };
  }

  /**
   * `manual_compaction_end`. Resolves the latest pending external card only.
   * `completedId` is set only for a committed compaction, so the caller can
   * refresh `get_state` and back-fill tokensAfter.
   * @returns {{ messages: object[], changed: boolean, completedId: string|null }}
   */
  function onEnd(messages, ev, { abortedText = "aborted" } = {}) {
    const list = Array.isArray(messages) ? messages : [];
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (isPending(list[i]) && list[i].external) { idx = i; break; }
    }
    if (idx === -1) return { messages: list, changed: false, completedId: null };

    const card = list[idx];
    const e = ev || {};
    const errText = typeof e.errorMessage === "string" ? e.errorMessage.trim() : "";

    if (e.skipped) {
      return { messages: list.filter((_, i) => i !== idx), changed: true, completedId: null };
    }
    let next;
    let completedId = null;
    if (e.result && !e.aborted && !errText) {
      const r = e.result;
      next = {
        ...card,
        status: "done",
        shortSummary: r.shortSummary || null,
        summary: r.summary || null,
        ...(r.tokensBefore > 0 ? { tokensBefore: r.tokensBefore } : {}),
      };
      completedId = card.id;
    } else {
      next = { ...card, status: "error", errorReason: errText || (e.aborted ? abortedText : null) };
    }
    return { messages: list.map((m, i) => (i === idx ? next : m)), changed: true, completedId };
  }

  return { onStart, onEnd };
});
