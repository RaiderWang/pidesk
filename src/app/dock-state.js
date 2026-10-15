/* app/dock-state.js — persisted dock/file-tree UI state (`pidesk:dock-state`).
   Pure functions over a Storage-like object so they are unit-testable;
   nothing here throws on corrupt or unavailable storage. */
(function () {
  const KEY = "pidesk:dock-state";
  const LEGACY_FILES_OPEN = "pidesk:files-panel-open";
  const LEGACY_FILES_WIDTH = "pidesk:files-panel-width";
  const TABS = ["overview", "plan"];

  function defaults() {
    const L = window.DockLayout;
    return { filesOpen: true, filesWidth: L.FILES.def, dockOpen: true, dockTab: "overview", dockWidth: L.DOCK.def };
  }

  /** Merge `raw` over defaults, dropping invalid fields and clamping widths. */
  function normalizeDockState(raw) {
    const L = window.DockLayout;
    const out = defaults();
    if (!raw || typeof raw !== "object") return out;
    if (typeof raw.filesOpen === "boolean") out.filesOpen = raw.filesOpen;
    if (typeof raw.dockOpen === "boolean") out.dockOpen = raw.dockOpen;
    if (TABS.includes(raw.dockTab)) out.dockTab = raw.dockTab;
    if (Number.isFinite(raw.filesWidth)) out.filesWidth = L.clamp(raw.filesWidth, L.FILES);
    if (Number.isFinite(raw.dockWidth)) out.dockWidth = L.clamp(raw.dockWidth, L.DOCK);
    return out;
  }

  function readLegacy(storage) {
    const legacy = {};
    try {
      const open = storage.getItem(LEGACY_FILES_OPEN);
      if (open !== null) {
        const parsed = JSON.parse(open);
        if (typeof parsed === "boolean") legacy.filesOpen = parsed;
      }
    } catch { /* ignore corrupt legacy value */ }
    try {
      const w = storage.getItem(LEGACY_FILES_WIDTH);
      if (w !== null && w !== "") legacy.filesWidth = Number(w);
    } catch { /* ignore */ }
    return legacy;
  }

  /** Load state; falls back to the pre-dock files-panel keys, then defaults. */
  function loadDockState(storage) {
    if (!storage) return defaults();
    try {
      const raw = storage.getItem(KEY);
      if (raw !== null) return normalizeDockState(JSON.parse(raw));
    } catch { /* corrupt JSON: fall through to migration */ }
    return normalizeDockState(readLegacy(storage));
  }

  /** Persist state. Returns true when written. */
  function saveDockState(storage, state) {
    if (!storage) return false;
    try {
      storage.setItem(KEY, JSON.stringify(normalizeDockState(state)));
      return true;
    } catch {
      return false;
    }
  }

  /** Layout value to highlight in Tweaks: "rail" with the dock closed is "focus" in effect. */
  function layoutForDisplay(layout, dockOpen) {
    return layout === "rail" && dockOpen === false ? "focus" : layout;
  }

  window.DockState = { KEY, TABS, defaults, normalizeDockState, loadDockState, saveDockState, layoutForDisplay };
})();
