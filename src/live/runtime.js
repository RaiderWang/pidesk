/* live/runtime.js — shared mutable runtime for live.js and the event modules.

   `state` is the active session's UI-facing state (one object, mutated in place).
   `rt` holds the *re-assigned* variables, grouped by lifecycle so a tab switch
   knows what to do with each group:

     rt.session — per-tab volatile vars, wiped by reset(). save()/restore()
                  carry streamingBubble, activeToolCards, tpsSamples,
                  turnStartTime, activityLog and compactBackfillId (so a compact
                  finished just before a tab switch is still back-filled when its
                  tab is re-activated, and never leaks into another tab). sessionFresh
                  is deliberately not carried: the tab switch sets it explicitly.
     rt.conn    — transport / active-session bookkeeping. Never part of a
                  snapshot and never touched by reset(); a tab switch drops or
                  re-arms it explicitly. (The ask handshake is private to events-ui.)
     rt.seq     — monotonic counters; never reset, so ids stay unique across tabs.

   Const containers (sessionRegistry, sessionSnapshots, the pending set_model
   queue) stay owned by live.js and are injected here.
   Registers window._Live.Runtime; load after defaults.js, before the events-*. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  // ── Minimap / message-history trim ───────────────────────────────────────
  const MINIMAP_COLS = 13;
  const MINIMAP_MAX  = MINIMAP_COLS * MINIMAP_COLS; // 169 — one full 13×13 grid

  function createState(DEFAULT_DATA) {
    return {
      messages:       [],
      isStreaming:    false,
      model:          null,
      thinkingLevel:  null,
      availableThinkingLevels: null,
      ctx:            { ...DEFAULT_DATA.ctx },
      kanban:         [],
      planMeta:       { ...DEFAULT_DATA.planMeta },
      models:         [],
      activity:       [],
      sparkline:      Array(30).fill(0),
      projects:       [],
      rpcState:       null,
      sessionCost:    null,
      currentTps:     0,
      runningTools:   [],   // [{id, tool, target, startMs}] — currently executing tools
      recentTools:    [],   // [{id, tool, target, durationMs}] — last N completed tools (rolling trail)
      turnStartMs:    null, // raw timestamp when current turn started (for elapsed display)
      // ── Agent Hub — subagent tree / task tracking ──────────────────────
      hubMode:    "compact",  // "compact" | "tree" | "summary"
      hubAgents:  [],         // current task's subagent list (from tool_execution_update progress)
      hubTaskId:  null,       // active task tool's toolCallId
      hubHistory: [],         // last 3 completed task results [{taskId, agents, time}]
      agentError: null,       // startup/runtime error reason if omp is not running
      modelsConfigWarning: null, // global: why omp ignored models.yml (schema error), or null
      toolLogs:   {},         // toolCallId -> { id, tool, target, title, command, status, startMs, durationMs, lines }
      hasPendingAsyncWork: false, // omp 18.4+: background jobs or subagents still pending
      isSettled:           true,  // omp 18.4+: true when agent is completely idle with no pending async work
    };
  }

  function createRt() {
    return {
      session: {
        streamingBubble:    null,
        activeToolCards:    new Map(),         // toolCallId → message index
        tpsSamples:         Array(30).fill(0),
        turnStartTime:      null,
        activityLog:        [],                // [{ts, toolName}], pruned to 60s
        compactBackfillId:  null,              // compact msg id awaiting tokensAfter back-fill
        // Not touched by reset()/save()/restore(): _switchToSession sets it per switch.
        sessionFresh:       false,             // true when the active tab started fresh (no snapshot)
      },
      conn: {
        activeSessionId: null,
        activeListeners: [],     // unlisten functions for current session
        agentStarting:   false,  // omp still starting (post-update grace period); not an error
        startWaitSeq:    0,      // bumps per tab switch so a stale startup wait stops
      },
      seq: {
        msg:     0, // stable React keys for message bubbles
        session: 0, // unique session ids across rapid opens
        cmd:     1, // client-generated command ids
      },
    };
  }

  /**
   * @param {object} deps
   * @param {object} deps.defaults          DEFAULT_DATA (live/defaults.js)
   * @param {Map}    deps.sessionRegistry   open tabs
   * @param {Map}    deps.sessionSnapshots  id → saved state + volatile vars
   * @param {Array}  deps.pendingSetModel   in-flight set_model origins (cleared on reset)
   */
  function create({ defaults, sessionRegistry, sessionSnapshots, pendingSetModel }) {
    const state = createState(defaults);
    const rt = createRt();

    // Reset all per-session volatile state (called before loading a new session).
    function reset() {
      pendingSetModel.length = 0;
      Object.assign(state, {
        messages:      [],
        isStreaming:   false,
        model:         null,
        thinkingLevel: null,
        availableThinkingLevels: null,
        ctx:           { ...defaults.ctx },
        kanban:        [],
        planMeta:      { ...defaults.planMeta },
        models:        [],
        activity:      [],
        sparkline:     Array(30).fill(0),
        projects:      [],
        rpcState:      null,
        sessionCost:   null,
        currentTps:    0,
        runningTools:  [],
        recentTools:   [],
        turnStartMs:   null,
        hubMode:       "compact",
        hubAgents:     [],
        hubTaskId:     null,
        hubHistory:    [],
        agentError:    null,
        toolLogs:      {},
        hasPendingAsyncWork: false,
        isSettled:           true,
      });
      const s = rt.session;
      s.streamingBubble   = null;
      s.activeToolCards   = new Map();
      s.tpsSamples        = Array(30).fill(0);
      s.turnStartTime     = null;
      s.compactBackfillId = null;
      s.activityLog       = [];
    }

    function reindexToolCards(targetList = state.messages) {
      const cards = new Map();
      for (let i = 0; i < targetList.length; i++) {
        const m = targetList[i];
        if (m.kind === "tool" && m.status === "running" && m._toolCallId) {
          cards.set(m._toolCallId, i);
        }
      }
      rt.session.activeToolCards = cards;
    }

    // Drop the oldest row of messages once the 13×13 grid is full and the
    // current turn is complete. Only called from prepare() (via notify) so the
    // trim is always reflected in the same snapshot that React receives.
    // Active tool-card indices are shifted so in-flight updates stay correct;
    // completed cards are already removed from the map and are unaffected.
    function trimMessages() {
      if (state.isStreaming) return;                  // wait for clean turn boundary
      if (state.messages.length <= MINIMAP_MAX) return;
      const drop = MINIMAP_COLS;                      // evict one full row (13)
      state.messages = state.messages.slice(drop);
      const cards = rt.session.activeToolCards;
      for (const [id, idx] of cards) {
        const shifted = idx - drop;
        if (shifted < 0) cards.delete(id); // guard: possible on abort (no tool_execution_end)
        else cards.set(id, shifted);
      }
    }

    // Stamp stable IDs on any message that doesn't have one yet (new pushes,
    // restored sessions, or messages from get_messages). O(N) but N ≤ 169 and
    // is a no-op for already-stamped entries — essentially free.
    function stampMessageIds() {
      for (const m of state.messages) {
        if (!m._id) m._id = ++rt.seq.msg;
      }
    }

    /** Trim + stamp: run before building a snapshot for subscribers. */
    function prepare() {
      trimMessages();
      stampMessageIds();
    }

    function buildSnapshot() {
      return {
        messages:        state.messages,
        isStreaming:     state.isStreaming,
        model:           state.model,
        thinkingLevel:   state.thinkingLevel,
        availableThinkingLevels: state.availableThinkingLevels,
        ctx:             state.ctx,
        kanban:          state.kanban,
        planMeta:        state.planMeta,
        models:          state.models,
        activity:        state.activity,
        sparkline:       state.sparkline,
        // Tab list — derived from session registry, not per-session state
        sessions:        [...sessionRegistry.values()],
        activeSessionId: rt.conn.activeSessionId,
        // Peer — null when no session is pinned
        peer:            window.PeerSessionBridge.build(),
        peerSessionId:   window.PeerSessionBridge.id,
        // Agent activity — running tools + turn clock for the status card
        runningTools:    state.runningTools,
        recentTools:     state.recentTools,
        turnStartMs:     state.turnStartMs,
        // Agent Hub — subagent tree / task tracking
        hubMode:         state.hubMode,
        hubAgents:       state.hubAgents,
        hubTaskId:       state.hubTaskId,
        hubHistory:      state.hubHistory,
        agentError:      state.agentError,
        modelsConfigWarning: state.modelsConfigWarning,
        agentStarting:   rt.conn.agentStarting,
        toolLogs:        state.toolLogs,
        hasPendingAsyncWork: state.hasPendingAsyncWork,
        isSettled:       state.isSettled,
      };
    }

    // ── Session snapshot helpers ────────────────────────────────────────────
    function save() {
      const id = rt.conn.activeSessionId;
      if (!id) return;
      const s = rt.session;
      sessionSnapshots.set(id, {
        // state fields
        messages:      state.messages,
        isStreaming:   state.isStreaming,
        model:         state.model,
        thinkingLevel: state.thinkingLevel,
        availableThinkingLevels: state.availableThinkingLevels,
        ctx:           { ...state.ctx },
        kanban:        state.kanban,
        planMeta:      state.planMeta,
        models:        state.models,
        activity:      state.activity,
        sparkline:     [...state.sparkline],
        rpcState:      state.rpcState,
        sessionCost:   state.sessionCost,
        currentTps:    state.currentTps,
        runningTools:  [...state.runningTools],
        recentTools:   [...state.recentTools],
        turnStartMs:   state.turnStartMs,
        hubMode:       state.hubMode,
        hubAgents:     state.hubAgents.map(a => ({
          ...a,
          _stream: (a._stream ?? []).slice(-200), // cap saved stream lines
        })),
        hubTaskId:     state.hubTaskId,
        hubHistory:    state.hubHistory,
        agentError:    state.agentError,
        toolLogs:      { ...state.toolLogs },
        hasPendingAsyncWork: state.hasPendingAsyncWork,
        isSettled:           state.isSettled,
        // volatile vars
        streamingBubble: s.streamingBubble,
        activeToolCards: new Map(s.activeToolCards),
        tpsSamples:    [...s.tpsSamples],
        turnStartTime: s.turnStartTime,
        activityLog:   [...s.activityLog],
        compactBackfillId: s.compactBackfillId,
      });
    }

    function restore(id) {
      const snap = sessionSnapshots.get(id);
      if (!snap) return false;
      Object.assign(state, {
        messages:      snap.messages,
        isStreaming:   snap.isStreaming,
        model:         snap.model,
        thinkingLevel: snap.thinkingLevel,
        availableThinkingLevels: snap.availableThinkingLevels ?? null,
        ctx:           snap.ctx,
        kanban:        snap.kanban,
        planMeta:      snap.planMeta,
        models:        snap.models,
        activity:      snap.activity,
        sparkline:     snap.sparkline,
        rpcState:      snap.rpcState,
        sessionCost:   snap.sessionCost,
        currentTps:    snap.currentTps,
        runningTools:  snap.runningTools ?? [],
        recentTools:   snap.recentTools ?? [],
        turnStartMs:   snap.turnStartMs ?? null,
        hubMode:       snap.hubMode ?? "compact",
        hubAgents:     snap.hubAgents ?? [],
        hubTaskId:     snap.hubTaskId ?? null,
        hubHistory:    snap.hubHistory ?? [],
        agentError:    snap.agentError ?? null,
        toolLogs:      snap.toolLogs ?? {},
        hasPendingAsyncWork: snap.hasPendingAsyncWork ?? false,
        isSettled:           snap.isSettled ?? true,
      });
      const s = rt.session;
      s.streamingBubble = snap.streamingBubble;
      s.activeToolCards = snap.activeToolCards;
      s.tpsSamples      = snap.tpsSamples;
      s.turnStartTime   = snap.turnStartTime;
      s.activityLog     = snap.activityLog;
      s.compactBackfillId = snap.compactBackfillId ?? null;
      return true;
    }

    function refreshCtx() {
      state.ctx = window.buildCtx(state.rpcState, state.sessionCost, state.currentTps);
    }

    function genSessionId() {
      return `session-${Date.now()}-${++rt.seq.session}`;
    }

    function nextCmdId() {
      return rt.seq.cmd++;
    }

    return {
      state, rt,
      reset, save, restore,
      buildSnapshot, prepare, trimMessages, stampMessageIds,
      reindexToolCards, refreshCtx,
      genSessionId, nextCmdId,
    };
  }

  window._Live.Runtime = { create, MINIMAP_COLS, MINIMAP_MAX };
})();
