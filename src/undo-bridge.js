/* ═════════════════════════════════════════════════════════════════════
   undo-bridge.js — orchestration for "undo a sent message".

   Flow: get_entries → UndoMessage.resolveTarget (tail-aligned, text-verified)
   → omp `branch` RPC (new session file, process switches to it) → truncate the
   local message list → reset derived state → get_state.

   The local list is truncated directly instead of re-fetching get_messages:
   that merge is positional and mis-aligns once the UI list was head-trimmed.

   Tab switches are deferred while an undo is in flight (`whenIdle`): switching
   tears down the old session's line listener, so the get_entries/branch
   responses would never arrive and the undone text could not reach the
   composer of the tab it came from.

   Loaded as a plain script before live.js; live.js injects its IIFE-private
   helpers via UndoBridge.create(deps) (same pattern as PeerSessionBridge).
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  const RPC_TIMEOUT_MS = 30000;

  /**
   * deps:
   *   state, notify, sendWithResponse(cmd, timeout), applyRpcState(rpcState)
   *   getActiveSessionId(), sessionSnapshots (Map)
   *   clearVolatile()  — drops streaming/ask bubbles + tool-card index (live.js locals)
   *   reindexToolCards(), defaultPlanMeta()
   */
  function create(deps) {
    let inflight = null;

    const tr = (key, params) => (window.t ? window.t(key, params) : key);

    function warn(text) {
      deps.state.messages = [
        ...deps.state.messages,
        {
          kind: "assistant", time: window.timeNow ? window.timeNow() : "",
          blocks: [{ type: "text", text: `⚠️ ${text}` }],
          thought: null, lead: null, streaming: false, completed: true,
        },
      ];
      deps.notify();
    }

    /** Surface a failure in the originating tab only — never in whichever tab is active now. */
    function fail(sessionId, key, params) {
      if (deps.getActiveSessionId() === sessionId) warn(tr(key, params));
      else console.warn(`[live] undo failed after tab switch (${key})`);
      return { ok: false, reason: key };
    }

    /**
     * Why undo is unavailable right now: `"running"` (streaming / compacting),
     * `"async"` (idle turn but background jobs pending — omp `branch` would
     * cancel them), or `null` when it is safe.
     */
    function busyReason() {
      const s = deps.state;
      if (s.isStreaming || s.rpcState?.isCompacting) return "running";
      // Manual /compact only adds a pending card; rpcState.isCompacting stays false.
      if (s.messages.some((m) => m.kind === "compact" && m.status === "pending")) return "running";
      if (s.hasPendingAsyncWork) return "async";
      return null;
    }

    function resetDerivedState(uiIdx) {
      const s = deps.state;
      s.messages = s.messages.slice(0, uiIdx);
      deps.clearVolatile();
      deps.reindexToolCards();

      // toolLogs are keyed by unique toolCallId and finished tool cards are
      // ephemeral (never in s.messages when idle), so they are kept as-is.
      s.runningTools = [];
      s.recentTools = [];
      s.hubMode = "compact";
      s.hubAgents = [];
      s.hubTaskId = null;
      s.hubHistory = [];
      // _applyRpcState only overwrites the board when phases are non-empty, so
      // clear it first; get_state re-supplies the phases at the branch point.
      s.kanban = [];
      s.planMeta = deps.defaultPlanMeta();
      s.sessionCost = null;
    }

    async function run(uiIdx, sessionId, target) {
      try {
        const listing = (await deps.sendWithResponse({ type: "get_entries" }, RPC_TIMEOUT_MS)) ?? {};
        const resolved = window.UndoMessage.resolveTarget(
          deps.state.messages,
          uiIdx,
          window.UndoMessage.activeUserEntries(listing.entries, listing.leafId),
        );
        if (!resolved) return fail(sessionId, "undo.fail.locate");

        // The awaits above leave room for a new turn. `branch` is destructive
        // and addressed to the *active* session — re-check. (Tab switches are
        // deferred by whenIdle(); the session check is purely defensive.)
        if (deps.getActiveSessionId() !== sessionId || deps.state.messages[uiIdx] !== target) {
          return { ok: false, reason: "switched" };
        }
        if (busyReason()) return fail(sessionId, "undo.fail.busy");

        const res = await deps.sendWithResponse({ type: "branch", entryId: resolved.entryId }, RPC_TIMEOUT_MS);
        if (res?.cancelled) return fail(sessionId, "undo.fail.cancelled");

        resetDerivedState(uiIdx);
        const rpcState = await deps
          .sendWithResponse({ type: "get_state" }, RPC_TIMEOUT_MS)
          .catch(() => null);
        if (rpcState) deps.applyRpcState(rpcState);
        deps.notify();

        const raw = typeof res?.text === "string" && res.text ? res.text : resolved.text;
        const { text, stripped } = window.UndoMessage.stripPlanFraming(raw);
        return { ok: true, text, images: target.images ?? [], planFramingStripped: stripped };
      } catch (err) {
        console.error("[live] undoMessage failed:", err);
        return fail(sessionId, "undo.fail.generic", { error: err?.message ?? String(err) });
      }
    }

    /**
     * Undo the user bubble at `uiIdx`. Resolves to
     * `{ ok: true, text, images, planFramingStripped }` or `{ ok: false, reason }`;
     * failures after the guard checks surface an i18n warning bubble.
     */
    function undoMessage(uiIdx) {
      if (!window.__TAURI__ || inflight) return Promise.resolve({ ok: false, reason: "busy" });
      const sessionId = deps.getActiveSessionId();
      const target = deps.state.messages[uiIdx];
      if (!sessionId || !target || target.kind !== "user") return Promise.resolve({ ok: false, reason: "invalid" });
      if (busyReason()) return Promise.resolve(fail(sessionId, "undo.fail.busy"));

      const p = run(uiIdx, sessionId, target).finally(() => { inflight = null; });
      inflight = p;
      return p;
    }

    /**
     * Resolves once no undo is in flight. The extra macrotask lets the caller
     * of `undoMessage` (which awaits the same promise) finish its follow-up
     * work — dispatching `composer-restore` — before a tab switch proceeds.
     */
    function whenIdle() {
      if (!inflight) return Promise.resolve();
      return inflight.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 0)));
    }

    return { undoMessage, whenIdle, busyReason };
  }

  window.UndoBridge = { create };
})();
