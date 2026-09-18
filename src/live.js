/* live.js — Tauri IPC bridge + OMP_BRIDGE + OMP_DATA initialisation.
   Depends on: adapter.js (must load first).
   Exposes: window.OMP_DATA (for design components), window.OMP_BRIDGE (for app-live.jsx).

   Each tab owns one omp process (one session). Switching tabs switches the active
   session — state is re-fetched from omp on every activation.

   Two modes:
     Tauri mode  — window.__TAURI__ present → per-session omp processes via IPC
     Demo mode   — no Tauri → leaves OMP_DATA at empty defaults, no connection */

(function () {
  "use strict";
  const { timeNow } = window;

  // ── Safe defaults so design components never crash on missing fields ──────
  const DEFAULT_DATA = {
    projects: [],
    messages: [],
    kanban: [],
    planMeta: { ask: "", strategy: "", touches: [], branch: "main", risks: [], estimate: { tokens: "—", cost: "—", wall: "—" } },
    commands: [
      { name: "plan",     hint: "draft a plan before writing code",   icon: "◇", group: "Mode"    },
      { name: "steer",    hint: "interrupt and redirect mid-tool",    icon: "↺", group: "Mode"    },
      { name: "compact",  hint: "compact context window",             icon: "▤", group: "Session" },
      { name: "new",      hint: "start a fresh session (history kept on disk)", icon: "↺", group: "Session" },
      { name: "history",  hint: "browse and resume saved sessions",   icon: "clock", group: "Session" },
      { name: "model",    hint: "switch model",                       icon: "◉", group: "Agent"   },
      { name: "models",   hint: "manage custom models (models.yml)",  icon: "cpu", group: "Agent" },
      { name: "thinking", hint: "cycle thinking level",               icon: "✶", group: "Agent"   },
      { name: "login",    hint: "authenticate with a model provider",   icon: "⊙", group: "Agent"   },
      { name: "todo",     hint: "open the kanban surface",            icon: "▦", group: "View"    },
      { name: "export",   hint: "export this session to HTML",        icon: "⇪", group: "View"    },
    ],
    models: [],
    activity: [],
    ctx: { used: 0, total: 200000, pct: 0, label: "0 / 200k", cost: "$0.00", tokensPerSec: 0 },
    peer: null,
    microcopy: {
      empty:        "Hand me a project. I'll set the table.",
      streamingTip: "Press ⎋ to interrupt — your cursor is in the room.",
      paletteTip:   "type / to give orders · ⌘K opens the bridge",
      planTip:      "describe what to build, or give feedback on the plan…",
      todoEmpty:    "no plan yet. think out loud below.",
      radarHint:    "agent has been busy — last 60 seconds",
    },
  };

  window.OMP_DATA = JSON.parse(JSON.stringify(DEFAULT_DATA));

  // ── Active session state ───────────────────────────────────────────────────
  // These are the "current session's" live variables. _resetSessionVars() wipes
  // them and _switchToSession() swaps them when the active tab changes.
  const state = {
    messages:       [],
    isStreaming:    false,
    model:          null,
    thinkingLevel:  null,
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
  };

  let streamingBubble = null;
  let activeToolCards = new Map();    // toolCallId → message index
  let pendingAskBubble = null;   // buffered until tool_execution_start so order is [tool_card, ask_bubble]
  let tpsSamples      = Array(30).fill(0);
  let turnStartTime   = null;
  let activityLog     = [];           // [{ts, toolName}], pruned to 60s
  let _compactBackfillId = null; // compact msg id awaiting tokensAfter back-fill
  let _msgSeq = 0;  // monotonic counter — stable React keys for message bubbles

  // ── Minimap / message-history trim ───────────────────────────────────────
  const MINIMAP_COLS = 13;
  const MINIMAP_MAX  = MINIMAP_COLS * MINIMAP_COLS; // 169 — one full 13×13 grid

  // ── Session registry ───────────────────────────────────────────────────────
  // Tracks all open tabs. The tab list in the UI is derived from this.
  // { id, name, path, color, branch }
  const sessionRegistry = new Map();
  const sessionSnapshots = new Map(); // id -> saved state + volatile vars
  const gitListeners = new Map();  // session_id → Tauri unlisten fn for git://branch/{id}

  let activeSessionId  = null;
  let activeListeners  = [];          // unlisten functions for current session

  // ── Peer session ─────────────────────────────────────────────────────────
  // "Pin" another session so its live activity is visible in the ambient
  // rail card while you work in the active session. Lightweight listener:
  // only tracks activity, TPS, todo progress, and streaming status — no
  // full message history, just enough for the PeerSession widget.
  let peerSessionId   = null;
  let peerListeners   = [];
  let peerTurnStart   = null;
  let _peerNotifyTimer = null;
  const PEER_MAX_TOOLS = 15;
  const peerState = {
    activity:    "idle",
    tps:         0,
    todo:        { done: 0, total: 0 },
    isStreaming:  false,
    title:       "",
    recentTools: [],   // [{id, tool, target, status, duration, time, _startMs}]
    thought:     null, // current thinking text while streaming
  };

  // ── ID-keyed response correlation ─────────────────────────────────────────
  // Used by _sendWithResponse to correlate commands that need a typed reply.
  const _pendingResponses = new Map(); // id → { resolve, reject }
  let _nextCmdId = 1;

  /**
   * Send a command and return a Promise that resolves with the response data
   * or rejects with an Error on failure. Uses the RPC id field for correlation.
   * @param {object}  cmd         Command body (type + args, no id).
   * @param {number}  [timeout]   Ms to wait before rejecting (0 = no timeout).
   */
  function _sendWithResponse(cmd, timeout = 120000) {
    return new Promise((resolve, reject) => {
      if (!window.__TAURI__ || !activeSessionId) {
        reject(new Error("Not connected"));
        return;
      }
      const id = `d${_nextCmdId++}`;
      let timer;
      if (timeout > 0) {
        timer = setTimeout(() => {
          _pendingResponses.delete(id);
          reject(new Error(`Command '${cmd.type}' timed out after ${timeout}ms`));
        }, timeout);
      }
      _pendingResponses.set(id, {
        resolve(data) { clearTimeout(timer); resolve(data); },
        reject(err)   { clearTimeout(timer); reject(err);   },
      });
      _send({ ...cmd, id });
    });
  }

  // ── Subscriber system ─────────────────────────────────────────────────────
  const subscribers = new Set();

  // Drop the oldest row of messages once the 13×13 grid is full and the
  // current turn is complete. Only called from notify() so the trim is
  // always reflected in the same snapshot that React receives.
  // Active tool-card indices are shifted so in-flight updates stay correct;
  // completed cards are already removed from the map and are unaffected.
  function _trimMessages() {
    if (state.isStreaming) return;                  // wait for clean turn boundary
    if (state.messages.length <= MINIMAP_MAX) return;
    const drop = MINIMAP_COLS;                      // evict one full row (13)
    state.messages = state.messages.slice(drop);
    for (const [id, idx] of activeToolCards) {
      const shifted = idx - drop;
      if (shifted < 0) activeToolCards.delete(id); // guard: possible on abort (no tool_execution_end)
      else activeToolCards.set(id, shifted);
    }
  }

  function notify() {
    _trimMessages();
    // Stamp stable IDs on any message that doesn't have one yet (new pushes,
    // restored sessions, or messages from get_messages). O(N) but N ≤ 169 and
    // is a no-op for already-stamped entries — essentially free.
    for (const m of state.messages) {
      if (!m._id) m._id = ++_msgSeq;
    }
    const snap = {
      messages:        state.messages,
      isStreaming:     state.isStreaming,
      model:           state.model,
      thinkingLevel:   state.thinkingLevel,
      ctx:             state.ctx,
      kanban:          state.kanban,
      planMeta:        state.planMeta,
      models:          state.models,
      activity:        state.activity,
      sparkline:       state.sparkline,
      // Tab list — derived from session registry, not per-session state
      sessions:        [...sessionRegistry.values()],
      activeSessionId,
      // Peer — null when no session is pinned
      peer:            _buildPeerData(),
      peerSessionId,
      // Agent activity — running tools + turn clock for the status card
      runningTools:    state.runningTools,
      recentTools:     state.recentTools,
      turnStartMs:     state.turnStartMs,
    };
    subscribers.forEach(cb => cb(snap));

    // Keep OMP_DATA in sync for design components that read it directly
    window.OMP_DATA.messages  = state.messages;
    window.OMP_DATA.models    = state.models;
    window.OMP_DATA.kanban    = state.kanban;
    window.OMP_DATA.planMeta  = state.planMeta;
    window.OMP_DATA.ctx       = state.ctx;
    window.OMP_DATA.activity  = state.activity;
    window.OMP_DATA.peer      = _buildPeerData();
  }

  // Reset all per-session volatile state (called before loading a new session)
  function _resetSessionVars() {
    Object.assign(state, {
      messages:      [],
      isStreaming:   false,
      model:         null,
      thinkingLevel: null,
      ctx:           { ...DEFAULT_DATA.ctx },
      kanban:        [],
      planMeta:      { ...DEFAULT_DATA.planMeta },
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
    });
    streamingBubble = null;
    pendingAskBubble = null;
    activeToolCards = new Map();
    tpsSamples      = Array(30).fill(0);
    turnStartTime   = null;
    _compactBackfillId = null;
    activityLog     = [];
  }

  // ── Session snapshot helpers ──────────────────────────────────────────────
  function _saveCurrentSession() {
    if (!activeSessionId) return;
    sessionSnapshots.set(activeSessionId, {
      // state fields
      messages:      state.messages,
      isStreaming:   state.isStreaming,
      model:         state.model,
      thinkingLevel: state.thinkingLevel,
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
      // volatile vars
      streamingBubble,
      activeToolCards: new Map(activeToolCards),
      tpsSamples:    [...tpsSamples],
      turnStartTime,
      activityLog:   [...activityLog],
    });
  }

  function _restoreSession(id) {
    const snap = sessionSnapshots.get(id);
    if (!snap) return false;
    Object.assign(state, {
      messages:      snap.messages,
      isStreaming:   snap.isStreaming,
      model:         snap.model,
      thinkingLevel: snap.thinkingLevel,
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
    });
    streamingBubble = snap.streamingBubble;
    activeToolCards = snap.activeToolCards;
    tpsSamples      = snap.tpsSamples;
    turnStartTime   = snap.turnStartTime;
    activityLog     = snap.activityLog;
    return true;
  }

  // ── Peer session helpers ────────────────────────────────────────────────
  function _buildPeerData() {
    if (!peerSessionId) return null;
    const entry = sessionRegistry.get(peerSessionId);
    if (!entry) return null;
    return {
      projectId:   peerSessionId,
      project:     entry.name,
      activity:    peerState.activity || "idle",
      tps:         peerState.tps,
      todo:        { ...peerState.todo },
      title:       peerState.title || "—",
      isStreaming:  peerState.isStreaming,
      recentTools: peerState.recentTools,
      thought:     peerState.thought,
    };
  }

  function _sendTo(sessionId, cmd) {
    if (!window.__TAURI__ || !sessionId) return;
    window.__TAURI__.core
      .invoke("send_command", { sessionId, json: JSON.stringify(cmd) })
      .catch(e => console.error("[live] sendTo error:", e));
  }

  async function _startPeerListening(id) {
    _stopPeerListening();
    if (!window.__TAURI__ || !id) return;
    Object.assign(peerState, {
      activity: "idle", tps: 0,
      todo: { done: 0, total: 0 },
      isStreaming: false, title: "",
      recentTools: [], thought: null,
    });
    peerTurnStart = null;
    const { listen } = window.__TAURI__.event;
    const ulLine = await listen(`agent://line/${id}`, ev => _handlePeerLine(ev.payload));
    const ulExit = await listen(`agent://exit/${id}`, () => {
      peerState.isStreaming = false;
      peerState.activity = "exited";
      _debouncedPeerNotify();
    });
    peerListeners = [ulLine, ulExit];
    // Fetch initial state so the card shows current todo/streaming status
    _sendTo(id, { type: "get_state" });
  }

  function _stopPeerListening() {
    for (const ul of peerListeners) { try { ul(); } catch (_) {} }
    peerListeners = [];
    if (_peerNotifyTimer) { clearTimeout(_peerNotifyTimer); _peerNotifyTimer = null; }
  }

  // Throttled peer notify — at most 10 updates/sec to avoid flooding React
  function _debouncedPeerNotify() {
    if (_peerNotifyTimer) return;
    _peerNotifyTimer = setTimeout(() => {
      _peerNotifyTimer = null;
      window.OMP_DATA.peer = _buildPeerData();
      notify();
    }, 100);
  }

  function _handlePeerLine(rawLine) {
    let obj;
    try { obj = JSON.parse(rawLine); } catch { return; }
    if (!obj || typeof obj !== "object") return;
    const { type } = obj;
    let changed = false;

    // Re-fetch state when peer omp restarts
    if (type === "ready") {
      _sendTo(peerSessionId, { type: "get_state" });
      return;
    }

    if (type === "turn_start") {
      peerState.isStreaming = true;
      peerState.thought = null;
      peerTurnStart = Date.now();
      changed = true;
    } else if (type === "turn_end") {
      peerState.isStreaming = false;
      peerState.thought = null;
      const usage = obj.message?.usage;
      if (peerTurnStart && usage?.output) {
        const elapsed = (Date.now() - peerTurnStart) / 1000;
        if (elapsed > 0) peerState.tps = Math.round(usage.output / elapsed);
      }
      peerTurnStart = null;
      changed = true;
    } else if (type === "tool_execution_start") {
      const tool = window.normalizeToolName(obj.toolName ?? "");
      const args = (typeof obj.args === "object" && obj.args) ? obj.args : {};
      const target = args.path ?? args.pattern ?? args.command ?? args.query ?? "";
      const short = target ? String(target).split(/[\\/]/).pop() : "";
      peerState.activity = short ? `${tool} · ${short}` : tool;
      // Append to recentTools (rolling window)
      peerState.recentTools = [
        ...peerState.recentTools.slice(-(PEER_MAX_TOOLS - 1)),
        { id: obj.toolCallId, tool, target: short || String(target), status: "running",
          duration: null, time: timeNow(), _startMs: Date.now() },
      ];
      changed = true;
    } else if (type === "tool_execution_end") {
      // Update the matching tool entry's status and duration
      const now = Date.now();
      peerState.recentTools = peerState.recentTools.map(t =>
        t.id === obj.toolCallId
          ? { ...t, status: "ok", duration: t._startMs ? now - t._startMs : null }
          : t
      );
      if (obj.toolName === "todo_write") {
        const phases = obj.result?.details?.phases ?? obj.result?.phases ?? [];
        if (phases.length > 0) {
          let done = 0, total = 0;
          for (const p of phases) {
            for (const t of p.tasks) { total++; if (t.status === "completed" || t.status === "abandoned") done++; }
          }
          peerState.todo = { done, total };
        }
      }
      changed = true;
    } else if (type === "message_update" && obj.message) {
      const blocks = Array.isArray(obj.message.content) ? obj.message.content : [];
      let foundThought = false;
      for (const b of blocks) {
        if (b.type === "thinking" && b.thinking?.trim()) {
          peerState.thought = b.thinking.trim();
          foundThought = true;
        }
        if (b.type === "text" && b.text?.trim()) {
          peerState.title = b.text.trim().slice(0, 120);
          changed = true;
        }
      }
      if (foundThought) changed = true;
    } else if (type === "response" && obj.command === "get_state" && obj.success && obj.data) {
      const d = obj.data;
      if (d.todoPhases?.length > 0) {
        let done = 0, total = 0;
        for (const p of d.todoPhases) {
          for (const t of p.tasks) { total++; if (t.status === "completed" || t.status === "abandoned") done++; }
        }
        peerState.todo = { done, total };
      }
      if (d.isStreaming != null) peerState.isStreaming = d.isStreaming;
      if (d.sessionName) peerState.title = d.sessionName;
      changed = true;
    }

    if (changed) _debouncedPeerNotify();
  }

  // ── Session switching ─────────────────────────────────────────────────────
  async function _switchToSession(id) {
    if (!window.__TAURI__) return;

    // Auto-clear peer if switching to the peer tab (redundant to monitor yourself)
    if (id === peerSessionId) {
      _stopPeerListening();
      peerSessionId = null;
    }

    // Snapshot current session so we can restore it when switching back
    _saveCurrentSession();

    // Tear down old listeners
    for (const ul of activeListeners) { try { await ul(); } catch (_) {} }
    activeListeners = [];

    activeSessionId = id;

    // Restore cached snapshot (preserves streaming messages) or start fresh
    if (!_restoreSession(id)) {
      _resetSessionVars();
    }

    const { listen } = window.__TAURI__.event;
    const ulLine = await listen(`agent://line/${id}`, ev => handleLine(ev.payload));
    const ulExit = await listen(`agent://exit/${id}`, ev => {
      const reason = (ev?.payload && String(ev.payload).trim()) || "";
      console.warn(`[live] session '${id}' omp process exited${reason ? ": " + reason : ""}`);
      state.isStreaming = false;
      if (reason) {
        state.messages.push({
          kind: "assistant",
          time: timeNow(),
          text: `**Agent process exited:** ${reason}`,
          completed: true,
        });
      }
      notify();
    });
    activeListeners = [ulLine, ulExit];

    // Surface any cached startup error for this session. Tauri starts
    // the default session in setup() before the frontend can attach
    // listeners, so a spawn failure (e.g. omp not on PATH) would
    // otherwise be invisible. session_status returns the cached error
    // synchronously — no event timing race.
    try {
      const startupError = await window.__TAURI__.core.invoke("session_status", { sessionId: id });
      if (startupError) {
        console.warn(`[live] session '${id}' startup error: ${startupError}`);
        state.messages.push({
          kind: "assistant",
          time: timeNow(),
          text: `**Agent failed to start:** ${startupError}`,
          completed: true,
        });
      }
    } catch (e) {
      console.warn(`[live] session_status query failed:`, e);
    }

    // Re-fetch to pick up events missed while not listening.
    // get_messages handler merges completed turns with the cached streaming bubble.
    _initFetch();
    notify();
  }

  // ── RPC line handler ──────────────────────────────────────────────────────
  function handleLine(rawLine) {
    let obj;
    try { obj = JSON.parse(rawLine); } catch { return; }
    if (!obj || typeof obj !== "object") return;

    const { type } = obj;

    if (type === "ready") {
      console.log(`[live] ready from session '${activeSessionId}'`);
      _initFetch();
      return;
    }

    if (type === "response") { _handleResponse(obj); return; }

    _handleEvent(obj);
  }

  // ── RPC response handler ──────────────────────────────────────────────────
  function _handleResponse(resp) {
    // ID-keyed correlation — resolve or reject the waiting _sendWithResponse call.
    if (resp.id && _pendingResponses.has(resp.id)) {
      const handler = _pendingResponses.get(resp.id);
      _pendingResponses.delete(resp.id);
      if (resp.success) {
        handler.resolve(resp.data ?? null);
      } else {
        handler.reject(new Error(resp.error ?? `Command '${resp.command}' failed`));
      }
      return;
    }
    // Compact — handle success and failure both (must come before early-return below)
    if (resp.command === "compact") {
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
        if (resp.success && compactMsgId) _compactBackfillId = compactMsgId;
      }
      notify();
      // After a successful compact the context window shrank — refresh
      // rpcState so the ambient gauge updates immediately rather than
      // waiting for the next turn_end.
      if (resp.success) {
        _send({ type: "get_state" });
      }
      return;
    }
    if (!resp.success) {
      if (resp.command === "set_model") {
        console.warn("[live] set_model failed:", resp.error);
        const errMsg = resp.error || "Failed to switch model";
        state.messages = [...state.messages, {
          kind: "assistant",
          time: timeNow(),
          text: `⚠️ **Model Switch Failed:** ${errMsg}\n\n*Note: If this is a newly added custom model in \`models.yml\`, please open a new tab or restart the session to allow the backend agent to reload the configuration.*`,
          completed: true,
        }];
        notify();
      }
      return;
    }
    const { command, data } = resp;

    if (command === "get_state") {
      _applyRpcState(data);

    } else if (command === "get_messages") {
      const completed = window.adaptAgentMessages(data.messages ?? []);
      // Tool/ask/compact cards exist only in live event state — omp never
      // persists them and get_messages never returns them. Walk the current
      // snapshot in order: preserve tool/ask/compact entries in-place and
      // replace each text entry (user/assistant) with the ground-truth copy
      // from `completed`. Any new turns that arrived while we were on another
      // tab (missed live events) are appended at the end. activeToolCards
      // indices are rebuilt so in-flight tool_execution_update events keep
      // landing on the right array slot.
      const pending = [...completed];
      const merged = [];
      for (const m of state.messages) {
        if (m.streaming) continue; // streaming bubble handled separately below
        if (m.kind === "tool" || m.kind === "ask" || m.kind === "compact") {
          merged.push(m);
        } else if (pending.length > 0) {
          merged.push(pending.shift());
        }
      }
      merged.push(...pending); // turns that completed while we were away
      // Rebuild activeToolCards — new entries may have been appended from pending
      activeToolCards = new Map();
      for (let i = 0; i < merged.length; i++) {
        const m = merged[i];
        if (m.kind === "tool" && m.status === "running" && m._toolCallId) {
          activeToolCards.set(m._toolCallId, i);
        }
      }
      state.messages = streamingBubble ? [...merged, streamingBubble] : merged;
      notify();

    } else if (command === "get_available_models") {
      const rpcModels = (data.models ?? []).map(m => ({
        ..._buildModelEntry(m),
        current:  state.rpcState?.model?.id === m.id || state.model?.id === m.id,
      }));
      _loadCustomModelsFromConfig().then(customData => {
        state.models = _mergeModels(rpcModels, customData);
        notify();
        console.log(`[live] models loaded (${state.models.length} total) for session '${activeSessionId}'`);
      }).catch(() => {
        state.models = rpcModels;
        notify();
      });

    } else if (command === "set_model") {
      if (data) {
        state.model  = _buildModelEntry(data);
        state.models = state.models.map(m => ({ ...m, current: m.id === data.id }));
        notify();
      }

    } else if (command === "cycle_model") {
      if (data?.model) {
        state.model  = _buildModelEntry(data.model);
        if (data.thinkingLevel != null) state.thinkingLevel = data.thinkingLevel;
        state.models = state.models.map(m => ({ ...m, current: m.id === data.model.id }));
        notify();
      }

    } else if (command === "cycle_thinking_level") {
      if (data?.level != null) {
        // omp reported the new level — use it.
        state.thinkingLevel = data.level;
      } else {
        // omp didn't report a level (null response). Cycle client-side
        // through the practical tiers and push the choice via set_thinking_level.
        const LEVELS = ["off", "low", "medium", "high"];
        const idx = LEVELS.indexOf(state.thinkingLevel);
        const next = LEVELS[(idx + 1) % LEVELS.length];
        state.thinkingLevel = next;
        _send({ type: "set_thinking_level", level: next });
      }
      notify();

    } else if (command === "new_session") {
      // New session started — clear local state and re-fetch
      _resetSessionVars();
      _initFetch();
      notify();

    } else if (command === "get_session_stats") {
      // SessionStats — no display action needed
    }
  }

  function _buildModelEntry(m) {
    return {
      id:       m.id,
      name:     m.name ?? window.MODEL_NAMES?.[m.id] ?? window.formatModelId(m.id),
      provider: m.provider,
      note:     m.provider,
      latency:  0,
      current:  true,
      input:    m.input,
    };
  }

  // ── AgentSessionEvent handler ─────────────────────────────────────────────
  function _handleEvent(ev) {
    const { type } = ev;
    const now  = Date.now();
    const time = timeNow();


    if (type === "extension_ui_request") {
      // URL to open in the system browser (e.g. OAuth auth page).
      if (ev.method === "open_url") {
        // In Tauri, window.open() creates a webview rather than opening the system
        // browser. Use the open_url_external Rust command (open crate → ShellExecute
        // on Windows) so OAuth URLs open in the user's actual browser.
        if (window.__TAURI__) {
          window.__TAURI__.core.invoke("open_url_external", { url: ev.url }).catch(e => {
            console.error("[live] open_url_external failed:", e);
          });
        } else {
          window.open(ev.url, "_blank");
        }
        if (ev.instructions) {
          state.messages = [
            ...state.messages,
            {
              kind: "assistant", time: timeNow(),
              model: state.model?.name ?? null,
              blocks: [{ type: "text", text: ev.instructions }],
              thought: null, lead: null, streaming: false, completed: true,
            },
          ];
          notify();
        }
        return;
      }
      // Code / text prompt (e.g. OAuth manual-code flows).
      if (ev.method === "input") {
        const value = window.prompt(ev.title ?? ev.placeholder ?? "Enter value:");
        if (value !== null) {
          _send({ type: "extension_ui_response", id: ev.id, value });
        } else {
          _send({ type: "extension_ui_response", id: ev.id, cancelled: true });
        }
        return;
      }
      // Agent asks the user to pick from a list.
      // Buffered in pendingAskBubble instead of pushed immediately — omp emits
      // extension_ui_request.select BEFORE tool_execution_start, so pushing now
      // would place the ask bubble above the tool card. tool_execution_start
      // flushes it so the order is always [tool_card, ask_bubble].
      if (ev.method === "select") {
        const OTHER_OPT = "Other (type your own)";
        pendingAskBubble = {
          kind: "ask",
          id: ev.id,
          time: timeNow(),
          title: ev.title,
          options: (ev.options ?? []).filter(o => o !== OTHER_OPT),
          answered: false,
          cancelled: false,
          answer: null,
        };
        return;
      }
      // Agent cancelled a pending UI request (e.g. turn aborted while waiting for input).
      if (ev.method === "cancel") {
        // If the ask was cancelled before tool_execution_start flushed it, just drop it.
        if (pendingAskBubble && pendingAskBubble.id === ev.targetId) {
          pendingAskBubble = null;
          return;
        }
        state.messages = state.messages.map(m =>
          m.kind === "ask" && m.id === ev.targetId && !m.answered
            ? { ...m, cancelled: true }
            : m
        );
        notify();
        return;
      }
      // Dialogs we cannot show — cancel them so the server doesn't hang.
      const NEEDS_RESPONSE = ["confirm", "editor"];
      if (NEEDS_RESPONSE.includes(ev.method)) {
        _send({ type: "extension_ui_response", id: ev.id, cancelled: true });
      }
      return;
    }

    // ── Turn lifecycle ────────────────────────────────────────────────────────
    if (type === "turn_start") {
      turnStartTime = now;
      state.isStreaming = true;
      state.turnStartMs = now;
      state.runningTools = [];
      notify();
      return;
    }

    if (type === "turn_end") {
      state.isStreaming = false;
      state.turnStartMs = null;
      state.runningTools = [];
      streamingBubble = null;
      const usage = ev.message?.usage;
      if (turnStartTime) {
        const elapsed   = (now - turnStartTime) / 1000;
        const outTokens = usage?.output ?? 0;
        if (elapsed > 0 && outTokens > 0) {
          const tps = outTokens / elapsed;
          tpsSamples.push(Math.round(tps));
          tpsSamples.shift();
          state.currentTps = tps;
          state.sparkline  = [...tpsSamples];
        }
      }
      if (usage?.cost?.total) {
        state.sessionCost = (state.sessionCost ?? 0) + usage.cost.total;
        _refreshCtx();
      }
      _send({ type: "get_session_stats" });
      _send({ type: "get_state" });
      notify();
      return;
    }

    // ── Message lifecycle ─────────────────────────────────────────────────────
    if (type === "message_start") {
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
          notify();
        }
      } else if (role === "assistant") {
        streamingBubble = {
          kind: "assistant", time,
          thought: null, lead: null,
          blocks: [{ type: "text", text: "" }],
          streaming: true,
          model: state.model?.name ?? "–",
        };
        state.messages = [...state.messages, streamingBubble];
        notify();
      }
      return;
    }

    if (type === "message_update") {
      if (!streamingBubble) return;
      const msg = ev.message;
      if (!msg) return;

      const blocks = Array.isArray(msg.content) ? msg.content : [];
      let thought = null;
      const designBlocks = [];
      for (const block of blocks) {
        if (block.type === "thinking" && block.thinking?.trim()) thought = block.thinking;
        else if (block.type === "text" && block.text) designBlocks.push({ type: "text", text: block.text });
      }

      streamingBubble.thought = thought;
      streamingBubble.lead    = thought ? "thinking" : null;
      streamingBubble.blocks  = designBlocks.length > 0 ? designBlocks : [{ type: "text", text: "" }];

      const updated = { ...streamingBubble, blocks: [...streamingBubble.blocks] };
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
      return;
    }

    if (type === "message_end") {
      const msg = ev.message;
      const usage = msg?.usage;
      const tokens = usage ? ((usage.input ?? 0) + (usage.output ?? 0)) : null;
      if (streamingBubble && msg) {
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const thought = blocks.find(b => b.type === "thinking")?.thinking ?? streamingBubble.thought;
        const designBlocks = blocks.filter(b => b.type === "text" && b.text?.trim()).map(b => ({ type: "text", text: b.text }));
        // Find by streaming flag — extension_ui_request.select may have pushed
        // an ask bubble after the streaming bubble before message_end arrives.
        const completed = {
          ...streamingBubble,
          streaming: false, thought,
          lead:   thought ? "thinking" : null,
          blocks: designBlocks.length > 0 ? designBlocks : streamingBubble.blocks,
          tokens,
          tokensIn:  usage?.input  ?? null,
          tokensOut: usage?.output ?? null,
        };
        const eidx = state.messages.findLastIndex(m => m.streaming === true);
        if (eidx !== -1) {
          const msgs = [...state.messages];
          msgs[eidx] = completed;
          state.messages = msgs;
        } else {
          state.messages = [...state.messages.slice(0, -1), completed];
        }
        streamingBubble = null;
      } else if (streamingBubble) {
        const completed2 = { ...streamingBubble, streaming: false, tokens };
        const eidx2 = state.messages.findLastIndex(m => m.streaming === true);
        if (eidx2 !== -1) {
          const msgs = [...state.messages];
          msgs[eidx2] = completed2;
          state.messages = msgs;
        } else {
          state.messages = [...state.messages.slice(0, -1), completed2];
        }
        streamingBubble = null;
      }
      notify();
      return;
    }

    // ── Tool execution ────────────────────────────────────────────────────────
    if (type === "tool_execution_start") {
      const card = window.buildToolStartCard(ev, time);
      const idx  = state.messages.length;
      activeToolCards.set(ev.toolCallId, idx);
      state.messages = [...state.messages, card];
      // Track running tool for the agent activity card
      const toolName = window.normalizeToolName(ev.toolName ?? "");
      const args = (typeof ev.args === "object" && ev.args) ? ev.args : {};
      const rawTarget = args.path ?? args.pattern ?? args.command ?? args.query ?? "";
      const shortTarget = rawTarget ? String(rawTarget).split(/[\\/]/).pop() : "";
      state.runningTools = [...state.runningTools, {
        id: ev.toolCallId, tool: toolName, target: shortTarget || String(rawTarget), startMs: now,
      }];
      // Flush any pending ask bubble AFTER the tool card so chat order is
      // [tool_card, ask_bubble] — omp emits select before tool_execution_start.
      if (pendingAskBubble) {
        state.messages = [...state.messages, pendingAskBubble];
        pendingAskBubble = null;
      }

      activityLog.push({ ts: now, toolName: ev.toolName ?? "" });
      const cutoff = now - 60_000;
      while (activityLog.length && activityLog[0].ts < cutoff) activityLog.shift();
      state.activity = window.buildActivityFromLog(activityLog);
      notify();
      return;
    }

    if (type === "tool_execution_update") {
      const idx = activeToolCards.get(ev.toolCallId);
      if (idx !== undefined) {
        const card = state.messages[idx];
        if (card?.kind === "tool") {
          const updated = window.updateToolCard(card, ev);
          const msgs = [...state.messages];
          msgs[idx] = updated;
          state.messages = msgs;
          notify();
        }
      }
      return;
    }

    if (type === "tool_execution_end") {
      // Move the finished tool into the recent-tools trail (keep last 3)
      const RECENT_MAX = 3;
      const finished = state.runningTools.find(t => t.id === ev.toolCallId);
      state.runningTools = state.runningTools.filter(t => t.id !== ev.toolCallId);
      if (finished) {
        state.recentTools = [...state.recentTools, {
          id: finished.id, tool: finished.tool, target: finished.target,
          durationMs: now - finished.startMs,
        }].slice(-RECENT_MAX);
      }
      const idx = activeToolCards.get(ev.toolCallId);
      if (idx !== undefined) {
        const card = state.messages[idx];
        if (card?.kind === "tool") {
          const updated = window.finalizeToolCard(card, ev);
          const msgs    = [...state.messages];
          msgs[idx]     = updated;
          state.messages = msgs;
          activeToolCards.delete(ev.toolCallId);
          if (ev.toolName === "todo_write") {
            const phases = ev.result?.details?.phases ?? ev.result?.phases ?? [];
            if (phases.length > 0) {
              state.kanban   = window.buildKanban(phases);
              state.planMeta = window.buildPlanMeta(phases, state.rpcState);
              _injectInlinePlan(phases);
            }
          }
        }
        notify();
      }
      return;
    }

    if (type === "agent_start" || type === "agent_end") {
      _send({ type: "get_state" });
    }
  }

  function _injectInlinePlan(phases) {
    const idx = [...state.messages].reverse().findIndex(m => m.kind === "assistant");
    if (idx === -1) return;
    const realIdx = state.messages.length - 1 - idx;
    const msg     = state.messages[realIdx];
    if (msg.blocks?.some(b => b.type === "plan")) return;
    const planBlock = {
      type: "plan", title: "Plan",
      phases: phases.map(ph => ({
        id: ph.name, label: ph.name,
        tasks: ph.tasks.map((t, i) => ({
          id: `${ph.name}-${i}`, text: t.content,
          status: (t.status === "completed" || t.status === "abandoned") ? "done" : t.status,
        })),
      })),
    };
    const msgs    = [...state.messages];
    msgs[realIdx] = { ...msg, blocks: [...(msg.blocks ?? []), planBlock] };
    state.messages = msgs;
  }

  function _applyRpcState(rpcState) {
    if (!rpcState) return;
    state.rpcState      = rpcState;
    state.isStreaming   = rpcState.isStreaming ?? false;
    // If the turn completed while we were away (snapshot had streamingBubble
    // with streaming:true, but omp now says isStreaming:false), retire the
    // bubble immediately. The completed text arrives with get_messages; the
    // stale ghost is removed from state.messages here so the minimap doesn't
    // show a pulsating cell until get_messages lands.
    if (!state.isStreaming && streamingBubble) {
      streamingBubble = null;
      state.messages = state.messages.filter(m => !m.streaming);
    }
    if (!state.isStreaming) {
      state.turnStartMs  = null;
      state.runningTools = [];
    }
    state.thinkingLevel = state.thinkingLevel ?? rpcState.thinkingLevel ?? "off";

    if (rpcState.model) {
      state.model = _buildModelEntry(rpcState.model);
    }
    if (rpcState.model && state.models.length > 0) {
      state.models = state.models.map(m => ({ ...m, current: m.id === rpcState.model.id }));
    }
    if (rpcState.todoPhases?.length > 0) {
      state.kanban   = window.buildKanban(rpcState.todoPhases);
      state.planMeta = window.buildPlanMeta(rpcState.todoPhases, rpcState);
    }

    // Only update the tab name if omp provides an explicit human-readable
    // sessionName. The sessionFile is a timestamp ID — leave the folder-based
    // name set at tab-open time intact when sessionName is absent.
    if (rpcState.sessionName && activeSessionId && sessionRegistry.has(activeSessionId)) {
      const entry = sessionRegistry.get(activeSessionId);
      sessionRegistry.set(activeSessionId, { ...entry, name: rpcState.sessionName });
    }

    // Back-fill tokensAfter for a just-completed compact message.
    // The compact response itself only carries tokensBefore; the post-compact
    // token count comes from the get_state response that we trigger right
    // after a successful compact. _compactBackfillId ensures we only patch the
    // right message and only once (prevents stale back-fills from later
    // get_state calls after new turns have grown the context again).
    if (_compactBackfillId != null) {
      const afterTokens = rpcState?.contextUsage?.tokens;
      if (afterTokens != null) {
        const cid = _compactBackfillId;
        _compactBackfillId = null;
        state.messages = state.messages.map(m =>
          m.kind === "compact" && m.id === cid ? { ...m, tokensAfter: afterTokens } : m
        );
      }
    }

    _refreshCtx();
    notify();
  }

  function _refreshCtx() {
    state.ctx = window.buildCtx(state.rpcState, state.sessionCost, state.currentTps);
  }

  async function _loadCustomModelsFromConfig() {
    if (!window.__TAURI__) return { customModels: [], customProviders: new Set() };
    try {
      const res = await window.__TAURI__.core.invoke("read_models_config");
      if (!res?.content || !window.YamlUtil?.parseModelsYaml) {
        return { customModels: [], customProviders: new Set() };
      }
      const parsed = window.YamlUtil.parseModelsYaml(res.content);
      const customModels = [];
      const providers = parsed?.providers || {};
      const customProviders = new Set(Object.keys(providers));

      for (const [providerName, pConfig] of Object.entries(providers)) {
        if (!pConfig || !Array.isArray(pConfig.models)) continue;
        for (const m of pConfig.models) {
          if (!m || !m.id) continue;
          customModels.push({
            id:            m.id,
            name:          m.name || m.id,
            provider:      providerName,
            note:          providerName,
            latency:       0,
            current:       state.rpcState?.model?.id === m.id || state.model?.id === m.id,
            contextWindow: m.contextWindow,
            maxTokens:     m.maxTokens,
            reasoning:     !!m.reasoning,
            input:         m.input ?? (m.images ? ["text", "image"] : ["text"]),
          });
        }
      }
      return { customModels, customProviders };
    } catch (e) {
      console.warn("[live] Failed to read models.yml for custom models:", e);
      return { customModels: [], customProviders: new Set() };
    }
  }

  function _mergeModels(baseList, { customModels }) {
    const modelKey = m => `${m.provider || ""}/${m.id || ""}`;
    const customMap = new Map((customModels || []).map(m => [modelKey(m), m]));

    // Retain all base models (including OAuth & builtins), enriching matching ones with custom metadata
    const merged = (baseList || []).map(m => {
      const key = modelKey(m);
      if (customMap.has(key)) {
        const custom = customMap.get(key);
        customMap.delete(key);
        return { ...m, ...custom };
      }
      return m;
    });

    // Append any additional custom models not present in baseList
    for (const cm of customMap.values()) {
      merged.push(cm);
    }
    return merged;
  }

  function _initFetch() {
    _send({ type: "get_state" });
    _send({ type: "get_messages" });
    _send({ type: "get_available_models" });
    _loadCustomModelsFromConfig().then(customData => {
      if (customData.customModels.length > 0) {
        state.models = _mergeModels(state.models, customData);
        notify();
      }
    }).catch(() => {});
  }

  // ── Send a command to the active session's omp ────────────────────────────
  function _send(cmd) {
    if (!window.__TAURI__ || !activeSessionId) return;
    window.__TAURI__.core
      .invoke("send_command", { sessionId: activeSessionId, json: JSON.stringify(cmd) })
      .catch(e => console.error("[live] send error:", e));
  }

  // ── Window chrome (drag + controls) ──────────────────────────────────────
  function _setupWindowChrome() {
    if (!window.__TAURI__) return;
    const { getCurrentWindow } = window.__TAURI__.window;
    const win  = getCurrentWindow();
    const isWin = navigator.userAgent.includes("Windows") || navigator.platform.startsWith("Win");

    // Drag: delegate from document so it works regardless of React render timing.
    // startDragging() must be called synchronously within the mousedown handler.
    document.addEventListener("mousedown", e => {
      if (!e.target.closest(".chrome")) return;
      if (e.target.closest("button, .chrome-lights, .win-controls")) return;
      win.startDragging().catch(() => {});
    });

    if (isWin) {
      document.addEventListener("click", e => {
        if (e.target.closest(".win-min"))        win.minimize();
        else if (e.target.closest(".win-max"))   win.isMaximized().then(m => m ? win.unmaximize() : win.maximize());
        else if (e.target.closest(".win-close")) win.close();
      });
    } else {
      document.addEventListener("click", e => {
        const t = e.target.closest(".light");
        if (!t) return;
        if (t.classList.contains("red"))        win.close();
        else if (t.classList.contains("amber")) win.minimize();
        else if (t.classList.contains("green")) win.isMaximized().then(m => m ? win.unmaximize() : win.maximize());
      });
    }
  }

  // ── OMP_BRIDGE public API ─────────────────────────────────────────────────
  window.OMP_BRIDGE = {
    get isConnected() { return !!window.__TAURI__ && !!activeSessionId; },
    get models()      { return state.models; },
    get activeSessionId() { return activeSessionId; },

    // ── Messaging ────────────────────────────────────────────────────────────
    send(text, images) {
      const userMsg = { kind: "user", time: timeNow(), text, images: images ?? [] };
      state.messages = [...state.messages, userMsg];
      notify();
      _send({ type: "prompt", message: text, images: images ?? [] });
    },
    abort()            { _send({ type: "abort" }); },
    followUp(text)     { _send({ type: "follow_up", message: text }); },
    steer(text) {
      const userMsg = { kind: "user", time: timeNow(), text };
      state.messages = [...state.messages, userMsg];
      notify();
      _send({ type: "steer", message: text, images: [] });
    },
    setModel(model)    { _send({ type: "set_model", provider: model.provider, modelId: model.id }); },
    cycleModel()       { _send({ type: "cycle_model" }); },
    cycleThinking()    { _send({ type: "cycle_thinking_level" }); },
    compact() {
      const id  = "cmpct-" + (_nextCmdId++);
      // Snapshot current context usage as the "before" value so the card
      // always shows a meaningful number even if omp's compact response
      // returns tokensBefore: 0 (observed in some omp versions).
      const preTokens = state.rpcState?.contextUsage?.tokens ?? null;
      state.messages = [...state.messages, { kind: "compact", status: "pending", id, time: timeNow(), tokensBefore: preTokens }];
      notify();
      _send({ type: "compact", id });
    },
    newSession()       { _send({ type: "new_session" }); },
    /** Fork the active session into a new tab by copying the session file.
     *  If `fromMsgIdx` is a number, only the conversation up to (and including)
     *  that UI message index is kept — messages after it are discarded so the
     *  new tab can diverge from an earlier point.  When omitted or null the
     *  entire session is copied (branch from HEAD). */
    async branch(fromMsgIdx = null) {
      if (!window.__TAURI__) return;
      const activeEntry = sessionRegistry.get(activeSessionId);
      const cwd = activeEntry?.path ?? "";

      // Locate the current session's .jsonl on disk.
      let sourcePath = null;
      try {
        const sessions = await window.__TAURI__.core.invoke("list_saved_sessions", { cwd: cwd || null });
        const sessionFile = state.rpcState?.sessionFile;
        if (sessionFile && sessions?.length) {
          const match = sessions.find(s => s.id === sessionFile);
          if (match) sourcePath = match.path;
        }
        if (!sourcePath && sessions?.length) {
          sourcePath = sessions[0].path; // scan returns newest-first
        }
      } catch (e) {
        console.warn("[live] branch: listSavedSessions failed:", e);
      }

      if (!sourcePath) {
        state.messages = [...state.messages, {
          kind: "assistant", time: timeNow(),
          blocks: [{ type: "text", text: "⚠️ **Branch failed:** no saved session found for this project yet. Complete at least one turn so omp persists the session, then try again." }],
          thought: null, lead: null, streaming: false, completed: true,
        }];
        notify();
        return;
      }

      // Map the UI message index to a .jsonl message-event count.
      // In the session file, only user/assistant turns are "message" events;
      // tool cards, ask bubbles, and compact rows are NOT separate events.
      let maxMessages = null;
      if (fromMsgIdx !== null && fromMsgIdx >= 0) {
        maxMessages = 0;
        for (let i = 0; i <= fromMsgIdx && i < state.messages.length; i++) {
          const k = state.messages[i].kind;
          if (k === "user" || k === "assistant") maxMessages++;
        }
        if (maxMessages === 0) maxMessages = null; // fallback to full copy
      }

      try {
        const newPath = await window.__TAURI__.core.invoke("copy_session_file", { sourcePath, maxMessages });

        const id = `session-${Date.now()}`;
        const baseName = activeEntry?.name ?? "session";
        const label = maxMessages !== null ? `${baseName} (fork @${maxMessages})` : `${baseName} (fork)`;
        sessionRegistry.set(id, {
          id, name: label, path: cwd, color: "var(--lilac)", branch: null,
        });
        await window.__TAURI__.core.invoke("start_session", { sessionId: id, cwd, resume: newPath });

        if (cwd) {
          const branchName = await window.__TAURI__.core
            .invoke("start_git_watch", { sessionId: id, path: cwd })
            .catch(() => null);
          const entry = sessionRegistry.get(id);
          if (entry) sessionRegistry.set(id, { ...entry, branch: branchName ?? null });
          const { listen } = window.__TAURI__.event;
          const unlisten = await listen(`git://branch/${id}`, ev => {
            const e = sessionRegistry.get(id);
            if (e) sessionRegistry.set(id, { ...e, branch: ev.payload });
            notify();
          });
          gitListeners.set(id, unlisten);
        }

        await _switchToSession(id);
      } catch (err) {
        console.error("[live] branch failed:", err);
        state.messages = [...state.messages, {
          kind: "assistant", time: timeNow(),
          blocks: [{ type: "text", text: `⚠️ **Branch failed:** ${err?.message ?? String(err)}` }],
          thought: null, lead: null, streaming: false, completed: true,
        }];
        notify();
      }
    },
    exportHtml() {
      (async () => {
        try {
          const data = await _sendWithResponse({ type: "export_html" }, 30000);

          // omp writes the HTML file to disk itself and returns { path: "filename.html" }.
          // Construct the full path from the session's cwd + returned filename.
          const filename = data?.path ?? null;
          if (!filename) {
            state.messages = [...state.messages, {
              kind: "assistant", time: timeNow(),
              blocks: [{ type: "text", text: "⚠️ **Export failed:** omp did not return an export file path." }],
              thought: null, lead: null, streaming: false, completed: true,
            }];
            notify();
            return;
          }

          const activeEntry = sessionRegistry.get(activeSessionId);
          const cwd = activeEntry?.path || "";
          // If the path omp returned is already absolute, use it directly;
          // otherwise join it with the session's working directory.
          const isAbsolute = /^[A-Za-z]:[\\/]|^\//.test(filename);
          const sourcePath = isAbsolute ? filename : (cwd ? `${cwd}/${filename}` : filename);

          const saved = await window.__TAURI__.core.invoke("save_html_export", { sourcePath });
          if (saved) {
            state.messages = [...state.messages, {
              kind: "assistant", time: timeNow(),
              blocks: [{ type: "text", text: "✅ Session exported to HTML." }],
              thought: null, lead: null, streaming: false, completed: true,
            }];
          }
          notify();
        } catch (err) {
          console.warn("[live] exportHtml failed:", err);
          state.messages = [...state.messages, {
            kind: "assistant", time: timeNow(),
            blocks: [{ type: "text", text: `⚠️ **Export failed:** ${err?.message ?? String(err)}` }],
            thought: null, lead: null, streaming: false, completed: true,
          }];
          notify();
        }
      })();
    },

    // ── Peer session ──────────────────────────────────────────────────────
    get peerSessionId() { return peerSessionId; },
    /** Pin another session as the peer to monitor in the ambient rail. */
    setPeer(id) {
      if (!id || id === activeSessionId || !sessionRegistry.has(id)) return;
      peerSessionId = id;
      _startPeerListening(id);
    },
    /** Unpin the peer session. */
    clearPeer() {
      _stopPeerListening();
      peerSessionId = null;
      window.OMP_DATA.peer = null;
      notify();
    },

    async refreshModels() {
      _initFetch();
      const customData = await _loadCustomModelsFromConfig();
      if (customData.customModels.length > 0 || customData.customProviders.size > 0) {
        state.models = _mergeModels(state.models, customData);
        notify();
      }
    },

    // ── Login ─────────────────────────────────────────────────────────────────

    /** Returns the list of OAuth providers and their current auth status. */
    getLoginProviders() {
      return _sendWithResponse({ type: "get_login_providers" });
    },

    /**
     * Trigger OAuth login for a provider.
     * Resolves when login completes (omp opens the auth URL via open_url event).
     * Rejects on failure.
     * @param {string} providerId
     */
    login(providerId) {
      return _sendWithResponse({ type: "login", providerId }, 300000);
    },

    /**
     * Respond to a pending ask bubble (extension_ui_request method=select).
     * Marks the message as answered in state so it survives subsequent notify() calls,
     * then sends the extension_ui_response to omp.
     * @param {string} id     The extension_ui_request id.
     * @param {string} value  The chosen option text or custom typed answer.
     */
    answerAsk(id, value) {
      state.messages = state.messages.map(m =>
        m.kind === "ask" && m.id === id && !m.answered && !m.cancelled
          ? { ...m, answered: true, answer: value }
          : m
      );
      notify();
      _send({ type: "extension_ui_response", id, value });
    },

    /**
     * Push a system-generated assistant message into the session message log.
     * Writes to state.messages (not just React state) so it survives subsequent
     * notify() calls from live event processing (e.g. model registry refresh).
     * @param {string} text  Markdown text.
     */
    addAssistantMessage(text) {
      state.messages = [...state.messages, {
        kind: "assistant",
        time: timeNow(),
        model: state.model?.name ?? null,
        blocks: [{ type: "text", text }],
        thought: null, lead: null, streaming: false, completed: true,
      }];
      notify();
    },

    // ── Session management ───────────────────────────────────────────────────

    /** Open a new tab for the given project folder (or standalone if null/empty). Returns the new session id. */
    async openSession(cwd) {
      const id   = `session-${Date.now()}`;
      let name = "PiDesk";
      if (cwd) {
        name = cwd.replace(/\\/g, "/").split("/").pop() || cwd;
      } else {
        const noProjSessions = [...sessionRegistry.values()].filter(s => !s.path);
        if (noProjSessions.length > 0) {
          // Parse existing names to find the highest number — avoids
          // collisions after closing earlier tabs (e.g. close PiDesk,
          // PiDesk(2) remains, next should be PiDesk(3) not PiDesk(2)).
          let maxNum = 1; // bare "PiDesk" counts as 1
          for (const s of noProjSessions) {
            const m = s.name.match(/^PiDesk\s*\((\d+)\)$/);
            if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
          }
          name = `PiDesk (${maxNum + 1})`;
        }
      }
      const color = cwd ? "var(--lilac)" : "var(--accent)";
      // Register in tab list before starting omp so the tab shows immediately
      // Register with null branch — chip hidden until git resolves
      sessionRegistry.set(id, { id, name, path: cwd ?? "", color, branch: null });
      // Spawn omp for this project
      if (window.__TAURI__) {
        await window.__TAURI__.core.invoke("start_session", {
          sessionId: id, cwd: cwd ?? "",
        });
      }
      // Git: read initial branch and arm the HEAD watcher (fire-and-forget errors)
      if (cwd && window.__TAURI__) {
        const branch = await window.__TAURI__.core
          .invoke("start_git_watch", { sessionId: id, path: cwd })
          .catch(() => null);
        const entry = sessionRegistry.get(id);
        if (entry) sessionRegistry.set(id, { ...entry, branch: branch ?? null });
        // Live updates: re-emitted by Rust whenever .git/HEAD changes
        const { listen } = window.__TAURI__.event;
        const unlisten = await listen(`git://branch/${id}`, ev => {
          const e = sessionRegistry.get(id);
          if (e) sessionRegistry.set(id, { ...e, branch: ev.payload });
          notify();
        });
        gitListeners.set(id, unlisten);
      }
      // Activate
      await _switchToSession(id);
      return id;
    },

    /** Switch the active tab. Resets state and re-fetches from the session's omp. */
    async activateSession(id) {
      if (id === activeSessionId) return;
      if (!sessionRegistry.has(id)) return;
      await _switchToSession(id);
    },

    /** List saved sessions on disk (~/.omp/agent/sessions). */
    async listSavedSessions(cwd = null) {
      if (!window.__TAURI__) return [];
      try {
        const sessions = await window.__TAURI__.core.invoke("list_saved_sessions", { cwd: cwd || null });
        return sessions || [];
      } catch (err) {
        console.error("[live] listSavedSessions error:", err);
        return [];
      }
    },

    /**
     * Permanently delete a saved session from disk.
     * `path` is the full path to the session's `.jsonl` file (from listSavedSessions).
     * The entire parent session folder is removed.
     */
    async deleteSavedSession(path) {
      if (!window.__TAURI__) return;
      await window.__TAURI__.core.invoke("delete_saved_session", { path });
    },

    /** Read models.yml configuration from disk. */
    async readModelsConfig() {
      if (!window.__TAURI__) return { path: "", content: "", exists: false };
      try {
        return await window.__TAURI__.core.invoke("read_models_config");
      } catch (err) {
        console.error("[live] readModelsConfig error:", err);
        throw err;
      }
    },

    /** Write models.yml configuration to disk. */
    async writeModelsConfig(content) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("write_models_config", { content });
      } catch (err) {
        console.error("[live] writeModelsConfig error:", err);
        throw err;
      }
    },

    /** Open models.yml in the system default text editor. */
    async openModelsFile() {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("open_models_file");
      } catch (err) {
        console.error("[live] openModelsFile error:", err);
        throw err;
      }
    },

    /** Open models directory in the file explorer. */
    async openModelsFolder() {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("open_models_folder");
      } catch (err) {
        console.error("[live] openModelsFolder error:", err);
        throw err;
      }
    },

    /** Get application version from Tauri backend. */
    async getAppVersion() {
      if (!window.__TAURI__) return "0.2.4";
      try {
        return await window.__TAURI__.core.invoke("get_app_version");
      } catch (err) {
        console.error("[live] getAppVersion error:", err);
        return "0.2.4";
      }
    },

    /** Resume a saved session into a new tab. */
    async resumeSession(session) {
      if (!session || !session.path) return null;
      const id = `session-${Date.now()}`;
      const cwd = session.cwd || "";
      const name = session.title || (cwd ? cwd.replace(/\\/g, "/").split("/").pop() || cwd : "resumed");
      sessionRegistry.set(id, { id, name, path: cwd, color: "var(--cyan)", branch: null });
      await window.__TAURI__.core.invoke("start_session", {
        sessionId: id,
        cwd: cwd,
        resume: session.path,
      });
      if (cwd) {
        const branch = await window.__TAURI__.core
          .invoke("start_git_watch", { sessionId: id, path: cwd })
          .catch(() => null);
        const entry = sessionRegistry.get(id);
        if (entry) sessionRegistry.set(id, { ...entry, branch: branch ?? null });
        const { listen } = window.__TAURI__.event;
        const unlisten = await listen(`git://branch/${id}`, ev => {
          const e = sessionRegistry.get(id);
          if (e) sessionRegistry.set(id, { ...e, branch: ev.payload });
          notify();
        });
        gitListeners.set(id, unlisten);
      }
      await _switchToSession(id);
      return id;
    },

    /** Close a tab and kill its omp process. */
    async closeSession(id) {
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke("stop_session",   { sessionId: id }).catch(() => {});
        window.__TAURI__.core.invoke("stop_git_watch", { sessionId: id }).catch(() => {});
      }
      const gitUnlisten = gitListeners.get(id);
      if (gitUnlisten) { gitUnlisten(); gitListeners.delete(id); }
      sessionRegistry.delete(id);
      sessionSnapshots.delete(id);
      // Clear peer if closing the peer session
      if (id === peerSessionId) {
        _stopPeerListening();
        peerSessionId = null;
      }
      // If no sessions remain, immediately reset and create a clean default "PiDesk" session
      if (sessionRegistry.size === 0) {
        for (const ul of activeListeners) { try { await ul(); } catch (_) {} }
        activeListeners = [];
        activeSessionId = null;
        _resetSessionVars();
        await this.openSession(null);
        return;
      }

      if (id === activeSessionId) {
        const remaining = [...sessionRegistry.keys()];
        await _switchToSession(remaining[remaining.length - 1]);
      } else {
        notify(); // tab list changed
      }
    },

    /** Open native folder picker and return the chosen path (or null). */
    async pickFolder() {
      if (!window.__TAURI__) return null;
      return window.__TAURI__.core.invoke("open_project");
    },

    /** Subscribe to state snapshots. Returns an unsubscribe function. */
    onUpdate(cb) {
      subscribers.add(cb);
      cb({
        messages:        state.messages,
        isStreaming:     state.isStreaming,
        model:           state.model,
        thinkingLevel:   state.thinkingLevel,
        ctx:             state.ctx,
        kanban:          state.kanban,
        planMeta:        state.planMeta,
        models:          state.models,
        activity:        state.activity,
        sparkline:       state.sparkline,
        sessions:        [...sessionRegistry.values()],
        activeSessionId,
        peer:            _buildPeerData(),
        peerSessionId,
        runningTools:    state.runningTools,
        recentTools:     state.recentTools,
        turnStartMs:     state.turnStartMs,
      });
      return () => subscribers.delete(cb);
    },

    getState() { return state; },
  };

  // ── Connect to Tauri IPC ──────────────────────────────────────────────────
  if (window.__TAURI__) {
    document.documentElement.classList.add("tauri-native");

    // Register the "default" session that lib.rs::setup already started
    sessionRegistry.set("default", {
      id: "default", name: "PiDesk", path: "", color: "var(--accent)", branch: null,
    });

    // Activate it — registers listener + fetches initial state
    _switchToSession("default");

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _setupWindowChrome);
    } else {
      _setupWindowChrome();
    }

    window.__TAURI__.core.invoke("get_app_version")
      .then(v => { window.PIDESK_APP_VERSION = v; window.OMP_APP_VERSION = v; })
      .catch(() => {});

    console.log("[live] Tauri multi-session mode active");
  } else {
    console.log("[live] Demo mode (no Tauri runtime)");
  }

})();
