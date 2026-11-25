/* live/tab-titles.js — tab naming from omp session titles and the first user prompt.

   Pure registry bookkeeping over `sessionRegistry`; the naming rules themselves
   live in app/session-title.js (window.SessionTitle).
   Registers window._Live.TabTitles; collaborators are injected into create(). */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.rt
   * @param {Map}      ctx.sessionRegistry
   * @param {Function} ctx.notify
   */
  function create({ rt, sessionRegistry, notify }) {
    // omp reports its own session id (or ours) in `session_info_update`; map it to a tab.
    function resolveSessionId(targetId) {
      if (!targetId) return rt.conn.activeSessionId;
      if (sessionRegistry.has(targetId)) return targetId;
      for (const [id, entry] of sessionRegistry.entries()) {
        if (entry.savedSessionId && entry.savedSessionId === targetId) return id;
      }
      return rt.conn.activeSessionId;
    }

    // Name an untouched tab after the first user message.
    function updateTabTitleIfDefault(text) {
      const sid = rt.conn.activeSessionId;
      if (!text || !sid || !sessionRegistry.has(sid)) return;
      const entry = sessionRegistry.get(sid);
      const formatted = window.SessionTitle?.nextTitle
        ? window.SessionTitle.nextTitle(entry, text, { force: false })
        : null;
      if (formatted) {
        sessionRegistry.set(sid, { ...entry, name: formatted, titleLocked: true, userTitled: true });
        notify();
      }
    }

    // Apply a title omp reports (always wins over the default name).
    function setTabTitle(rawTitle, targetSessionId = null) {
      const sid = resolveSessionId(targetSessionId);
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
          // corrupt resume de-dup / fork. applyRpcState owns savedSessionId.
          titleLocked: true,
          userTitled: true,
        });
        if (sid === rt.conn.activeSessionId) notify();
      }
    }

    return { resolveSessionId, updateTabTitleIfDefault, setTabTitle };
  }

  window._Live.TabTitles = { create };
})();
