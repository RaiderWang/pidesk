/* peer-session.js — Peer (pinned) session monitoring for the ambient rail.
   Depends on: adapter.js (normalizeToolName must be on window).
   Exposes: window.PeerSessionBridge

   "Pin" another session so its live activity is visible in the ambient
   rail card while you work in the active session.  Lightweight listener:
   only tracks activity, TPS, todo progress, and streaming status — no
   full message history, just enough for the PeerSession widget. */

(function () {
  "use strict";
  const { timeNow } = window;

  // ── Peer state ──────────────────────────────────────────────────────────
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

  // ── Injected dependencies (wired by live.js via init()) ─────────────────
  let _notify          = null;
  let _sessionRegistry = null;

  function init({ notify, sessionRegistry }) {
    _notify          = notify;
    _sessionRegistry = sessionRegistry;
  }

  // ── Build the peer data snapshot consumed by React ──────────────────────
  function build() {
    if (!peerSessionId) return null;
    const entry = _sessionRegistry.get(peerSessionId);
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

  // ── Send a command to a specific (non-active) session ───────────────────
  function _sendTo(sessionId, cmd) {
    if (!window.__TAURI__ || !sessionId) return;
    window.__TAURI__.core
      .invoke("send_command", { sessionId, json: JSON.stringify(cmd) })
      .catch(e => console.error("[peer] sendTo error:", e));
  }

  // ── Start / stop peer event listeners ───────────────────────────────────
  async function _start(id) {
    _stop();
    if (!window.__TAURI__ || !id) return;
    Object.assign(peerState, {
      activity: "idle", tps: 0,
      todo: { done: 0, total: 0 },
      isStreaming: false, title: "",
      recentTools: [], thought: null,
    });
    peerTurnStart = null;
    const { listen } = window.__TAURI__.event;
    const ulLine = await listen(`agent://line/${id}`, ev => _handleLine(ev.payload));
    const ulExit = await listen(`agent://exit/${id}`, () => {
      peerState.isStreaming = false;
      peerState.activity = "exited";
      _debouncedNotify();
    });
    peerListeners = [ulLine, ulExit];
    // Fetch initial state so the card shows current todo/streaming status
    _sendTo(id, { type: "get_state" });
  }

  function _stop() {
    for (const ul of peerListeners) { try { ul(); } catch (_) {} }
    peerListeners = [];
    if (_peerNotifyTimer) { clearTimeout(_peerNotifyTimer); _peerNotifyTimer = null; }
  }

  // ── Throttled notify — at most 10 updates/sec to avoid flooding React ──
  function _debouncedNotify() {
    if (_peerNotifyTimer) return;
    _peerNotifyTimer = setTimeout(() => {
      _peerNotifyTimer = null;
      window.OMP_DATA.peer = build();
      _notify();
    }, 100);
  }

  // ── Handle a single stdout line from the peer omp process ───────────────
  function _handleLine(rawLine) {
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

    if (changed) _debouncedNotify();
  }

  // ── Public helpers for live.js ──────────────────────────────────────────

  /** Auto-clear peer if switching to / closing the pinned tab. */
  function clearIfMatch(id) {
    if (id === peerSessionId) {
      _stop();
      peerSessionId = null;
    }
  }

  /** Pin another session as the peer to monitor in the ambient rail. */
  function pin(id, activeSessionId) {
    if (!id || id === activeSessionId || !_sessionRegistry.has(id)) return;
    peerSessionId = id;
    _start(id);
  }

  /** Unpin the peer session. */
  function unpin() {
    _stop();
    peerSessionId = null;
    window.OMP_DATA.peer = null;
    _notify();
  }

  window.PeerSessionBridge = {
    init,
    get id() { return peerSessionId; },
    build,
    pin,
    unpin,
    clearIfMatch,
  };
})();
