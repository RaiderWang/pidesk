/* live/session-switch.js — make another tab the active one.

   switchToSession: snapshot the current tab → drop its listeners and the state
   that cannot survive a switch → restore the target's snapshot (or start fresh)
   → attach agent://line|exit listeners → read the process status (startup error /
   still starting / running) → re-fetch. All collaborators are injected.
   Registers window._Live.SessionSwitch. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {object}   ctx.runtime               live/runtime.js instance (save / restore)
   * @param {Function} ctx.notify
   * @param {Array}    ctx.pendingSetModel       cleared on every switch (responses never arrive)
   * @param {Map}      ctx.startQueues           sessionId → commands held while omp starts
   * @param {Map}      ctx.loginInFlight         sessionId → in-flight login tokens
   * @param {object}   ctx.ui                    EventsUi instance (resetHandshake)
   * @param {Function} ctx.resetSession          wipe per-tab state + ask handshake
   * @param {Function} ctx.settleInFlightActions ({ aborted })
   * @param {Function} ctx.handleLine            one stdout line of the active session
   * @param {Function} ctx.initFetch             initial state/messages/models fetch
   * @param {Function} ctx.onAgentStarted        omp came up after a grace-period start
   * @param {Function} ctx.awaitBridgesIdle      resolves once undo/export no longer await responses
   */
  function create({
    state, rt, runtime, notify, pendingSetModel, startQueues, loginInFlight, ui,
    resetSession, settleInFlightActions, handleLine, initFetch, onAgentStarted, awaitBridgesIdle,
  }) {
    // `fresh` skips the cached snapshot and starts from a blank state (so the
    // saved model/thinking prefs are pushed to the new process), even if one exists.
    async function switchToSession(id, { fresh = false } = {}) {
      if (!window.__TAURI__) return;

      // Auto-clear peer if switching to the peer tab (redundant to monitor yourself)
      window.PeerSessionBridge.clearIfMatch(id);

      // An in-flight undo awaits RPC responses on the *current* listener; wait
      // for it so its responses (and composer restore) land in the right tab.
      await awaitBridgesIdle();

      // Snapshot current session so we can restore it when switching back
      runtime.save();
      // Frames for this session stop arriving once its listeners are torn down,
      // so an armed "Other" handshake can never be consumed — never carry it over.
      ui.resetHandshake();
      // Listeners are torn down below; responses to in-flight set_model never arrive.
      pendingSetModel.length = 0;

      // Tear down old listeners
      for (const ul of rt.conn.activeListeners) { try { await ul(); } catch (_) {} }
      rt.conn.activeListeners = [];

      rt.conn.activeSessionId = id;
      rt.conn.agentStarting = false;
      const waitSeq = ++rt.conn.startWaitSeq;

      // Restore cached snapshot (preserves streaming messages) or start fresh
      if (fresh || !runtime.restore(id)) {
        resetSession();
        rt.session.sessionFresh = true;
      } else {
        rt.session.sessionFresh = false;
      }

      const notRunningText = () =>
        (window.t ? window.t("agent.processNotRunning") : "Agent process (omp) is not running");

      // The AgentErrorBanner shows the full reason with Retry/Copy; a chat
      // bubble would duplicate it and go stale once Retry succeeds. Callers notify().
      function setAgentFailure(reason) {
        state.isStreaming = false;
        // Any failure ends a pending startup wait: stop its poll, drop what
        // was queued for it and clear the "Starting agent…" indicator.
        rt.conn.startWaitSeq++;
        rt.conn.agentStarting = false;
        startQueues.delete(id);
        state.agentError = (typeof reason === "string" && reason.trim()) || notRunningText();
      }

      const { listen } = window.__TAURI__.event;
      const ulLine = await listen(`agent://line/${id}`, ev => handleLine(ev.payload));
      const ulExit = await listen(`agent://exit/${id}`, ev => {
        const reason = (ev?.payload && String(ev.payload).trim()) || "";
        console.warn(`[live] session '${id}' omp process exited${reason ? ": " + reason : ""}`);
        setAgentFailure(reason);
        settleInFlightActions({ aborted: true }); // pending compact card, open asks, ...
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
          setAgentFailure(startupMsg);
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
          onRunning: () => onAgentStarted(),
          onFailed: (reason) => {
            setAgentFailure(reason);
            notify();
          },
        });
        notify();
        return;
      }

      // Re-fetch to pick up events missed while not listening.
      // get_messages handler merges completed turns with the cached streaming bubble.
      initFetch();
      notify();
    }

    return { switchToSession };
  }

  window._Live.SessionSwitch = { create };
})();
