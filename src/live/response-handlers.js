/* live/response-handlers.js — RPC `response` frames → state.

   Dispatch order is load-bearing (see handleResponse):
     1. an id registered by _sendWithResponse is resolved/rejected FIRST — success
        or failure — otherwise a failed correlated command would hang until its timeout;
     2. `always` handlers (compact, set_model failure) run for success AND failure;
     3. any other failure stops here, silently;
     4. only then the `success` table.
   Model/thinking handlers come from live/models.js and are merged into the tables.
   Also owns applyRpcState (the get_state projection), which undo-bridge reuses.
   Registers window._Live.ResponseHandlers; collaborators are injected into create(). */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {object}   ctx.runtime            live/runtime.js instance (reindexToolCards, refreshCtx)
   * @param {Function} ctx.notify
   * @param {Function} ctx.send               send a command to the active omp
   * @param {Map}      ctx.pendingResponses   id → { resolve, reject } (see _sendWithResponse)
   * @param {Map}      ctx.sessionRegistry
   * @param {object}   ctx.todo               TodoPhases instance
   * @param {object}   ctx.ui                 EventsUi instance (finalizeAsks)
   * @param {object}   ctx.models             Models instance (restorePrefs, syncCurrentModel, initFetch, responseHandlers)
   * @param {Function} ctx.buildModelEntry    live/custom-models.js
   * @param {Function} ctx.setTabTitle        from TabTitles
   * @param {Function} ctx.resetSession       wipe per-tab state + ask handshake
   */
  function create({
    state, rt, runtime, notify, send, pendingResponses, sessionRegistry,
    todo, ui, models, buildModelEntry, setTabTitle, resetSession,
  }) {
    // ── get_state ──────────────────────────────────────────────────────────────
    function applyRpcState(rpcState) {
      if (!rpcState) return;
      state.rpcState      = rpcState;
      state.isStreaming   = rpcState.isStreaming ?? false;
      state.hasPendingAsyncWork = rpcState.hasPendingAsyncWork ?? false;
      state.isSettled     = rpcState.isSettled ?? true;
      // If the turn completed while we were away (snapshot had streamingBubble
      // with streaming:true, but omp now says isStreaming:false), retire the
      // bubble immediately. The completed text arrives with get_messages; the
      // stale ghost is removed from state.messages here so the minimap doesn't
      // show a pulsating cell until get_messages lands.
      if (!state.isStreaming && rt.session.streamingBubble) {
        rt.session.streamingBubble.streaming = false;
        state.messages = state.messages.map(m => m.streaming ? { ...m, streaming: false } : m);
        rt.session.streamingBubble = null;
      }
      if (!state.isStreaming) {
        state.turnStartMs  = null;
        state.runningTools = [];
        // Idle agent ⇒ no ask can still be waiting (e.g. the answer/tool end was lost across a tab switch).
        ui.finalizeAsks({ aborted: false });
        if (state.messages.some(m => m.kind === "tool")) {
          state.messages = state.messages.filter(m => m.kind !== "tool");
          rt.session.activeToolCards.clear();
        }
      }
      state.thinkingLevel = state.thinkingLevel ?? rpcState.thinkingLevel ?? "off";

      if (rpcState.model) {
        state.model = buildModelEntry(rpcState.model);
        models.syncCurrentModel();
      }
      if (rpcState.model && state.models.length > 0) {
        state.models = state.models.map(m => ({ ...m, current: m.id === rpcState.model.id }));
      }
      // get_state only feeds kanban/planMeta — the inline plan block in chat is not touched.
      todo.apply(rpcState.todoPhases ?? rpcState.phases ?? rpcState.todos, {
        fallback: rpcState.todoPhases ?? [], inject: false,
      });

      // Only update the tab name if omp provides an explicit human-readable
      // sessionName. The sessionFile is a timestamp ID — leave the folder-based
      // name set at tab-open time intact when sessionName is absent.
      if (rpcState.sessionName) {
        setTabTitle(rpcState.sessionName);
      }
      if (rpcState.sessionFile && rt.conn.activeSessionId && sessionRegistry.has(rt.conn.activeSessionId)) {
        const entry = sessionRegistry.get(rt.conn.activeSessionId);
        const normFile = window.SessionTitle?.normalizePath || (p => (p || "").replace(/\\/g, "/").toLowerCase());
        if (!entry.sessionFile) {
          sessionRegistry.set(rt.conn.activeSessionId, { ...entry, sessionFile: rpcState.sessionFile });
        } else if (normFile(entry.sessionFile) !== normFile(rpcState.sessionFile)) {
          // omp moved this process to another session file (undo/branch,
          // new_session, switch_session). Re-bind the tab, otherwise history's
          // "already open" check and resumeSession de-dup would match the old
          // file and let the new one be opened a second time (two omp
          // processes writing one .jsonl).
          sessionRegistry.set(rt.conn.activeSessionId, {
            ...entry,
            sessionFile:    rpcState.sessionFile,
            sessionPath:    rpcState.sessionFile,
            savedSessionId: rpcState.sessionId ?? null,
          });
        }
      }

      // Back-fill tokensAfter for a just-completed compact message.
      // The compact response itself only carries tokensBefore; the post-compact
      // token count comes from the get_state response that we trigger right
      // after a successful compact. compactBackfillId ensures we only patch the
      // right message and only once (prevents stale back-fills from later
      // get_state calls after new turns have grown the context again).
      if (rt.session.compactBackfillId != null) {
        const afterTokens = rpcState?.contextUsage?.tokens;
        if (afterTokens != null) {
          const cid = rt.session.compactBackfillId;
          rt.session.compactBackfillId = null;
          state.messages = state.messages.map(m =>
            m.kind === "compact" && m.id === cid ? { ...m, tokensAfter: afterTokens } : m
          );
        }
      }

      // On the first get_state of a fresh session (no snapshot), restore
      // the user's saved model + thinking level so the new omp process
      // matches their previous choices.
      if (rt.session.sessionFresh) {
        rt.session.sessionFresh = false;
        models.restorePrefs();
      }

      runtime.refreshCtx();
      notify();
    }

    // ── compact: success AND failure (an `always` handler) ─────────────────────
    function onCompact(resp) {
      let idx = -1;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].kind === "compact" && state.messages[i].status === "pending") { idx = i; break; }
      }
      if (idx !== -1) {
        const d = resp.data ?? {};
        const compactMsgId = state.messages[idx]?.id;
        // tokensBefore was pre-filled from contextUsage when the compact
        // message was created. Only override it when omp returns a valid
        // positive value (some omp versions return 0).
        const rpcBefore = d.tokensBefore > 0 ? d.tokensBefore : undefined;
        const update = resp.success
          ? { status: "done", shortSummary: d.shortSummary || null, summary: d.summary || null, ...(rpcBefore != null ? { tokensBefore: rpcBefore } : {}) }
          : { status: "error", errorReason: resp.error || null };
        state.messages = state.messages.map((m, i) => i === idx ? { ...m, ...update } : m);
        if (resp.success && compactMsgId) rt.session.compactBackfillId = compactMsgId;
      }
      notify();
      // After a successful compact the context window shrank — refresh
      // rpcState so the ambient gauge updates immediately rather than
      // waiting for the next turn_end.
      if (resp.success) {
        send({ type: "get_state" });
      }
      return true;
    }

    // ── get_messages ───────────────────────────────────────────────────────────
    function onGetMessages(data) {
      const completed = window.adaptAgentMessages(data.messages ?? []);
      // Reconcile live messages with completed history using window/tail alignment.
      // Avoids naive positional replacement that mis-aligns turns when state.messages
      // has been head-trimmed (runtime.trimMessages). Ephemeral tool/ask/compact cards are
      // preserved and background turns appended.
      const merged = window.MessageMerge
        ? window.MessageMerge.merge(state.messages, completed)
        : completed;
      // Rebuild activeToolCards — new entries may have been appended from pending
      runtime.reindexToolCards(merged);
      state.messages = rt.session.streamingBubble ? [...merged, rt.session.streamingBubble] : merged;

      // Restore kanban from persisted message history if not yet set or newer
      if (Array.isArray(data.messages)) {
        for (let i = data.messages.length - 1; i >= 0; i--) {
          const raw = data.messages[i];
          const toolName = raw?.toolName ?? raw?.name;
          if (raw?.role === "toolResult" && (toolName === "todo" || toolName === "todo_write")) {
            const rawPhases = raw.details?.phases ?? raw.details?.todos ?? raw.details ?? raw.phases ?? raw.todos;
            if (todo.apply(rawPhases)) break;
          }
          if (raw?.role === "assistant" && Array.isArray(raw.content)) {
            let found = false;
            for (const b of raw.content) {
              if (b?.type === "toolCall" && (b.name === "todo" || b.name === "todo_write")) {
                const rawPhases = b.arguments?.phases ?? b.arguments?.todos ?? b.arguments;
                if (todo.apply(rawPhases)) {
                  found = true;
                  break;
                }
              }
            }
            if (found) break;
          }
        }
      }
      notify();
    }

    // New session started — clear local state and re-fetch.
    function onNewSession() {
      resetSession();
      models.initFetch();
      notify();
    }

    // Own keys only: `command` comes off the wire.
    const always = Object.assign(Object.create(null), { compact: onCompact }, models.responseHandlers.always);
    const success = Object.assign(Object.create(null), {
      get_state:         data => applyRpcState(data),
      get_messages:      onGetMessages,
      new_session:       onNewSession,
      get_session_stats: () => {}, // SessionStats — no display action needed
    }, models.responseHandlers.success);

    function handleResponse(resp) {
      // 1. ID-keyed correlation — resolve or reject the waiting _sendWithResponse call.
      if (resp.id && pendingResponses.has(resp.id)) {
        const handler = pendingResponses.get(resp.id);
        pendingResponses.delete(resp.id);
        if (resp.success) {
          handler.resolve(resp.data ?? null);
        } else {
          handler.reject(new Error(resp.error ?? `Command '${resp.command}' failed`));
        }
        return;
      }
      // 2. Handlers that must also see failures (compact card, set_model rollback).
      if (always[resp.command]?.(resp)) return;
      // 3. Everything else: a failure is dropped here.
      if (!resp.success) return;
      // 4. Success table.
      success[resp.command]?.(resp.data, resp);
    }

    return { handleResponse, applyRpcState };
  }

  window._Live.ResponseHandlers = { create };
})();
