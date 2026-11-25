/* live/session-branch.js — fork the active session into a new tab.

   Copies the session .jsonl (optionally cut at a stable omp entry id — never at
   a UI index, see app/branch-session.js), resumes the copy in a new omp process
   and switches to it. Any failure to locate the cut point is refused with a
   `branch.fail.*` notice; it never falls back to a full copy.
   Registers window._Live.SessionBranch; collaborators are injected into create(). */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {object}   ctx.runtime            live/runtime.js instance (genSessionId)
   * @param {Function} ctx.notify
   * @param {Map}      ctx.sessionRegistry
   * @param {Function} ctx.sendWithResponse   (cmd, timeoutMs) → Promise<data>
   * @param {Function} ctx.attachGitWatch     Sessions#attachGitWatch
   * @param {Function} ctx.switchToSession    SessionSwitch#switchToSession
   */
  function create({ state, rt, runtime, notify, sessionRegistry, sendWithResponse, attachGitWatch, switchToSession }) {
    /** Fork the active session into a new tab by copying the session file.
     *  If `fromMsgIdx` is a number, only the conversation up to (and including)
     *  that UI message index is kept — messages after it are discarded so the
     *  new tab can diverge from an earlier point.  When omitted or null the
     *  entire session is copied (branch from HEAD). */
    async function branch(fromMsgIdx = null) {
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
          window.NoticeBubble.make(window.t ? window.t(key, params) : key, window.timeNow()),
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
          const listing = await sendWithResponse({ type: "get_entries" }, 30000);
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

        await attachGitWatch(id, cwd);

        await switchToSession(id);
      } catch (err) {
        console.error("[live] branch failed:", err);
        warn("branch.fail.generic", { error: err?.message ?? String(err) });
      }
    }

    return { api: { branch } };
  }

  window._Live.SessionBranch = { create };
})();
