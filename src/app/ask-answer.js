/* ═════════════════════════════════════════════════════════════════════
   ask-answer.js — pure logic: turn a user action on an ask bubble into the
   `extension_ui_response` payloads to send plus the bubble patch.

   `planAnswer(bubble, payload)` → `{ frames, patch, handshake }` | null
     frames     response bodies WITHOUT `type`/`id` (caller adds them)
     patch      fields to merge into the bubble
     handshake  `{ askId, text }` when the free text must be delivered to the
                follow-up `input`/`editor` request ("Other" two-step), else null

   payload: `{ value }` | `{ custom }` | `{ clearOther: true }`
          | `{ text }` (input/editor) | `{ cancelled: true }`

   Returns null for anything that must not be sent (bubble not `open`, value
   not offered by the server, blank custom text, no otherRow…): sending a
   non-offered select value aborts the whole turn on newer omp.

   Handshake lifecycle (owned by the caller, see live.js): cleared when it is
   consumed by an input/editor, on any new `select`, on a `cancel`, when the
   ask tool ends, on abort/exit and on tab switch.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AskAnswer = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const state = (m) => m.state ?? (m.cancelled ? "cancelled" : m.answered ? "answered" : "open");

  const answered = (extra) => ({ state: "answered", answered: true, ...extra });

  function planSelect(b, value) {
    if (typeof value !== "string") return null;
    const isDone = b.doneRow != null && value === b.doneRow;
    if (!isDone && !b.options.includes(value)) return null;
    if (isDone || !b.multi) return { frames: [{ value }], patch: answered({ answer: value }), handshake: null };
    // Multi-select: every click is its own response; the server replies with the next round.
    const checked = b.checked.includes(value) ? b.checked.filter(c => c !== value) : [...b.checked, value];
    return { frames: [{ value }], patch: { state: "pending", checked, answer: value }, handshake: null };
  }

  function planCustom(b, text) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!b.otherRow || !trimmed) return null;
    // Other already ticked: re-sending the row only UNticks it and omp asks nothing — a
    // handshake armed here would linger and swallow the next unrelated input request.
    if (b.multi && b.otherChecked) return null;
    const handshake = { askId: b.id, text: trimmed };
    const frames = [{ value: b.otherRow }];
    if (b.multi) {
      return { frames, handshake, patch: { state: "pending", otherChecked: true, otherText: trimmed, answer: trimmed } };
    }
    return { frames, handshake, patch: answered({ answer: trimmed, otherText: trimmed }) };
  }

  function planClearOther(b) {
    if (!b.multi || !b.otherChecked || !b.otherRow) return null;
    // Server toggles "Other" off on a repeated otherRow and sends NO input request — no handshake.
    return {
      frames: [{ value: b.otherRow }], handshake: null,
      patch: { state: "pending", otherChecked: false, otherText: null },
    };
  }

  function planText(b, text) {
    if (b.mode !== "input" && b.mode !== "editor") return null;
    const value = typeof text === "string" ? text : "";
    // Empty is a valid answer (the only way to skip an optional field); a cancel aborts the turn.
    return { frames: [{ value }], handshake: null, patch: answered({ answer: b.secret ? null : value, answerMasked: b.secret }) };
  }

  function planAnswer(bubble, payload) {
    if (!bubble || state(bubble) !== "open" || !payload) return null;
    if (payload.cancelled) {
      return { frames: [{ cancelled: true }], handshake: null, patch: { state: "cancelled", cancelled: true } };
    }
    if (bubble.mode === "input" || bubble.mode === "editor") {
      return "text" in payload ? planText(bubble, payload.text) : null;
    }
    if ("value" in payload) return planSelect(bubble, payload.value);
    if ("custom" in payload) return planCustom(bubble, payload.custom);
    if (payload.clearOther) return planClearOther(bubble);
    return null;
  }

  /**
   * Response body for an `input`/`editor` request that follows an "Other"
   * submit, or null when there is no handshake / the request is not a text one.
   */
  function resolveHandshake(handshake, ev) {
    if (!handshake || !ev) return null;
    if (ev.method !== "input" && ev.method !== "editor") return null;
    return { value: handshake.text };
  }

  return { planAnswer, resolveHandshake };
});
