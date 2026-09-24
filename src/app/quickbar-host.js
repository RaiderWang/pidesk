// app/quickbar-host.js — Main-window relay for the Quick Bar overlay.
// Listens for Tauri events from the quick-bar webview and proxies them
// into OMP_BRIDGE. Streams a throttled snapshot back so the Quick Bar
// can show a live result without loading live.js itself.
//
// Events consumed (from quick-bar → main):
//   quickbar://submit            { text, newSession? } — send prompt
//   quickbar://abort             {}               — abort streaming
//   quickbar://escalate          { text }         — show main window
//   quickbar://appearance-request {}              — request current tweaks
//
// Events emitted (main → quick-bar):
//   quickbar://delta   { html, markdown }  — rendered + raw result so far
//   quickbar://done    null                — streaming finished
//   quickbar://appearance { theme, accent, density, fontSize, monoChat }
//                                          — pushed on tweakchange + request

(function () {
  "use strict";
  if (!window.__TAURI__) return;

  const { listen, emitTo } = window.__TAURI__.event;
  const BRIDGE = () => window.OMP_BRIDGE;

  // ── Minimal snapshot projection ────────────────────────────────────────

  // Render assistant markdown to HTML using the same `marked` (+
  // highlight.js) pipeline the main chat view uses — wired in
  // index.html's inline setup script, which loads before this file (see
  // CLAUDE.md "Frontend load order"). This runs in the *main* window
  // (quickbar-host.js is never loaded by quick-bar.html), so the Quick
  // Bar overlay itself stays markdown-free and just receives ready-made
  // HTML over `quickbar://delta`.
  // Reads the global `window.marked` singleton rather than taking it as
  // a parameter — this repo has no JS test runner (see CLAUDE.md), so
  // this is exercised via manual QA of the Quick Bar overlay rather than
  // an isolated unit test. The escaping fallback below is the piece that
  // previously shipped as the only behaviour; it's kept so a missing/
  // broken `marked` never breaks the overlay, only degrades it.
  function renderMarkdown(text) {
    if (!text) return "";
    if (window.marked) {
      try {
        return window.marked.parse(text);
      } catch (_) {
        // fall through to the plain-text rendering below
      }
    }
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  // Extract the last assistant turn from the messages array.
  // Returns { html, markdown } where `markdown` is the raw text blocks joined
  // with "\n\n" and `html` is the same text rendered through renderMarkdown.
  // `baselineLen` is the message count captured right before this turn's
  // reply could appear — indices before it belong to *older* turns (either
  // earlier history in the active session, or a previous Quick Bar prompt)
  // and must never be projected, even transiently. Without this guard,
  // `turn_start` flips isStreaming=true a beat before the new assistant
  // message is appended, so a naive "last assistant message" scan would
  // briefly surface the *previous* reply.
  // This is the pure function tested via eval proof below.
  function projectLastAssistant(messages, baselineLen = 0) {
    const empty = { html: "", markdown: "" };
    if (!messages || messages.length === 0) return empty;
    for (let i = messages.length - 1; i >= baselineLen; i--) {
      const m = messages[i];
      if (m.kind !== "assistant") continue;
      if (!m.blocks || m.blocks.length === 0) return empty;
      const markdown = m.blocks
        .filter(b => b.type === "text")
        .map(b => b.text ?? "")
        .join("\n\n");
      return { html: renderMarkdown(markdown), markdown };
    }
    return empty;
  }

  // ── Throttled relay ────────────────────────────────────────────────────

  let _unsub = null;        // OMP_BRIDGE.onUpdate unsubscriber
  let _sawStreaming = false; // Must see isStreaming=true before auto-unsubscribe
  let _baselineLen = null;  // Message count before this turn's reply can exist
  let _throttleTimer = null;
  let _lastEmitMs = 0;
  let _pendingSnap = null;  // Always holds the most recent snapshot
  const THROTTLE_MS = 60;   // ~16 fps

  function _emitSnap(snap) {
    _lastEmitMs = Date.now();

    if (snap.isStreaming) _sawStreaming = true;

    // Don't emit deltas until streaming has actually started — avoids
    // flashing stale content from the session's existing history.
    if (!_sawStreaming) return;

    const payload = projectLastAssistant(snap.messages, _baselineLen ?? 0);
    emitTo("quick-bar", "quickbar://delta", payload);

    const activity = snap.isStreaming ? "streaming" : "idle";
    window.__TAURI__.core.invoke("set_tray_activity", { activity }).catch(() => {});

    // Only auto-unsubscribe after we've seen at least one streaming
    // snapshot — prevents premature teardown when _initFetch fires
    // notify() before the turn actually starts.
    if (!snap.isStreaming && _sawStreaming && _unsub) {
      emitTo("quick-bar", "quickbar://done", null);
      _unsub();
      _unsub = null;
      _sawStreaming = false;
      _baselineLen = null;
    }
  }

  function _relay(snap) {
    // First snapshot seen after subscribing: fixes the boundary between
    // "old" messages and this turn's reply, before any new assistant
    // message has been appended.
    if (_baselineLen === null) _baselineLen = snap.messages?.length ?? 0;
    _pendingSnap = snap;
    const now = Date.now();
    if (now - _lastEmitMs < THROTTLE_MS) {
      if (!_throttleTimer) {
        _throttleTimer = setTimeout(() => {
          _throttleTimer = null;
          if (_pendingSnap) _emitSnap(_pendingSnap);
        }, THROTTLE_MS - (now - _lastEmitMs));
      }
      return;
    }
    _emitSnap(snap);
  }

  function _startRelay() {
    if (_unsub) return; // already relaying
    _sawStreaming = false;
    _baselineLen = null; // re-captured from the next snapshot
    const bridge = BRIDGE();
    if (!bridge) return;
    _unsub = bridge.onUpdate(_relay);
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  listen("quickbar://submit", (ev) => {
    const { text, newSession, images } = ev.payload ?? {};
    if (!text && (!images || images.length === 0)) return;
    const bridge = BRIDGE();
    if (!bridge) return;
    const imgs = images ?? [];

    if (newSession) {
      // Create a fresh tab, then send the prompt there.
      bridge.openSession(null).then(() => {
        bridge.send(text, imgs);
        _startRelay();
      });
    } else {
      // Inject into the current active session.
      bridge.send(text, imgs);
      _startRelay();
    }
  });

  listen("quickbar://abort", () => {
    BRIDGE()?.abort();
  });

  listen("quickbar://escalate", (ev) => {
    // Show main window. If text is non-empty, the user can continue there.
    const win = window.__TAURI__.window.getCurrentWindow();
    win.unminimize().catch(() => {});
    win.show().catch(() => {});
    win.setFocus().catch(() => {});
  });

  // ── Appearance sync ──────────────────────────────────────────────────────
  // Pushes theme/density/accent/fontSize/monoChat to the Quick Bar so it
  // matches the main window even though it runs in a separate webview.

  function _appearancePayload() {
    const t = window.loadTweaksFromStorage?.();
    if (!t) return null;
    return {
      theme:    t.theme,
      accent:   t.accent,
      density:  t.density,
      fontSize: t.fontSize,
      monoChat: t.monoChat,
    };
  }

  // Respond to the Quick Bar requesting current tweaks (fires on QB first
  // load while hidden, so quickbar-host.js has its listener set up in time).
  listen("quickbar://appearance-request", () => {
    const payload = _appearancePayload();
    if (payload) emitTo("quick-bar", "quickbar://appearance", payload).catch(() => {});
  });

  // Propagate tweak changes to the Quick Bar in real time.
  // Deferred by one setTimeout so React has flushed _save to localStorage
  // before we read (tweakchange fires while the setState updater may still
  // be pending in the React scheduler).
  window.addEventListener("tweakchange", () => {
    setTimeout(() => {
      const payload = _appearancePayload();
      if (payload) emitTo("quick-bar", "quickbar://appearance", payload).catch(() => {});
    }, 0);
  });

  window.QuickBarHost = { projectLastAssistant, renderMarkdown };
})();
