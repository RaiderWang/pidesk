/* live/sessions.js — tab lifecycle: open, resume, activate, close, retry, restart.

   The tab list is `sessionRegistry`; making a tab active is session-switch.js,
   forking one is session-branch.js. Also owns the git-branch watch shared by
   every path that creates a tab. All collaborators are injected into create().
   Registers window._Live.Sessions. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  const defaultNorm = p => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const errText = err => (err && typeof err === "string") ? err : (err?.message || String(err));

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {object}   ctx.runtime            live/runtime.js instance (genSessionId)
   * @param {Function} ctx.notify
   * @param {Map}      ctx.sessionRegistry
   * @param {Map}      ctx.sessionSnapshots
   * @param {Map}      ctx.gitListeners       sessionId → unlisten fn for git://branch/{id}
   * @param {Map}      ctx.startQueues        sessionId → commands held while omp starts
   * @param {Map}      ctx.loginInFlight      sessionId → in-flight login tokens
   * @param {Function} ctx.resetSession       wipe per-tab state + ask handshake
   * @param {Function} ctx.switchToSession    SessionSwitch#switchToSession
   */
  function create({
    state, rt, runtime, notify, sessionRegistry, sessionSnapshots, gitListeners,
    startQueues, loginInFlight, resetSession, switchToSession,
  }) {
    // Read the initial branch and arm the HEAD watcher (Rust re-emits
    // git://branch/{id} whenever .git/HEAD changes). Errors are non-fatal.
    async function attachGitWatch(id, cwd) {
      if (!cwd || !window.__TAURI__) return;
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

    /** Open a new tab for the given project folder (or standalone if null/empty). Returns the new session id. */
    async function openSession(cwd) {
      const id   = runtime.genSessionId();
      let name = "PiDesk";
      const norm = window.SessionTitle?.normalizePath || defaultNorm;

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
      await attachGitWatch(id, cwd);
      // Activate
      await switchToSession(id);
      return id;
    }

    /** Switch the active tab. Resets state and re-fetches from the session's omp. */
    async function activateSession(id) {
      if (id === rt.conn.activeSessionId) return;
      if (!sessionRegistry.has(id)) return;
      await switchToSession(id);
    }

    // The already-open tab holding this saved session, or null.
    function findOpenTab(session, norm, targetPathNorm, targetId) {
      for (const [tabId, entry] of sessionRegistry.entries()) {
        // 1. Direct match on tracked sessionPath / savedSessionId
        if (entry.sessionPath && norm(entry.sessionPath) === targetPathNorm) return tabId;
        if (entry.savedSessionId && targetId && entry.savedSessionId === targetId) return tabId;
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
            return tabId;
          }
        }
      }
      return null;
    }

    /** Resume a saved session into a new tab (or switch to existing tab if already opened). */
    async function resumeSession(session) {
      if (!session || !session.path) return null;

      const norm = window.SessionTitle?.normalizePath || defaultNorm;
      const targetPathNorm = norm(session.path);
      const targetId = session.id ? String(session.id).trim() : null;

      // Check if this saved session is already open in an existing tab
      const openTab = findOpenTab(session, norm, targetPathNorm, targetId);
      if (openTab !== null) {
        await activateSession(openTab);
        return openTab;
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
      await attachGitWatch(id, cwd);
      await switchToSession(id);
      return id;
    }

    /** Close a tab and kill its omp process. */
    async function closeSession(id) {
      startQueues.delete(id);
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
        resetSession();
        await openSession(null);
        return;
      }

      if (id === rt.conn.activeSessionId) {
        const remaining = [...sessionRegistry.keys()];
        await switchToSession(remaining[remaining.length - 1]);
      } else {
        notify(); // tab list changed
      }
    }

    async function retrySession(id = rt.conn.activeSessionId) {
      if (!window.__TAURI__ || !id) return;
      const entry = sessionRegistry.get(id);
      const cwd = entry?.path ?? "";
      state.agentError = null;
      notify();
      try {
        await window.__TAURI__.core.invoke("start_session", { sessionId: id, cwd });
      } catch (err) {
        console.warn(`[live] retrySession '${id}' failed:`, err);
        state.agentError = errText(err);
        notify();
        return;
      }
      await switchToSession(id);
    }

    /**
     * Respawn the active tab's omp so it re-reads models.yml (omp has no RPC
     * for that), resuming the same session file to keep the history. Refuses
     * while a turn / background work runs. Resolves { ok } or { ok:false, reason }.
     */
    async function restartActiveSession() {
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
        const error = errText(err);
        console.warn(`[live] restartActiveSession '${id}' failed:`, err);
        state.agentError = error;
        notify();
        return { ok: false, reason: "start-failed", error };
      }
      // With --resume omp restores the session's own model and thinking level, and
      // get_state reports them — pushing the global last-used prefs (restorePrefs,
      // i.e. a fresh switch) would clobber another tab's choice, so keep the snapshot.
      // Without a session (still-empty tab) the new process is just a new session:
      // start blank so the saved prefs are applied like for any new tab.
      await switchToSession(id, { fresh: !plan.resume });
      return { ok: true };
    }

    return {
      attachGitWatch,
      api: { openSession, activateSession, resumeSession, closeSession, retrySession, restartActiveSession },
    };
  }

  window._Live.Sessions = { create };
})();
