/* ═════════════════════════════════════════════════════════════════════
   session-restart.js — pure decision for "restart the active tab's omp".

   omp only reads models.yml at startup and exposes no RPC to reload it, so
   after the model config changes the tab's process has to be respawned.
   History survives because omp persists turns to the session .jsonl and
   `--resume <file>` reloads them. Restarting without a session file would
   leave the UI showing a conversation omp no longer has, so that is only
   allowed while the tab is still empty.

   plan() → { ok: true, resume: <path|null> }
          | { ok: false, reason: "no-session" | "busy" | "no-session-file" }
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SessionRestart = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** User turns / real assistant replies (not notices, tool or compact cards). */
  function hasConversation(messages) {
    return (Array.isArray(messages) ? messages : []).some(
      (m) => m && (m.kind === "user" || (m.kind === "assistant" && !m.notice)),
    );
  }

  function plan({ hasSession, isStreaming, hasPendingAsyncWork, sessionFile, messages }) {
    if (!hasSession) return { ok: false, reason: "no-session" };
    // A restart would kill the running turn / background tasks.
    if (isStreaming || hasPendingAsyncWork) return { ok: false, reason: "busy" };
    if (typeof sessionFile === "string" && sessionFile.trim()) {
      return { ok: true, resume: sessionFile };
    }
    if (!hasConversation(messages)) return { ok: true, resume: null };
    return { ok: false, reason: "no-session-file" };
  }

  return { hasConversation, plan };
});
