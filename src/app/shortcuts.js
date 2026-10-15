/* app/shortcuts.js — single source of truth for in-app keyboard shortcuts.

   Keys use the same canonical format as ShortcutUtil (design/tweaks/
   shortcut-util.js), e.g. "CmdOrCtrl+K". Must load after shortcut-util.js.
   The registry feeds the global key handler, palette hints, tooltips and
   the shortcuts help overlay. OS-level shortcuts (Quick Bar, screenshot)
   are user-configurable and therefore passed in via `listForDisplay`. */
(function () {
  const REGISTRY = Object.freeze([
    { id: "palette",     keys: "CmdOrCtrl+K", group: "general", labelKey: "shortcut.palette",     fallback: "Command palette" },
    { id: "help",        keys: "CmdOrCtrl+/", group: "general", labelKey: "shortcut.help",        fallback: "Keyboard shortcuts" },
    { id: "openProject", keys: "CmdOrCtrl+O", group: "session", labelKey: "shortcut.openProject", fallback: "Open project folder" },
    { id: "newSession",  keys: "CmdOrCtrl+T", group: "session", labelKey: "shortcut.newSession",  fallback: "New session (no project)" },
    { id: "history",     keys: "CmdOrCtrl+H", group: "session", labelKey: "shortcut.history",     fallback: "Conversation history" },
    { id: "models",      keys: "CmdOrCtrl+M", group: "session", labelKey: "shortcut.models",      fallback: "Manage models" },
    { id: "toggleFiles", keys: "CmdOrCtrl+B", group: "panels",  labelKey: "shortcut.toggleFiles", fallback: "Toggle files panel" },
    { id: "togglePlan",  keys: "CmdOrCtrl+J", group: "panels",  labelKey: "shortcut.togglePlan",  fallback: "Toggle plan panel" },
  ]);

  const GROUP_ORDER = ["general", "session", "panels", "system"];

  function findById(id) {
    return REGISTRY.find((s) => s.id === id) || null;
  }

  function keysFor(id) {
    const entry = findById(id);
    return entry ? entry.keys : "";
  }

  /** Id of the registry entry matching a keydown event, or null. */
  function matchAction(e) {
    const util = window.ShortcutUtil;
    if (!util || !e || e.isComposing) return null;
    for (const s of REGISTRY) {
      if (util.matchesShortcut(e, s.keys)) return s.id;
    }
    return null;
  }

  // Shortcuts that stay live while a modal is open: they toggle a modal
  // themselves (palette / help). Everything else would act behind the dialog.
  const MODAL_SAFE = Object.freeze(["palette", "help"]);

  /** Whether a matched shortcut should run given the current modal state. */
  function shouldDispatch(id, { modalOpen = false, defaultPrevented = false } = {}) {
    if (!id || defaultPrevented) return false;
    return !modalOpen || MODAL_SAFE.includes(id);
  }

  /** Compact display: "Ctrl+K" on Windows/Linux, "⌘K" on macOS. */
  function formatKeys(keys, isMac) {
    if (!keys) return "";
    const parts = keys.split("+").map((p) => p.trim()).filter(Boolean);
    const mapped = parts.map((p) => {
      if (p === "CmdOrCtrl") return isMac ? "⌘" : "Ctrl";
      if (p === "Cmd" || p === "Command") return isMac ? "⌘" : "Cmd";
      if (p === "Ctrl" || p === "Control") return isMac ? "⌃" : "Ctrl";
      if (p === "Alt") return isMac ? "⌥" : "Alt";
      if (p === "Shift") return isMac ? "⇧" : "Shift";
      return p;
    });
    return mapped.join(isMac ? "" : "+");
  }

  function detectMac() {
    return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || "");
  }

  /** Display string for a registry id on the current platform. */
  function displayFor(id) {
    return formatKeys(keysFor(id), detectMac());
  }

  /** Registry + user-configured OS-level shortcuts, for help/overview UIs. */
  function listForDisplay(system) {
    const rows = REGISTRY.map((s) => ({ ...s }));
    if (system && system.quickBar) {
      rows.push({ id: "quickBar", keys: system.quickBar, group: "system", labelKey: "shortcut.quickBar", fallback: "Toggle Quick Bar" });
    }
    if (system && system.screenshot) {
      rows.push({ id: "screenshot", keys: system.screenshot, group: "system", labelKey: "shortcut.screenshot", fallback: "Region screenshot" });
    }
    return rows;
  }

  window.AppShortcuts = {
    REGISTRY, GROUP_ORDER, MODAL_SAFE, findById, keysFor, matchAction, shouldDispatch, formatKeys, displayFor, listForDisplay,
  };
})();
