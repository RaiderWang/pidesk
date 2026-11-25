/* live/prefs.js — user preference persistence (last model + thinking level).
   Saved in localStorage so a fresh omp process can be pushed back to the
   user's previous choice after an app restart. */
(function () {
  "use strict";
  const PREFS_KEY = "pidesk:prefs";

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function savePrefs(patch) {
    try {
      const prev = loadPrefs();
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch {}
  }

  // savePrefs is a shallow merge and cannot delete keys; write the stripped
  // object back to drop a dangling model (renamed/deleted in models.yml).
  function clearModelPrefs() {
    try {
      const prev = loadPrefs();
      const next = window.ModelPrefs ? window.ModelPrefs.stripModel(prev) : { ...prev };
      if (!window.ModelPrefs) {
        delete next.modelId; delete next.modelProvider; delete next.modelName;
      }
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {}
  }

  window._Live = window._Live || {};
  window._Live.Prefs = { PREFS_KEY, loadPrefs, savePrefs, clearModelPrefs };
})();
