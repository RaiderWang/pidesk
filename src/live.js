/* live.js — Tauri IPC bridge assembly: OMP_BRIDGE + OMP_DATA.
   Depends on: adapter.js and the live/* modules (defaults, prefs, tauri-api,
   custom-models, runtime, todo-phases, tab-titles, events-ui/tool/message, models,
   response-handlers, session-switch, sessions, session-branch, window-chrome —
   they register on window._Live); all must load first.
   Exposes: window.OMP_DATA (for design components), window.OMP_BRIDGE (for app-live.jsx).

   This file only wires the pieces together: it creates the shared runtime and the
   module instances (injecting every cross-module call), owns the transport
   (_send / _sendWithResponse / handleLine), settleInFlightActions and the public
   OMP_BRIDGE surface. Behaviour lives in live/*.

   Each tab owns one omp process (one session). Switching tabs switches the active
   session — state is re-fetched from omp on every activation.

   Two modes:
     Tauri mode  — window.__TAURI__ present → per-session omp processes via IPC
     Demo mode   — no Tauri → leaves OMP_DATA at empty defaults, no connection */

(function () {
  "use strict";
  const { timeNow } = window;

  // ── Safe defaults so design components never crash on missing fields ──────
  // (data lives in live/defaults.js)
  const DEFAULT_DATA = window._Live.Defaults;

  window.OMP_DATA = JSON.parse(JSON.stringify(DEFAULT_DATA));

  // sessionId → Set of tokens, one per OMP_BRIDGE.login() in flight (their input prompts stay window.prompt).
  // Tokens (not a counter): a late release of a login from a dead process must not cancel a newer login's claim.
  const loginInFlight = new Map();
  function _loginBegin(sid) {
    const token = Symbol("login");
    const set = loginInFlight.get(sid) ?? new Set();
    set.add(token);
    loginInFlight.set(sid, set);
    return () => {
      const cur = loginInFlight.get(sid);
      if (!cur) return;
      cur.delete(token);
      if (cur.size === 0) loginInFlight.delete(sid);
    };
  }
  // ── Shared containers ──────────────────────────────────────────────────────
  // Tracks all open tabs. The tab list in the UI is derived from this.
  // { id, name, path, color, branch }
  const sessionRegistry = new Map();
  const sessionSnapshots = new Map(); // id -> saved state + volatile vars
  const gitListeners = new Map();  // session_id → Tauri unlisten fn for git://branch/{id}
  const _startQueues = new Map();  // sessionId -> commands issued while omp was still starting
  // Origin of each in-flight set_model ("restore" | "user"), oldest first (see live/models.js).
  const _pendingSetModel = [];

  // ── Runtime (live/runtime.js) ──────────────────────────────────────────────
  // `state` = the active session's UI state; `rt` = the re-assigned variables
  // by lifecycle (rt.session travels with a tab, rt.conn is transport/active-tab
  // bookkeeping, rt.seq are monotonic counters). reset/save/restore wipe, snapshot
  // and re-apply the per-tab part when the active tab changes.
  const runtime = window._Live.Runtime.create({
    defaults: DEFAULT_DATA, sessionRegistry, sessionSnapshots, pendingSetModel: _pendingSetModel,
  });
  const { state, rt } = runtime;

  // ── ID-keyed response correlation ─────────────────────────────────────────
  // Used by _sendWithResponse to correlate commands that need a typed reply.
  const _pendingResponses = new Map(); // id → { resolve, reject }

  /**
   * Send a command and return a Promise that resolves with the response data
   * or rejects with an Error on failure. Uses the RPC id field for correlation.
   * @param {object}  cmd         Command body (type + args, no id).
   * @param {number}  [timeout]   Ms to wait before rejecting (0 = no timeout).
   */
  function _sendWithResponse(cmd, timeout = 120000) {
    return new Promise((resolve, reject) => {
      if (!window.__TAURI__ || !rt.conn.activeSessionId) {
        reject(new Error("Not connected"));
        return;
      }
      const id = `d${runtime.nextCmdId()}`;
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

  function notify() {
    runtime.prepare(); // trim head + stamp message ids so the snapshot already reflects them
    const snap = runtime.buildSnapshot();
    subscribers.forEach(cb => cb(snap));

    // Keep OMP_DATA in sync for design components that read it directly
    window.OMP_DATA.messages  = state.messages;
    window.OMP_DATA.models    = state.models;
    window.OMP_DATA.kanban    = state.kanban;
    window.OMP_DATA.planMeta  = state.planMeta;
    window.OMP_DATA.ctx       = state.ctx;
    window.OMP_DATA.activity  = state.activity;
    window.OMP_DATA.peer      = window.PeerSessionBridge.build();
  }

  // Wire peer-session.js with the dependencies it needs from this IIFE.
  window.PeerSessionBridge.init({ notify, sessionRegistry });

  // ── Module instances (live/*.js) ───────────────────────────────────────────
  // Plain factories over the shared runtime; they never reach into each other —
  // every cross-module call (finalizeAsks, settle, initFetch, tab titles…) is
  // injected here. Creation order = dependency order.
  const _tabTitles = window._Live.TabTitles.create({ rt, sessionRegistry, notify });
  const { updateTabTitleIfDefault: _updateTabTitleIfDefault } = _tabTitles;

  const _todo = window._Live.TodoPhases.create({ state, rt });
  const _ui = window._Live.EventsUi.create({ state, rt, notify, send: _send, todo: _todo, loginInFlight });
  const _toolEvents = window._Live.EventsTool.create({
    state, rt, notify, todo: _todo,
    finalizeAsks: _ui.finalizeAsks,
    reindexToolCards: runtime.reindexToolCards,
  });
  const _messageEvents = window._Live.EventsMessage.create({
    state, rt, notify, send: _send,
    settleInFlightActions: _settleInFlightActions,
    reindexToolCards: runtime.reindexToolCards,
    refreshCtx: runtime.refreshCtx,
    nextCmdId: runtime.nextCmdId,
    savePrefs: window._Live.Prefs.savePrefs,
    setTabTitle: _tabTitles.setTabTitle,
    updateTabTitleIfDefault: _updateTabTitleIfDefault,
  });

  const _models = window._Live.Models.create({
    state, rt, notify, send: _send, sessionRegistry, pendingSetModel: _pendingSetModel,
    prefs: window._Live.Prefs, customModels: window._Live.CustomModels,
  });
  const _responses = window._Live.ResponseHandlers.create({
    state, rt, runtime, notify, send: _send, pendingResponses: _pendingResponses, sessionRegistry,
    todo: _todo, ui: _ui, models: _models,
    buildModelEntry: window._Live.CustomModels.buildModelEntry,
    setTabTitle: _tabTitles.setTabTitle,
    resetSession: _resetSession,
  });

  const _switch = window._Live.SessionSwitch.create({
    state, rt, runtime, notify, pendingSetModel: _pendingSetModel, startQueues: _startQueues, loginInFlight,
    ui: _ui,
    resetSession: _resetSession,
    settleInFlightActions: _settleInFlightActions,
    handleLine,
    initFetch: _models.initFetch,
    onAgentStarted: _onAgentStarted,
    // An in-flight undo/export awaits RPC responses on the current listener.
    awaitBridgesIdle: async () => { await _undo.whenIdle(); await _export.whenIdle(); },
  });
  const _switchToSession = _switch.switchToSession;
  const _sessions = window._Live.Sessions.create({
    state, rt, runtime, notify, sessionRegistry, sessionSnapshots, gitListeners,
    startQueues: _startQueues, loginInFlight,
    resetSession: _resetSession,
    switchToSession: _switchToSession,
  });
  const _branch = window._Live.SessionBranch.create({
    state, rt, runtime, notify, sessionRegistry,
    sendWithResponse: _sendWithResponse,
    attachGitWatch: _sessions.attachGitWatch,
    switchToSession: _switchToSession,
  });

  // Wipe the per-tab state *and* the ask handshake (owned by events-ui, so
  // runtime.reset() cannot reach it). Use this instead of runtime.reset().
  function _resetSession() {
    runtime.reset();
    _ui.resetHandshake();
  }

  // Finish whatever was in flight (turn end / abort / process exit): streaming
  // bubble, running tool cards + logs, hub agents, pending compact, open asks.
  // Spans message/tool/hub/ask state, so it lives here rather than in a module.
  function _settleInFlightActions({ aborted = true } = {}) {
    const now = Date.now();
    state.isStreaming = false;
    state.turnStartMs = null;
    state.runningTools = [];

    if (rt.session.streamingBubble) {
      rt.session.streamingBubble.streaming = false;
      rt.session.streamingBubble.completed = true;
      rt.session.streamingBubble = null;
    }

    if (Array.isArray(state.messages) && state.messages.length > 0) {
      let changed = false;
      const settled = state.messages.map(m => {
        let updated = m;
        if (m.streaming) {
          updated = { ...updated, streaming: false, completed: true };
          changed = true;
        }
        if (m.kind === "tool" && m.status === "running") {
          const duration = m._startMs ? now - m._startMs : (m.duration ?? 0);
          const subagents = Array.isArray(m.subagents)
            ? m.subagents.map(sa => sa.status === "running" ? { ...sa, status: aborted ? "aborted" : "ok" } : sa)
            : m.subagents;
          updated = {
            ...updated,
            status: aborted ? "aborted" : "ok",
            duration,
            subagents,
          };
          changed = true;
        }
        // Compact cards use `status: "pending"` (not a `pending` flag). A
        // normal turn_end must not touch one — the compact response / end event
        // resolves it — only an abort or process exit settles it.
        if (aborted && m.kind === "compact" && m.status === "pending") {
          updated = {
            ...updated,
            status: "error",
            errorReason: window.t ? window.t("chat.aborted") : "aborted",
          };
          changed = true;
        }
        return updated;
      });
      // An interrupted tool-only turn leaves a content-less placeholder bubble
      // (no message_end ever arrived); drop it. Bubbles with a thought stay.
      const kept = window.EmptyBubble
        ? settled.filter(m => !(m.completed && window.EmptyBubble.isContentless(m)))
        : settled;
      if (kept.length !== settled.length) {
        state.messages = kept; // activeToolCards is cleared below
      } else if (changed) {
        state.messages = settled;
      }
    }

    if (state.toolLogs) {
      let logsChanged = false;
      const nextLogs = { ...state.toolLogs };
      for (const [id, log] of Object.entries(nextLogs)) {
        if (log && log.status === "running") {
          nextLogs[id] = {
            ...log,
            status: aborted ? "aborted" : "completed",
            durationMs: log.startMs ? now - log.startMs : (log.durationMs ?? 0),
          };
          logsChanged = true;
        }
      }
      if (logsChanged) {
        state.toolLogs = nextLogs;
      }
    }

    if (Array.isArray(state.hubAgents) && state.hubAgents.length > 0) {
      state.hubAgents = state.hubAgents.map(ag =>
        ag.status === "running" ? { ...ag, status: aborted ? "aborted" : "ok" } : ag
      );
    }
    if (state.hubTaskId) {
      state.hubMode = "summary";
      state.hubTaskId = null;
    }

    _ui.finalizeAsks({ aborted });
    rt.session.activeToolCards.clear();
  }

  // ── RPC line handler ──────────────────────────────────────────────────────
  function handleLine(rawLine) {
    if (state.agentError) {
      state.agentError = null;
      notify();
    }
    let obj;
    try { obj = JSON.parse(rawLine); } catch { return; }
    if (!obj || typeof obj !== "object") return;

    const { type } = obj;

    if (type === "ready") {
      console.log(`[live] ready from session '${rt.conn.activeSessionId}'`);
      // Still waiting out a slow start: finish it here (one init fetch, queue
      // flushed) instead of again when the poll notices the process.
      if (rt.conn.agentStarting) _onAgentStarted();
      else _models.initFetch();
      return;
    }

    if (type === "response") { _responses.handleResponse(obj); return; }

    _handleEvent(obj);
  }

  // ── AgentSessionEvent handler ─────────────────────────────────────────────
  // Event handlers live in live/events-{ui,tool,message}.js; this is only the
  // type → handler table (own keys only: ev.type comes off the wire).
  const _eventHandlers = Object.assign(Object.create(null),
    _ui.handlers, _toolEvents.handlers, _messageEvents.handlers);
  function _handleEvent(ev) {
    const handler = _eventHandlers[ev.type];
    if (handler) handler(ev);
  }

  // omp is up after a grace-period start: fetch initial state, then deliver
  // what the user issued meanwhile (prompts, steers, model changes…).
  function _onAgentStarted() {
    rt.conn.startWaitSeq++;                 // stop any pending startup poll
    rt.conn.agentStarting = false;
    state.agentError = null;
    _models.initFetch();
    for (const cmd of window.AgentStartupWait.drain(_startQueues, rt.conn.activeSessionId)) _send(cmd);
    notify();
  }

  // ── Send a command to the active session's omp ────────────────────────────
  function _send(cmd) {
    if (!window.__TAURI__ || !rt.conn.activeSessionId) return;
    // The process isn't there yet: hold the command rather than lose it.
    if (rt.conn.agentStarting && window.AgentStartupWait) {
      if (!window.AgentStartupWait.enqueue(_startQueues, rt.conn.activeSessionId, cmd)) {
        console.warn("[live] startup queue full; dropping", cmd?.type);
      }
      return;
    }
    window.__TAURI__.core
      .invoke("send_command", { sessionId: rt.conn.activeSessionId, json: JSON.stringify(cmd) })
      .catch(e => {
        console.error("[live] send error:", e);
        const errMsg = (e && typeof e === "string") ? e : (e?.message || String(e));
        // Grace-period start in progress: not a failure (the wait owns the outcome).
        if (errMsg === "agent is starting") return;
        if (errMsg && !state.agentError) {
          state.agentError = errMsg;
          notify();
        }
      });
  }

  // Undo-a-sent-message orchestration lives in undo-bridge.js; it only needs
  // these IIFE-private helpers.
  const _undo = window.UndoBridge.create({
    state,
    notify,
    sendWithResponse: _sendWithResponse,
    applyRpcState:    _responses.applyRpcState,
    getActiveSessionId: () => rt.conn.activeSessionId,
    sessionSnapshots,
    clearVolatile: () => { rt.session.streamingBubble = null; _ui.resetHandshake(); },
    reindexToolCards: () => runtime.reindexToolCards(),
    defaultPlanMeta: () => ({ ...DEFAULT_DATA.planMeta }),
  });

  // `/export` orchestration lives in export-bridge.js.
  const _export = window.ExportBridge.create({
    state,
    notify,
    sendWithResponse: _sendWithResponse,
    getActiveSessionId: () => rt.conn.activeSessionId,
    getSessionInfo: () => {
      const entry = sessionRegistry.get(rt.conn.activeSessionId);
      return { name: entry?.name || "", cwd: entry?.path || "" };
    },
  });
  // ── OMP_BRIDGE public API ─────────────────────────────────────────────────
  window.OMP_BRIDGE = {
    get isConnected() { return !!window.__TAURI__ && !!rt.conn.activeSessionId && !state.agentError; },
    get models()      { return state.models; },
    get activeSessionId() { return rt.conn.activeSessionId; },

    // ── Messaging ────────────────────────────────────────────────────────────
    send(text, images) {
      const userMsg = { kind: "user", time: timeNow(), text, images: images ?? [] };
      state.messages = [...state.messages, userMsg];
      if (text) _updateTabTitleIfDefault(text);
      notify();
      _send({ type: "prompt", message: text, images: images ?? [] });
    },
    abort() {
      _send({ type: "abort" });
      _settleInFlightActions({ aborted: true });
      notify();
    },
    followUp(text)     { _send({ type: "follow_up", message: text }); },
    steer(text) {
      const userMsg = { kind: "user", time: timeNow(), text };
      state.messages = [...state.messages, userMsg];
      notify();
      _send({ type: "steer", message: text, images: [] });
    },
    // ── Models (live/models.js) ──────────────────────────────────────────────
    ..._models.api,

    // ── Session management (live/sessions.js, live/session-branch.js) ───────
    ..._sessions.api,
    ..._branch.api,

    compact() {
      const id  = "cmpct-" + runtime.nextCmdId();
      // Snapshot current context usage as the "before" value so the card
      // always shows a meaningful number even if omp's compact response
      // returns tokensBefore: 0 (observed in some omp versions).
      const preTokens = state.rpcState?.contextUsage?.tokens ?? null;
      state.messages = [...state.messages, { kind: "compact", status: "pending", id, time: timeNow(), tokensBefore: preTokens }];
      notify();
      _send({ type: "compact", id });
    },
    newSession()       { _send({ type: "new_session" }); },
    /** Undo the user bubble at UI index `uiIdx`: roll the session back to just
     *  before it (omp `branch`) and resolve `{ ok, text, images, planFramingStripped }`
     *  so the caller can put the message back in the composer. */
    undoMessage(uiIdx) { return _undo.undoMessage(uiIdx); },
    /** `null` when undo is safe, else `"running"` | `"async"` (single source of truth for the UI guard). */
    get undoBlocked() { return _undo.busyReason(); },
    /** `/export`: `"markdown"` | `"html"` → `{ ok, path? | reason }` (see export-bridge.js). */
    exportSession(format) { return _export.exportSession(format); },
    // ── Peer session (delegated to peer-session.js) ────────────────────────
    get peerSessionId() { return window.PeerSessionBridge.id; },
    setPeer(id)   { window.PeerSessionBridge.pin(id, rt.conn.activeSessionId); },
    clearPeer()   { window.PeerSessionBridge.unpin(); },

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
      // While a login is in flight its `input` prompts (OAuth codes, risk
      // confirmation) stay blocking window.prompt dialogs. Keyed per session.
      const release = _loginBegin(rt.conn.activeSessionId);
      return _sendWithResponse({ type: "login", providerId }, 300000).finally(release);
    },

    /**
     * Respond to a pending ask bubble (select / input / editor request).
     * Logic: live/events-ui.js (+ app/ask-answer.js) — it decides which frames
     * to send (e.g. the two-step "Other" handshake) and how the bubble changes.
     * @param {string} id  The extension_ui_request id the bubble currently answers.
     * @param {string|object} payload  `{ value }` | `{ custom }` | `{ clearOther: true }`
     *   | `{ text }` | `{ cancelled: true }`. A bare string is treated as `{ value }`.
     */
    answerAsk(id, payload) { _ui.answerAsk(id, payload); },

    /** Cancel a pending ask bubble (the server aborts the ask — and the turn). */
    cancelAsk(id) {
      window.OMP_BRIDGE.answerAsk(id, { cancelled: true });
    },

    /**
     * Push a system-generated assistant message into the session message log.
     * Writes to state.messages (not just React state) so it survives subsequent
     * notify() calls from live event processing (e.g. model registry refresh).
     * @param {string} text  Markdown text.
     */
    addAssistantMessage(text) {
      state.messages = [
        ...state.messages,
        window.NoticeBubble.make(text, timeNow(), state.model?.name ?? null),
      ];
      notify();
    },

    ...window._Live.TauriApi,

    /** Subscribe to state snapshots. Returns an unsubscribe function. */
    onUpdate(cb) {
      subscribers.add(cb);
      cb(runtime.buildSnapshot());
      return () => subscribers.delete(cb);
    },

    getToolLog(toolCallId) {
      return state.toolLogs[toolCallId] || null;
    },

    getState() { return state; },

    getSessions() {
      return [...sessionRegistry.values()];
    },

    getCwd() {
      const entry = sessionRegistry.get(rt.conn.activeSessionId);
      return entry?.path ?? "";
    },

    /** Send a programmatic user turn (e.g. a review prompt); steers if a turn is running. */
    sendUserMessage(text) {
      if (!text) return;
      if (state.isStreaming) this.steer(text);
      else this.send(text);
    },

    /** Open the Code Review drawer; `focus` pre-fills its "review focus" field. */
    openReviewDrawer(opts) {
      if (typeof window !== "undefined" && window.dispatchEvent) {
        const focus = typeof opts?.focus === "string" ? opts.focus : "";
        window.dispatchEvent(new CustomEvent("open-review-drawer", { detail: { focus } }));
      }
    },

    _handleEvent(ev) {
      _handleEvent(ev);
    },

    _handleLine(line) {
      handleLine(line);
    },

    _handleResponse(resp) {
      _responses.handleResponse(resp);
    },
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
      document.addEventListener("DOMContentLoaded", window._Live.WindowChrome.setup);
    } else {
      window._Live.WindowChrome.setup();
    }

    window.__TAURI__.core.invoke("get_app_version")
      .then(v => { window.PIDESK_APP_VERSION = v; window.OMP_APP_VERSION = v; })
      .catch(() => {});

    console.log("[live] Tauri multi-session mode active");
  } else {
    console.log("[live] Demo mode (no Tauri runtime)");
  }

})();
