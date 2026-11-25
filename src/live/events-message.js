/* live/events-message.js — turn / message lifecycle and session-level events.

   turn_start/_end, message_start/_update/_end, thinking_level_changed,
   session_info_update, manual_compaction_start/_end (omp 19), agent_start/_end,
   session_settled and prompt_result (+ the prompt error bubble).
   Registers window._Live.EventsMessage; needs nothing at load time (all
   collaborators, incl. savePrefs, are injected into create()). */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {Function} ctx.notify
   * @param {Function} ctx.send                    send a command to the active omp
   * @param {Function} ctx.savePrefs               persist model/thinking prefs (live/prefs.js)
   * @param {Function} ctx.settleInFlightActions   ({ aborted }) — finish running bubbles/tools/asks
   * @param {Function} ctx.reindexToolCards        from Runtime
   * @param {Function} ctx.refreshCtx              from Runtime
   * @param {Function} ctx.nextCmdId               from Runtime
   * @param {Function} ctx.setTabTitle             (title, targetSessionId)
   * @param {Function} ctx.updateTabTitleIfDefault (firstUserText)
   */
  function create({
    state, rt, notify, send, savePrefs,
    settleInFlightActions, reindexToolCards, refreshCtx, nextCmdId,
    setTabTitle, updateTabTitleIfDefault,
  }) {
    // ── Session-level ─────────────────────────────────────────────────────────
    function onSessionInfoUpdate(ev) {
      const title = ev.title;
      if (title) setTabTitle(title, ev.sessionId);
    }

    function onThinkingLevelChanged(ev) {
      let newLevel = ev.thinkingLevel ?? "off";
      if (Array.isArray(state.availableThinkingLevels) && state.availableThinkingLevels.length > 0) {
        if (!state.availableThinkingLevels.includes(newLevel)) {
          newLevel = state.availableThinkingLevels[0] || "off";
        }
      }
      if (state.thinkingLevel !== newLevel) {
        state.thinkingLevel = newLevel;
        savePrefs({ thinkingLevel: newLevel });
        notify();
      }
    }

    // ── Turn lifecycle ────────────────────────────────────────────────────────
    function onTurnStart() {
      const now = Date.now();
      rt.session.turnStartTime = now;
      state.isStreaming = true;
      state.turnStartMs = now;
      state.runningTools = [];
      notify();
    }

    function onTurnEnd(ev) {
      const now = Date.now();
      const s = rt.session;
      state.isStreaming = false;
      state.turnStartMs = null;
      state.runningTools = [];
      s.streamingBubble = null;
      settleInFlightActions({ aborted: false });
      const usage = ev.message?.usage;
      if (s.turnStartTime) {
        const elapsed   = (now - s.turnStartTime) / 1000;
        const outTokens = usage?.output ?? 0;
        if (elapsed > 0 && outTokens > 0) {
          const tps = outTokens / elapsed;
          s.tpsSamples.push(Math.round(tps));
          s.tpsSamples.shift();
          state.currentTps = tps;
          state.sparkline  = [...s.tpsSamples];
        }
      }
      if (usage?.cost?.total) {
        state.sessionCost = (state.sessionCost ?? 0) + usage.cost.total;
        refreshCtx();
      }
      send({ type: "get_session_stats" });
      send({ type: "get_state" });
      notify();
    }

    // ── Message lifecycle ─────────────────────────────────────────────────────
    function onMessageStart(ev) {
      const time = window.timeNow();
      const msg  = ev.message;
      const role = msg?.role;

      if (role === "user") {
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const text = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("\n").trim();
        const images = blocks.filter(b => b.type === "image").map(b => ({
          type: "image",
          data: b.data,
          mimeType: b.mimeType || "image/png",
        }));
        if (text || images.length > 0) {
          const last = state.messages[state.messages.length - 1];
          if (!(last?.kind === "user" && last.text === text)) {
            state.messages = [...state.messages, { kind: "user", time, text, images }];
          } else if (images.length > 0 && (!last.images || last.images.length === 0)) {
            last.images = images;
          }
          if (text) updateTabTitleIfDefault(text);
          notify();
        }
      } else if (role === "assistant") {
        const blocks = Array.isArray(msg?.content) ? msg.content : [];
        const initialThought = window.extractThought ? window.extractThought(blocks) : null;
        rt.session.streamingBubble = {
          kind: "assistant", time,
          thought: initialThought,
          lead: initialThought ? "thinking" : null,
          blocks: [{ type: "text", text: "" }],
          streaming: true,
          model: state.model?.name ?? "–",
        };
        state.messages = [...state.messages, rt.session.streamingBubble];
        notify();
      }
    }

    function onMessageUpdate(ev) {
      const bubble = rt.session.streamingBubble;
      if (!bubble) return;
      const msg = ev.message;
      if (!msg) return;

      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const newThought = window.extractThought ? window.extractThought(blocks) : null;
      // Preserve streamingBubble.thought if current update did not contain thinking block
      const thought = newThought !== null ? newThought : bubble.thought;
      const designBlocks = [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) designBlocks.push({ type: "text", text: block.text });
      }
      const existingPlan = (bubble.blocks ?? []).find(b => b.type === "plan");
      if (existingPlan && !designBlocks.some(b => b.type === "plan")) {
        designBlocks.push(existingPlan);
      }

      bubble.thought = thought;
      bubble.lead    = thought ? "thinking" : null;
      bubble.blocks  = designBlocks.length > 0 ? designBlocks : [{ type: "text", text: "" }];

      const updated = { ...bubble, blocks: [...bubble.blocks] };
      // Find by streaming flag — indexOf fails after the first update because
      // each update replaces the entry with a new copy; ask bubbles may also
      // sit after the streaming bubble in state.messages.
      const uidx = state.messages.findLastIndex(m => m.streaming === true);
      if (uidx !== -1) {
        const msgs = [...state.messages];
        msgs[uidx] = updated;
        state.messages = msgs;
      } else {
        state.messages = [...state.messages.slice(0, -1), updated];
      }
      notify();
    }

    function onMessageEnd(ev) {
      const s = rt.session;
      const msg = ev.message;
      // user / toolResult messages end too (e.g. steer mid-stream); they must
      // not close the in-flight assistant bubble.
      if (msg?.role && msg.role !== "assistant") return;
      const usage = msg?.usage;
      const tokens = usage ? ((usage.input ?? 0) + (usage.output ?? 0)) : null;
      const bubble = s.streamingBubble;
      if (bubble && msg) {
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const endThought = window.extractThought ? window.extractThought(blocks) : null;
        const thought = endThought !== null ? endThought : bubble.thought;
        const designBlocks = blocks.filter(b => b.type === "text" && b.text?.trim()).map(b => ({ type: "text", text: b.text }));
        const existingPlan = (bubble.blocks ?? []).find(b => b.type === "plan");
        const finalBlocks = designBlocks.length > 0 ? [...designBlocks] : [...(bubble.blocks ?? [])];
        if (existingPlan && !finalBlocks.some(b => b.type === "plan")) {
          finalBlocks.push(existingPlan);
        }
        // Find by streaming flag — extension_ui_request.select may have pushed
        // an ask bubble after the streaming bubble before message_end arrives.
        const completed = {
          ...bubble,
          streaming: false, thought,
          lead:   thought ? "thinking" : null,
          blocks: finalBlocks,
          tokens,
          tokensIn:  usage?.input  ?? null,
          tokensOut: usage?.output ?? null,
        };
        const eidx = state.messages.findLastIndex(m => m.streaming === true);
        // Tool-call-only turn: nothing to show, so drop the placeholder instead
        // of leaving a header-only bubble. A failed turn is kept (and given its
        // errorMessage) so the later prompt_result error lands on this bubble
        // rather than on an older assistant message.
        // Also covers a turn that failed after streaming some text: its error
        // is shown even if no prompt_result ever follows.
        const errMsg = typeof msg.errorMessage === "string" ? msg.errorMessage.trim() : "";
        const failed = msg.stopReason === "error" || Boolean(errMsg);
        if (errMsg && !completed.error) {
          completed.error = {
            message: errMsg, provider: msg.provider, model: msg.model, retryable: false,
          };
        }
        if (!failed && window.EmptyBubble?.isContentless(completed)) {
          // Never fall back to dropping the last message: with no streaming
          // entry the list is out of sync with `streamingBubble`, leave it be.
          if (eidx !== -1) {
            state.messages = state.messages.filter((_, i) => i !== eidx);
            reindexToolCards();
          }
        } else if (eidx !== -1) {
          const msgs = [...state.messages];
          msgs[eidx] = completed;
          state.messages = msgs;
        } else {
          state.messages = [...state.messages.slice(0, -1), completed];
        }
        s.streamingBubble = null;
      } else if (bubble) {
        const completed2 = { ...bubble, streaming: false, tokens };
        const eidx2 = state.messages.findLastIndex(m => m.streaming === true);
        if (window.EmptyBubble?.isContentless(completed2)) {
          // Same collapse as above (no message payload, so no failure info).
          if (eidx2 !== -1) {
            state.messages = state.messages.filter((_, i) => i !== eidx2);
            reindexToolCards();
          }
        } else if (eidx2 !== -1) {
          const msgs = [...state.messages];
          msgs[eidx2] = completed2;
          state.messages = msgs;
        } else {
          state.messages = [...state.messages.slice(0, -1), completed2];
        }
        s.streamingBubble = null;
      }
      notify();
    }

    // ── omp 19 manual-compaction lifecycle ────────────────────────────────────
    // Only cards for compactions PiDesk did not start are created/resolved
    // here; the Compact button's own card is resolved by the RPC `compact` response.
    function onManualCompactionStart() {
      if (!window.CompactionEvents) return;
      const r = window.CompactionEvents.onStart(state.messages, {
        id: "ext-cmpct-" + nextCmdId(),
        time: window.timeNow(),
        contextTokens: state.rpcState?.contextUsage?.tokens ?? null,
      });
      if (r.changed) { state.messages = r.messages; notify(); }
    }

    function onManualCompactionEnd(ev) {
      if (!window.CompactionEvents) return;
      const r = window.CompactionEvents.onEnd(state.messages, ev, {
        abortedText: window.t ? window.t("chat.aborted") : "aborted",
      });
      if (r.changed) {
        state.messages = r.messages;
        if (r.completedId) {
          rt.session.compactBackfillId = r.completedId;
          send({ type: "get_state" });
        }
        notify();
      }
    }

    // ── Agent / session settling ──────────────────────────────────────────────
    function onAgentBoundary() {
      send({ type: "get_state" });
    }

    function onSessionSettled() {
      state.hasPendingAsyncWork = false;
      state.isSettled = true;
      notify();
    }

    function applyPromptError(err) {
      if (!err) return;
      let lastAsst = null;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].kind === "assistant" && !state.messages[i].notice) {
          lastAsst = state.messages[i];
          break;
        }
      }
      const errObj = {
        message: err.message || String(err),
        provider: err.provider,
        model: err.model,
        httpStatus: err.httpStatus,
        retryable: Boolean(err.retryable),
        // omp 19: "cost_cap" = session.maxCost reached (no provider involved).
        code: typeof err.code === "string" ? err.code : undefined,
      };
      if (lastAsst) {
        lastAsst.error = errObj;
        lastAsst.streaming = false;
        if (rt.session.streamingBubble === lastAsst) {
          rt.session.streamingBubble = null;
        }
      } else {
        const errBubble = {
          kind: "assistant",
          time: window.timeNow(),
          thought: null,
          lead: null,
          blocks: [],
          streaming: false,
          model: state.model?.name ?? "–",
          error: errObj,
        };
        state.messages = [...state.messages, errBubble];
      }
    }

    function onPromptResult(ev) {
      if (ev.sessionSettled !== undefined) {
        state.isSettled = Boolean(ev.sessionSettled);
        if (ev.sessionSettled) {
          state.hasPendingAsyncWork = false;
        }
      }
      if (ev.status === "error" && ev.error) {
        applyPromptError(ev.error);
      }
      notify();
    }

    return {
      handlers: {
        session_info_update:     onSessionInfoUpdate,
        thinking_level_changed:  onThinkingLevelChanged,
        turn_start:              onTurnStart,
        turn_end:                onTurnEnd,
        message_start:           onMessageStart,
        message_update:          onMessageUpdate,
        message_end:             onMessageEnd,
        manual_compaction_start: onManualCompactionStart,
        manual_compaction_end:   onManualCompactionEnd,
        agent_start:             onAgentBoundary,
        agent_end:               onAgentBoundary,
        session_settled:         onSessionSettled,
        prompt_result:           onPromptResult,
      },
    };
  }

  window._Live.EventsMessage = { create };
})();
