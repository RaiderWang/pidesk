/* live.js — Tauri IPC bridge + OMP_BRIDGE + OMP_DATA initialisation.
   Depends on: adapter.js and the live/* modules (defaults, prefs, tauri-api,
   custom-models, runtime, todo-phases, events-ui/tool/message — they register
   on window._Live); all must load first.
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
  // ── User preference persistence ──────────────────────────────────────────
  // Saves the user's last model + thinking level across app restarts.
  // On a fresh session (no snapshot to restore from) the saved prefs are
  // pushed to omp so the new process matches the user's previous choice.
  // Storage helpers live in live/prefs.js; the model-list helpers in live/custom-models.js.
  const { loadPrefs: _loadPrefs, savePrefs: _savePrefs, clearModelPrefs: _clearModelPrefs } = window._Live.Prefs;
  const CustomModels = window._Live.CustomModels;
  const { buildModelEntry: _buildModelEntry, mergeModels: _mergeModels } = CustomModels;
  // Reads models.yml; `current` follows whatever model is active once the read lands.
  const _loadCustomModelsFromConfig = () => CustomModels.loadFromConfig(
    id => state.rpcState?.model?.id === id || state.model?.id === id,
  );

  // Origin of each in-flight set_model ("restore" | "user"), oldest first.
  // omp answers commands in order, so each set_model response shifts one entry.
  // A failed "restore" is silent and self-heals; a failed "user" shows a notice.
  const _pendingSetModel = [];

  function _sendSetModel(provider, modelId, origin) {
    _pendingSetModel.push(origin);
    _send({ type: "set_model", provider, modelId });
  }

  // Push the current thinking level to the active model (or force "off" for
  // an explicitly non-reasoning one). Shared by set_model success and the
  // rollback after a failed preference restore.
  function _pushThinkingLevel() {
    if (!state.thinkingLevel || state.thinkingLevel === "off") return;
    if (state.model?.reasoning === false) {
      state.thinkingLevel = "off";
      _savePrefs({ thinkingLevel: "off" });
    } else {
      _send({ type: "set_thinking_level", level: state.thinkingLevel });
    }
  }

  function _restorePrefs() {
    const prefs = _loadPrefs();
    if (!prefs || typeof prefs !== "object") return;

    if (prefs.thinkingLevel) {
      state.thinkingLevel = prefs.thinkingLevel;
    }

    // Model — only override when saved preference differs from omp's default.
    // When switching models, do not push set_thinking_level to the old model first:
    // if omp's default model is non-reasoning (e.g. auto/best-free), pushing a thinking
    // level will cause omp to clamp/reset it to undefined. Instead, switch model first;
    // the set_model response handler re-pushes state.thinkingLevel to the new model.
    // Same id under another provider is a different model; a model without a
    // reported provider is compared by id only (no needless set_model).
    const sameModel = state.model?.id === prefs.modelId
      && (!state.model?.provider || state.model.provider === prefs.modelProvider);
    const willChangeModel = Boolean(prefs.modelId && prefs.modelProvider && !sameModel);
    if (willChangeModel) {
      // No pre-check against state.models: it may still hold only the models.yml
      // entries here (built-in/OAuth models arrive later). A stale model fails
      // the set_model and is healed in _handleResponse.
      _sendSetModel(prefs.modelProvider, prefs.modelId, "restore");
      // Optimistic local update to prevent the UI flashing omp's default model.
      state.model = _buildModelEntry({
        id: prefs.modelId,
        name: prefs.modelName,
        provider: prefs.modelProvider,
      });
      if (state.models.length > 0) {
        state.models = state.models.map(m => ({
          ...m, current: m.id === prefs.modelId && (!m.provider || m.provider === prefs.modelProvider),
        }));
      }
    } else if (prefs.thinkingLevel) {
      // Model unchanged — push thinking level directly to current model.
      _send({ type: "set_thinking_level", level: prefs.thinkingLevel });
    }
  }

  // ── Session registry ───────────────────────────────────────────────────────
  // Tracks all open tabs. The tab list in the UI is derived from this.
  // { id, name, path, color, branch }
  const sessionRegistry = new Map();
  const sessionSnapshots = new Map(); // id -> saved state + volatile vars
  const gitListeners = new Map();  // session_id → Tauri unlisten fn for git://branch/{id}
  const _startQueues = new Map();  // sessionId -> commands issued while omp was still starting

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

  // ── Event modules (live/events-*.js, live/todo-phases.js) ──────────────────
  // Plain factories over the shared runtime; they never reach into each other —
  // cross-module calls (finalizeAsks, settle, tab titles…) are injected here.
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
    savePrefs: _savePrefs,
    setTabTitle: _setTabTitle,
    updateTabTitleIfDefault: _updateTabTitleIfDefault,
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

  // ── Session switching ─────────────────────────────────────────────────────
  // `fresh` skips the cached snapshot and starts from a blank state (so the
  // saved model/thinking prefs are pushed to the new process), even if one exists.
  async function _switchToSession(id, { fresh = false } = {}) {
    if (!window.__TAURI__) return;

    // Auto-clear peer if switching to the peer tab (redundant to monitor yourself)
    window.PeerSessionBridge.clearIfMatch(id);

    // An in-flight undo awaits RPC responses on the *current* listener; wait
    // for it so its responses (and composer restore) land in the right tab.
    await _undo.whenIdle();
    await _export.whenIdle();

    // Snapshot current session so we can restore it when switching back
    runtime.save();
    // Frames for this session stop arriving once its listeners are torn down,
    // so an armed "Other" handshake can never be consumed — never carry it over.
    _ui.resetHandshake();
    // Listeners are torn down below; responses to in-flight set_model never arrive.
    _pendingSetModel.length = 0;

    // Tear down old listeners
    for (const ul of rt.conn.activeListeners) { try { await ul(); } catch (_) {} }
    rt.conn.activeListeners = [];

    rt.conn.activeSessionId = id;
    rt.conn.agentStarting = false;
    const waitSeq = ++rt.conn.startWaitSeq;

    // Restore cached snapshot (preserves streaming messages) or start fresh
    if (fresh || !runtime.restore(id)) {
      _resetSession();
      rt.session.sessionFresh = true;
    } else {
      rt.session.sessionFresh = false;
    }

    const notRunningText = () =>
      (window.t ? window.t("agent.processNotRunning") : "Agent process (omp) is not running");

    // The AgentErrorBanner shows the full reason with Retry/Copy; a chat
    // bubble would duplicate it and go stale once Retry succeeds. Callers notify().
    function _setAgentFailure(reason) {
      state.isStreaming = false;
      // Any failure ends a pending startup wait: stop its poll, drop what
      // was queued for it and clear the "Starting agent…" indicator.
      rt.conn.startWaitSeq++;
      rt.conn.agentStarting = false;
      _startQueues.delete(id);
      state.agentError = (typeof reason === "string" && reason.trim()) || notRunningText();
    }

    const { listen } = window.__TAURI__.event;
    const ulLine = await listen(`agent://line/${id}`, ev => handleLine(ev.payload));
    const ulExit = await listen(`agent://exit/${id}`, ev => {
      const reason = (ev?.payload && String(ev.payload).trim()) || "";
      console.warn(`[live] session '${id}' omp process exited${reason ? ": " + reason : ""}`);
      _setAgentFailure(reason);
      _settleInFlightActions({ aborted: true }); // pending compact card, open asks, ...
      loginInFlight.delete(id); // the login died with the process
      notify();
    });
    rt.conn.activeListeners = [ulLine, ulExit];

    // Surface any cached startup error for this session. Tauri starts
    // the default session in setup() before the frontend can attach
    // listeners, so a spawn failure (e.g. omp not on PATH) would
    // otherwise be invisible. session_status returns the cached error
    // synchronously — no event timing race.
    let waitForStartup = false;
    const invoke = (cmd) => window.__TAURI__.core.invoke(cmd, { sessionId: id });
    // Read order matters: the backend flips `starting` off *last* (after the
    // process is registered or the failure is cached), so once `starting`
    // reads false the other two are final. Reading it last could pair a stale
    // running=false with an already finished start and report a false failure.
    const readStatus = async () => {
      const starting = window.AgentStartupWait
        ? await invoke("is_session_starting").catch(() => false)
        : false;
      const running = await invoke("is_session_running").catch(() => false);
      const error = await invoke("session_status");
      return { starting, running, error };
    };
    try {
      const { starting, running: isRunning, error: startupError } = await readStatus();
      const startupMsg = typeof startupError === "string" ? startupError.trim() : "";
      if (startupMsg) {
        console.warn(`[live] session '${id}' startup error: ${startupMsg}`);
        _setAgentFailure(startupMsg);
      } else if (isRunning) {
        state.agentError = null;
      } else if (starting) {
        // Right after an in-app update omp may still be coming up: wait for
        // it instead of flashing a "not running" error that clears itself.
        state.agentError = null;
        rt.conn.agentStarting = true;
        waitForStartup = true;
      } else {
        state.agentError = notRunningText();
      }
    } catch (e) {
      console.warn(`[live] session_status query failed:`, e);
    }

    if (waitForStartup) {
      window.AgentStartupWait.waitUntilStarted({
        query: () => readStatus().catch(() => ({ starting: true, running: false, error: null })),
        isCurrent: () => rt.conn.activeSessionId === id && waitSeq === rt.conn.startWaitSeq,
        onRunning: () => _onAgentStarted(),
        onFailed: (reason) => {
          _setAgentFailure(reason);
          notify();
        },
      });
      notify();
      return;
    }

    // Re-fetch to pick up events missed while not listening.
    // get_messages handler merges completed turns with the cached streaming bubble.
    _initFetch();
    notify();
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
      else _initFetch();
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
        if (resp.success && compactMsgId) rt.session.compactBackfillId = compactMsgId;
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
        if (_pendingSetModel.shift() === "restore") {
          // Saved model no longer exists (e.g. renamed in models.yml): forget it,
          // fall back to what omp is actually running, no notice — not a user action.
          _clearModelPrefs();
          const rpcModel = state.rpcState?.model;
          state.model = rpcModel ? _buildModelEntry(rpcModel) : null;
          if (rpcModel) {
            _syncCurrentModel();
            state.models = state.models.map(m => ({ ...m, current: m.id === rpcModel.id }));
          }
          _pushThinkingLevel();
          notify();
          return;
        }
        const errMsg = resp.error || "Failed to switch model";
        const failText = window.t
          ? window.t("agent.modelSwitchFailed", { error: errMsg })
          : `⚠️ **Model Switch Failed:** ${errMsg}`;
        state.messages = [...state.messages, window.NoticeBubble.make(failText, timeNow())];
        notify();
      }
      return;
    }
    const { command, data } = resp;

    if (command === "get_state") {
      _applyRpcState(data);

    } else if (command === "get_messages") {
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
            if (_todo.apply(rawPhases)) break;
          }
          if (raw?.role === "assistant" && Array.isArray(raw.content)) {
            let found = false;
            for (const b of raw.content) {
              if (b?.type === "toolCall" && (b.name === "todo" || b.name === "todo_write")) {
                const rawPhases = b.arguments?.phases ?? b.arguments?.todos ?? b.arguments;
                if (_todo.apply(rawPhases)) {
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

    } else if (command === "get_available_models") {
      const rpcModels = (data.models ?? []).map(m => ({
        ..._buildModelEntry(m),
        current:  state.rpcState?.model?.id === m.id || state.model?.id === m.id,
      }));
      _loadCustomModelsFromConfig().then(customData => {
        state.models = _mergeModels(rpcModels, customData);
        _syncCurrentModel();
        notify();
        console.log(`[live] models loaded (${state.models.length} total) for session '${rt.conn.activeSessionId}'`);
        _checkModelsConfig(rpcModels, customData);
      }).catch(() => {
        state.models = rpcModels;
        _syncCurrentModel();
        notify();
      });

    } else if (command === "get_available_thinking_levels") {
      if (Array.isArray(data?.levels)) {
        const customModel = state.models?.find(m => m.id === state.model?.id && (!state.model?.provider || m.provider === state.model?.provider))
          || state.models?.find(m => m.id === state.model?.id);
        const customEfforts = customModel?.thinking?.efforts ?? state.model?.thinking?.efforts;

        if (Array.isArray(customEfforts) && customEfforts.length > 0) {
          state.availableThinkingLevels = ["off", ...customEfforts];
        } else if (state.model?.reasoning === false) {
          state.availableThinkingLevels = ["off"];
        } else {
          state.availableThinkingLevels = data.levels;
        }
        if (state.thinkingLevel && state.thinkingLevel !== "off" && !state.availableThinkingLevels.includes(state.thinkingLevel)) {
          const fallback = state.availableThinkingLevels.length > 1
            ? (state.model?.thinking?.defaultLevel || state.availableThinkingLevels[1] || "off")
            : "off";
          state.thinkingLevel = fallback;
          _savePrefs({ thinkingLevel: fallback });
          if (fallback !== "off") {
            _send({ type: "set_thinking_level", level: fallback });
          }
        }
        notify();
      }

    } else if (command === "set_model") {
      _pendingSetModel.shift();
      if (data) {
        state.model  = _buildModelEntry(data);
        state.models = state.models.map(m => ({ ...m, current: m.id === data.id }));
        _savePrefs({ modelId: data.id, modelProvider: data.provider, modelName: data.name });
        _syncCurrentModel();
        _pushThinkingLevel();
        _send({ type: "get_available_thinking_levels" });
        _send({ type: "get_state" });
        notify();
      }

    } else if (command === "cycle_model") {
      if (data?.model) {
        state.model  = _buildModelEntry(data.model);
        if (data.thinkingLevel != null) state.thinkingLevel = data.thinkingLevel;
        state.models = state.models.map(m => ({ ...m, current: m.id === data.model.id }));
        _savePrefs({ modelId: data.model.id, modelProvider: data.model.provider, modelName: data.model.name });
        if (data.thinkingLevel != null) _savePrefs({ thinkingLevel: data.thinkingLevel });
        _send({ type: "get_available_thinking_levels" });
        notify();
      }

    } else if (command === "cycle_thinking_level") {
      const hasReasoning = Boolean(
        state.model?.reasoning ||
        state.model?.thinking ||
        (Array.isArray(state.availableThinkingLevels) && state.availableThinkingLevels.length > 1)
      );
      if (!hasReasoning) {
        state.thinkingLevel = "off";
      } else {
        const validLevels = (Array.isArray(state.availableThinkingLevels) && state.availableThinkingLevels.length > 1)
          ? state.availableThinkingLevels
          : (Array.isArray(state.model?.thinking?.efforts) && state.model.thinking.efforts.length > 0)
            ? ["off", ...state.model.thinking.efforts]
            : ["off", "low", "medium", "high"];
        if (data?.level != null && validLevels.includes(data.level)) {
          state.thinkingLevel = data.level;
        } else {
          const idx = validLevels.indexOf(state.thinkingLevel);
          const next = validLevels[(idx + 1) % validLevels.length];
          state.thinkingLevel = next;
          _send({ type: "set_thinking_level", level: next });
        }
      }
      _savePrefs({ thinkingLevel: state.thinkingLevel });
      notify();

    } else if (command === "new_session") {
      // New session started — clear local state and re-fetch
      _resetSession();
      _initFetch();
      notify();

    } else if (command === "get_session_stats") {
      // SessionStats — no display action needed
    }
  }

  function _syncCurrentModel() {
    if (!state.model || !Array.isArray(state.models) || state.models.length === 0) return;
    const match = state.models.find(m => m.id === state.model.id && (!state.model.provider || m.provider === state.model.provider))
      || state.models.find(m => m.id === state.model.id);
    if (!match) return;

    const prevReasoning = Boolean(state.model.reasoning || state.model.thinking);
    const hasReasoning = Boolean(match.reasoning || match.thinking);

    state.model = {
      ...state.model,
      name:          match.name || state.model.name,
      provider:      match.provider || state.model.provider,
      reasoning:     match.reasoning,
      thinking:      match.thinking,
      input:         match.input || state.model.input,
      contextWindow: match.contextWindow || state.model.contextWindow,
      maxTokens:     match.maxTokens || state.model.maxTokens,
    };

    if (!hasReasoning) {
      state.availableThinkingLevels = ["off"];
      if (state.thinkingLevel && state.thinkingLevel !== "off") {
        state.thinkingLevel = "off";
        _savePrefs({ thinkingLevel: "off" });
        _send({ type: "set_thinking_level", level: "off" });
      }
    } else {
      const configuredEfforts = Array.isArray(match.thinking?.efforts) && match.thinking.efforts.length > 0
        ? match.thinking.efforts
        : ["low", "medium", "high"];
      state.availableThinkingLevels = ["off", ...configuredEfforts];

      if (!prevReasoning && (state.thinkingLevel === "off" || !state.thinkingLevel)) {
        const defaultLevel = match.thinking?.defaultLevel || configuredEfforts[0] || "off";
        state.thinkingLevel = defaultLevel;
        _savePrefs({ thinkingLevel: defaultLevel });
        if (defaultLevel !== "off") {
          _send({ type: "set_thinking_level", level: defaultLevel });
        }
      } else if (state.thinkingLevel && state.thinkingLevel !== "off" && !state.availableThinkingLevels.includes(state.thinkingLevel)) {
        const nextLevel = match.thinking?.defaultLevel || configuredEfforts[0] || "off";
        state.thinkingLevel = nextLevel;
        _savePrefs({ thinkingLevel: nextLevel });
        if (nextLevel !== "off") {
          _send({ type: "set_thinking_level", level: nextLevel });
        }
      }
    }
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

  function _resolveSessionId(targetId) {
    if (!targetId) return rt.conn.activeSessionId;
    if (sessionRegistry.has(targetId)) return targetId;
    for (const [id, entry] of sessionRegistry.entries()) {
      if (entry.savedSessionId && entry.savedSessionId === targetId) return id;
    }
    return rt.conn.activeSessionId;
  }

  function _updateTabTitleIfDefault(text) {
    if (!text || !rt.conn.activeSessionId || !sessionRegistry.has(rt.conn.activeSessionId)) return;
    const entry = sessionRegistry.get(rt.conn.activeSessionId);
    const formatted = window.SessionTitle?.nextTitle
      ? window.SessionTitle.nextTitle(entry, text, { force: false })
      : null;
    if (formatted) {
      sessionRegistry.set(rt.conn.activeSessionId, { ...entry, name: formatted, titleLocked: true, userTitled: true });
      notify();
    }
  }

  function _setTabTitle(rawTitle, targetSessionId = null) {
    const sid = _resolveSessionId(targetSessionId);
    if (!rawTitle || !sid || !sessionRegistry.has(sid)) return;
    const entry = sessionRegistry.get(sid);
    const formatted = window.SessionTitle?.nextTitle
      ? window.SessionTitle.nextTitle(entry, rawTitle, { force: true })
      : rawTitle;
    if (formatted && formatted !== entry.name) {
      sessionRegistry.set(sid, {
        ...entry,
        name: formatted,
        // Never backfill savedSessionId here: when targetSessionId matches nothing we
        // fall back to the active tab, and binding an unrelated omp id to it would
        // corrupt resume de-dup / fork. _applyRpcState owns savedSessionId.
        titleLocked: true,
        userTitled: true,
      });
      if (sid === rt.conn.activeSessionId) notify();
    }
  }

  function _applyRpcState(rpcState) {
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
      _ui.finalizeAsks({ aborted: false });
      if (state.messages.some(m => m.kind === "tool")) {
        state.messages = state.messages.filter(m => m.kind !== "tool");
        rt.session.activeToolCards.clear();
      }
    }
    state.thinkingLevel = state.thinkingLevel ?? rpcState.thinkingLevel ?? "off";

    if (rpcState.model) {
      state.model = _buildModelEntry(rpcState.model);
      _syncCurrentModel();
    }
    if (rpcState.model && state.models.length > 0) {
      state.models = state.models.map(m => ({ ...m, current: m.id === rpcState.model.id }));
    }
    // get_state only feeds kanban/planMeta — the inline plan block in chat is not touched.
    _todo.apply(rpcState.todoPhases ?? rpcState.phases ?? rpcState.todos, {
      fallback: rpcState.todoPhases ?? [], inject: false,
    });

    // Only update the tab name if omp provides an explicit human-readable
    // sessionName. The sessionFile is a timestamp ID — leave the folder-based
    // name set at tab-open time intact when sessionName is absent.
    if (rpcState.sessionName) {
      _setTabTitle(rpcState.sessionName);
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
    // after a successful compact. _compactBackfillId ensures we only patch the
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
      _restorePrefs();
    }

    runtime.refreshCtx();
    notify();
  }

  // omp silently drops every custom provider when models.yml fails its schema
  // validation, while PiDesk still lists those models from the file. When
  // custom models are missing from omp's list, ask `omp models` why (it prints
  // the validation error; RPC mode does not) and surface it.
  // The runner de-duplicates per missing-set and drops results superseded by a
  // newer request or by `invalidate()` (models.yml saved while a run was in flight).
  let _configCheckRunner = null;
  function _modelsConfigRunner() {
    if (!_configCheckRunner) {
      _configCheckRunner = window.ModelsConfigCheck.createRunner(
        () => window.__TAURI__.core.invoke("check_models_config"),
        (msg) => {
          if (state.modelsConfigWarning === msg) return;
          state.modelsConfigWarning = msg;
          notify();
        },
      );
    }
    return _configCheckRunner;
  }
  function _checkModelsConfig(rpcModels, customData) {
    const check = window.ModelsConfigCheck;
    if (!window.__TAURI__ || !check?.createRunner) return;
    const key = check.missingKey(check.missingCustomModels(rpcModels, customData?.customModels));
    _modelsConfigRunner().request(key);
  }

  function _initFetch() {
    _send({ type: "get_state" });
    _send({ type: "get_messages" });
    _send({ type: "get_available_models" });
    _send({ type: "get_available_thinking_levels" });
    _loadCustomModelsFromConfig().then(customData => {
      if (customData.customModels.length > 0) {
        state.models = _mergeModels(state.models, customData);
        _syncCurrentModel();
        notify();
      }
    }).catch(() => {});
  }

  // True when the session's omp is gone and nothing is about to bring it
  // back. A grace-period start in progress must not be pre-empted by an
  // explicit start_session (the backend treats that as cancelling it).
  async function _needsRestart(id) {
    if (!window.__TAURI__ || !id || rt.conn.agentStarting) return false;
    const { invoke } = window.__TAURI__.core;
    const running = await invoke("is_session_running", { sessionId: id }).catch(() => false);
    if (running) return false;
    const starting = await invoke("is_session_starting", { sessionId: id }).catch(() => false);
    return !starting;
  }

  // omp is up after a grace-period start: fetch initial state, then deliver
  // what the user issued meanwhile (prompts, steers, model changes…).
  function _onAgentStarted() {
    rt.conn.startWaitSeq++;                 // stop any pending startup poll
    rt.conn.agentStarting = false;
    state.agentError = null;
    _initFetch();
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

  // Undo-a-sent-message orchestration lives in undo-bridge.js; it only needs
  // these IIFE-private helpers.
  const _undo = window.UndoBridge.create({
    state,
    notify,
    sendWithResponse: _sendWithResponse,
    applyRpcState:    _applyRpcState,
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
    async setModel(model) {
      if (await _needsRestart(rt.conn.activeSessionId)) {
        const entry = sessionRegistry.get(rt.conn.activeSessionId);
        const cwd = entry?.path ?? "";
        await window.__TAURI__.core
          .invoke("start_session", { sessionId: rt.conn.activeSessionId, cwd })
          .catch(() => {});
      }
      state.agentError = null;
      _sendSetModel(model.provider, model.id, "user");
    },
    async retrySession(id = rt.conn.activeSessionId) {
      if (!window.__TAURI__ || !id) return;
      const entry = sessionRegistry.get(id);
      const cwd = entry?.path ?? "";
      state.agentError = null;
      notify();
      try {
        await window.__TAURI__.core.invoke("start_session", { sessionId: id, cwd });
      } catch (err) {
        console.warn(`[live] retrySession '${id}' failed:`, err);
        const errMsg = (err && typeof err === "string") ? err : (err?.message || String(err));
        state.agentError = errMsg;
        notify();
        return;
      }
      await _switchToSession(id);
    },
    /**
     * Respawn the active tab's omp so it re-reads models.yml (omp has no RPC
     * for that), resuming the same session file to keep the history. Refuses
     * while a turn / background work runs. Resolves { ok } or { ok:false, reason }.
     */
    async restartActiveSession() {
      const id = rt.conn.activeSessionId;
      const entry = sessionRegistry.get(id);
      const plan = window.SessionRestart.plan({
        hasSession:          Boolean(window.__TAURI__ && id),
        isStreaming:         state.isStreaming,
        hasPendingAsyncWork: state.hasPendingAsyncWork,
        // Same chain as branch(): a just-resumed tab only has sessionPath until
        // its first get_state fills in sessionFile.
        sessionFile:         state.rpcState?.sessionFile || entry?.sessionFile || entry?.sessionPath,
        messages:            state.messages,
      });
      if (!plan.ok) return plan;
      const cwd = entry?.path ?? "";
      state.agentError = null;
      try {
        await window.__TAURI__.core.invoke("start_session", {
          sessionId: id, cwd, ...(plan.resume ? { resume: plan.resume } : {}),
        });
      } catch (err) {
        const error = (err && typeof err === "string") ? err : (err?.message || String(err));
        console.warn(`[live] restartActiveSession '${id}' failed:`, err);
        state.agentError = error;
        notify();
        return { ok: false, reason: "start-failed", error };
      }
      // With --resume omp restores the session's own model and thinking level, and
      // get_state reports them — pushing the global last-used prefs (_restorePrefs,
      // i.e. a fresh switch) would clobber another tab's choice, so keep the snapshot.
      // Without a session (still-empty tab) the new process is just a new session:
      // start blank so the saved prefs are applied like for any new tab.
      await _switchToSession(id, { fresh: !plan.resume });
      return { ok: true };
    },
    cycleModel()       { _send({ type: "cycle_model" }); },
    cycleThinking() {
      const hasReasoning = Boolean(
        state.model?.reasoning ||
        state.model?.thinking ||
        (state.availableThinkingLevels && state.availableThinkingLevels.length > 1)
      );
      if (!hasReasoning) {
        state.thinkingLevel = "off";
      } else {
        const levels = (Array.isArray(state.availableThinkingLevels) && state.availableThinkingLevels.length > 1)
          ? state.availableThinkingLevels
          : (Array.isArray(state.model?.thinking?.efforts) && state.model.thinking.efforts.length > 0)
            ? ["off", ...state.model.thinking.efforts]
            : ["off", "low", "medium", "high"];
        const idx = levels.indexOf(state.thinkingLevel);
        const next = levels[(idx + 1) % levels.length];
        state.thinkingLevel = next;
        _savePrefs({ thinkingLevel: next });
        _send({ type: "set_thinking_level", level: next });
      }
      notify();
    },
    getAvailableThinkingLevels() { return state.availableThinkingLevels; },
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
    /** Fork the active session into a new tab by copying the session file.
     *  If `fromMsgIdx` is a number, only the conversation up to (and including)
     *  that UI message index is kept — messages after it are discarded so the
     *  new tab can diverge from an earlier point.  When omitted or null the
     *  entire session is copied (branch from HEAD). */
    async branch(fromMsgIdx = null) {
      if (!window.__TAURI__) return;
      const activeEntry = sessionRegistry.get(rt.conn.activeSessionId);
      const cwd = activeEntry?.path ?? "";

      // The awaits below leave room for a tab switch. `state.messages` and
      // warnings belong to the tab the user clicked in — never to another one.
      const originId = rt.conn.activeSessionId;
      const warn = (key, params) => {
        if (rt.conn.activeSessionId !== originId) return;
        state.messages = [
          ...state.messages,
          window.NoticeBubble.make(window.t ? window.t(key, params) : key, timeNow()),
        ];
        notify();
      };

      // Locate the current session's .jsonl on disk (the file omp is writing).
      let sourcePath = null;
      try {
        const sessions = await window.__TAURI__.core.invoke("list_saved_sessions", { cwd: cwd || null });
        sourcePath = window.BranchSession.pickSourcePath(
          sessions,
          state.rpcState?.sessionFile || activeEntry?.sessionFile || activeEntry?.sessionPath,
          state.rpcState?.sessionId || activeEntry?.savedSessionId,
        );
      } catch (e) {
        console.warn("[live] branch: listSavedSessions failed:", e);
      }
      if (!sourcePath) return warn("branch.fail.noSession");

      // Cut at a stable entry id, not a message count: the UI list is
      // head-trimmed (runtime.trimMessages) and the file also stores toolResult rows
      // as "message" events. If the bubble can't be located with certainty,
      // refuse — a silent full copy would fork from the wrong point.
      let untilEntryId = null;
      if (fromMsgIdx !== null && fromMsgIdx >= 0) {
        try {
          const listing = await _sendWithResponse({ type: "get_entries" }, 30000);
          if (rt.conn.activeSessionId !== originId) return; // switched tabs: state.messages is another session's
          untilEntryId = window.BranchSession.resolveTarget(
            state.messages, fromMsgIdx, listing?.entries, listing?.leafId,
          );
        } catch (e) {
          console.warn("[live] branch: get_entries resolution failed:", e);
        }
        if (!untilEntryId) return warn("branch.fail.locate");
      }

      try {
        const newPath = await window.__TAURI__.core.invoke("copy_session_file", {
          sourcePath,
          maxMessages: null,
          untilEntryId,
        });

        const id = runtime.genSessionId();
        const baseName = activeEntry?.name ?? "session";
        const label = `${baseName} (fork)`;
        sessionRegistry.set(id, {
          id, name: label, path: cwd, color: "var(--lilac)", branch: null,
          sessionPath: newPath,
        });
        try {
          await window.__TAURI__.core.invoke("start_session", { sessionId: id, cwd, resume: newPath });
        } catch (err) {
          console.warn("[live] branch start_session failed:", err);
        }

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
        warn("branch.fail.generic", { error: err?.message ?? String(err) });
      }
    },
    /** `/export`: `"markdown"` | `"html"` → `{ ok, path? | reason }` (see export-bridge.js). */
    exportSession(format) { return _export.exportSession(format); },
    // ── Peer session (delegated to peer-session.js) ────────────────────────
    get peerSessionId() { return window.PeerSessionBridge.id; },
    setPeer(id)   { window.PeerSessionBridge.pin(id, rt.conn.activeSessionId); },
    clearPeer()   { window.PeerSessionBridge.unpin(); },

    /** Hide the models.yml warning banner until the missing-model set changes. */
    dismissModelsConfigWarning() {
      state.modelsConfigWarning = null;
      notify();
    },

    async refreshModels() {
      _configCheckRunner?.invalidate(); // models.yml changed: drop in-flight result, diagnose again
      if (await _needsRestart(rt.conn.activeSessionId)) {
        const entry = sessionRegistry.get(rt.conn.activeSessionId);
        const cwd = entry?.path ?? "";
        console.log(`[live] session '${rt.conn.activeSessionId}' is not running; restarting with new models config`);
        try {
          await window.__TAURI__.core.invoke("start_session", {
            sessionId: rt.conn.activeSessionId,
            cwd,
          });
          state.agentError = null;
          const notice = window.t
            ? window.t("agent.restartedAfterModelConfig")
            : "Restarted session with new model configuration.";
          state.messages = [...state.messages, window.NoticeBubble.make(`✨ **${notice}**`, timeNow())];
        } catch (e) {
          console.warn("[live] failed to restart session:", e);
          state.agentError = (e && typeof e === "string") ? e : (e?.message || String(e));
        }
      }
      const customData = await _loadCustomModelsFromConfig();
      // A model renamed/deleted in models.yml must not be re-pushed to the next
      // session. Judged on models.yml itself: the running omp still lists it.
      if (window.ModelPrefs?.isStaleCustomModel(_loadPrefs(), customData)) {
        _clearModelPrefs();
      }
      if (customData.customModels.length > 0 || customData.customProviders.size > 0) {
        state.models = _mergeModels(state.models, customData);
      }
      _syncCurrentModel();
      notify();
      // While omp is still starting the post-start init fetch covers this.
      if (!rt.conn.agentStarting) _initFetch();
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

    // ── Session management ───────────────────────────────────────────────────

    /** Open a new tab for the given project folder (or standalone if null/empty). Returns the new session id. */
    async openSession(cwd) {
      const id   = runtime.genSessionId();
      let name = "PiDesk";
      const norm = window.SessionTitle?.normalizePath || (p => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());

      if (cwd) {
        const folder = window.SessionTitle?.folderName ? window.SessionTitle.folderName(cwd) : cwd;
        const baseName = folder || cwd;
        const targetNorm = norm(cwd);
        const existingNames = [...sessionRegistry.values()]
          .filter(s => s.path && norm(s.path) === targetNorm)
          .map(s => s.name);
        name = window.SessionTitle?.nextInitialName ? window.SessionTitle.nextInitialName(baseName, existingNames) : baseName;
        if (typeof window !== "undefined" && window.RecentProjects?.addRecentProject) {
          window.RecentProjects.addRecentProject(cwd, baseName);
        }
      } else {
        const existingNames = [...sessionRegistry.values()]
          .filter(s => !s.path)
          .map(s => s.name);
        name = window.SessionTitle?.nextInitialName ? window.SessionTitle.nextInitialName("PiDesk", existingNames) : "PiDesk";
      }
      const color = cwd ? "var(--lilac)" : "var(--accent)";
      // Register in tab list before starting omp so the tab shows immediately
      // Register with null branch — chip hidden until git resolves
      sessionRegistry.set(id, { id, name, path: cwd ?? "", color, branch: null });
      // Spawn omp for this project
      if (window.__TAURI__) {
        try {
          await window.__TAURI__.core.invoke("start_session", {
            sessionId: id, cwd: cwd ?? "",
          });
        } catch (err) {
          console.warn("[live] openSession start_session failed:", err);
        }
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
      if (id === rt.conn.activeSessionId) return;
      if (!sessionRegistry.has(id)) return;
      await _switchToSession(id);
    },

    ...window._Live.TauriApi,

    /** Resume a saved session into a new tab (or switch to existing tab if already opened). */
    async resumeSession(session) {
      if (!session || !session.path) return null;

      const norm = window.SessionTitle?.normalizePath || (p => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
      const targetPathNorm = norm(session.path);
      const targetId = session.id ? String(session.id).trim() : null;

      // Check if this saved session is already open in an existing tab
      for (const [tabId, entry] of sessionRegistry.entries()) {
        // 1. Direct match on tracked sessionPath / savedSessionId
        if (entry.sessionPath && norm(entry.sessionPath) === targetPathNorm) {
          await this.activateSession(tabId);
          return tabId;
        }
        if (entry.savedSessionId && targetId && entry.savedSessionId === targetId) {
          await this.activateSession(tabId);
          return tabId;
        }
        // 2. Check tab's rpcState.sessionFile (active tab or cached snapshot)
        const tabRpcState = (tabId === rt.conn.activeSessionId)
          ? state.rpcState
          : sessionSnapshots.get(tabId)?.rpcState;
        if (tabRpcState?.sessionFile) {
          const sfNorm = norm(tabRpcState.sessionFile);
          if (
            sfNorm === targetPathNorm ||
            (targetId && (sfNorm === norm(targetId) || sfNorm.includes(targetId))) ||
            targetPathNorm.endsWith(sfNorm) ||
            sfNorm.endsWith(targetPathNorm)
          ) {
            entry.sessionPath = session.path;
            if (targetId) entry.savedSessionId = targetId;
            await this.activateSession(tabId);
            return tabId;
          }
        }
      }

      const id = runtime.genSessionId();
      // "No project" sessions were recorded with the exe directory (e.g.
      // target/debug) as their cwd. Treat them as standalone again: empty
      // path → no project tab/file tree, and let the backend pin the child
      // to the current default cwd (the recorded dir may no longer exist).
      const savedCwd = session.cwd || "";
      const standalone =
        session.is_standalone === true ||
        (window.RecentProjects?.isStandalonePath?.(savedCwd) ?? !savedCwd);
      const cwd = standalone ? "" : savedCwd;
      const folderName = window.SessionTitle?.folderName ? window.SessionTitle.folderName(cwd) : "";
      const rawTitle = session.title || folderName || "resumed";
      const name = window.SessionTitle?.formatSessionTitle
        ? window.SessionTitle.formatSessionTitle(rawTitle, folderName, { fallback: "resumed" })
        : rawTitle;
      const isCustom = Boolean(session.title && !window.SessionTitle?.isDefaultSessionName?.(session.title));
      sessionRegistry.set(id, {
        id,
        name,
        path: cwd,
        color: "var(--cyan)",
        branch: null,
        sessionPath: session.path,
        savedSessionId: targetId,
        titleLocked: isCustom,
        userTitled: isCustom,
      });
      if (window.__TAURI__) {
        try {
          await window.__TAURI__.core.invoke("start_session", {
            sessionId: id,
            cwd: cwd,
            resume: session.path,
          });
        } catch (err) {
          console.warn("[live] resumeSession start_session failed:", err);
        }
      }
      if (cwd && window.__TAURI__) {
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
      _startQueues.delete(id);
      loginInFlight.delete(id);
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke("stop_session",   { sessionId: id }).catch(() => {});
        window.__TAURI__.core.invoke("stop_git_watch", { sessionId: id }).catch(() => {});
      }
      const gitUnlisten = gitListeners.get(id);
      if (gitUnlisten) { gitUnlisten(); gitListeners.delete(id); }
      sessionRegistry.delete(id);
      sessionSnapshots.delete(id);
      // Clear peer if closing the peer session
      window.PeerSessionBridge.clearIfMatch(id);
      // If no sessions remain, immediately reset and create a clean default "PiDesk" session
      if (sessionRegistry.size === 0) {
        for (const ul of rt.conn.activeListeners) { try { await ul(); } catch (_) {} }
        rt.conn.activeListeners = [];
        rt.conn.activeSessionId = null;
        _resetSession();
        await this.openSession(null);
        return;
      }

      if (id === rt.conn.activeSessionId) {
        const remaining = [...sessionRegistry.keys()];
        await _switchToSession(remaining[remaining.length - 1]);
      } else {
        notify(); // tab list changed
      }
    },

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
      _dispatchLine(line);
    },

    _handleResponse(resp) {
      _handleResponse(resp);
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
