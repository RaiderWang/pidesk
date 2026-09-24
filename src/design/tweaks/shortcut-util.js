// tweaks/shortcut-util.js — Pure helpers for parsing, formatting, and matching keyboard shortcuts.
// Plain script — IIFE so no declarations leak into document scope.
// Exposes window.ShortcutUtil.

(function () {
  "use strict";

  var IS_MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || "");

  /**
   * Normalize an event key name to a canonical shortcut token.
   * Returns empty string if the key is just a modifier.
   */
  function normalizeKey(key, code) {
    if (!key) return "";
    var lower = key.toLowerCase();
    if (lower === "control" || lower === "shift" || lower === "alt" || lower === "meta") {
      return "";
    }
    if (key === " ") return "Space";
    if (lower === "escape") return "Esc";
    if (lower === "arrowup") return "Up";
    if (lower === "arrowdown") return "Down";
    if (lower === "arrowleft") return "Left";
    if (lower === "arrowright") return "Right";

    // Handle letters: KeyA -> 'A'
    if (code && code.indexOf("Key") === 0) {
      return code.slice(3).toUpperCase();
    }
    // Handle digits: Digit1 -> '1'
    if (code && code.indexOf("Digit") === 0) {
      return code.slice(5);
    }
    // Handle Function keys F1-F12
    if (/^f[1-9][0-2]?$/i.test(key)) {
      return key.toUpperCase();
    }
    return key.length === 1 ? key.toUpperCase() : key;
  }

  /**
   * Convert a keyboard event into a canonical shortcut string (e.g. "CmdOrCtrl+Shift+Space", "Alt+S").
   * Returns null if no non-modifier key was pressed.
   */
  function parseKeyCombo(e) {
    var primaryKey = normalizeKey(e.key, e.code);
    if (!primaryKey) return null;

    var parts = [];
    var hasCtrl = e.ctrlKey;
    var hasMeta = e.metaKey;

    if (hasCtrl || hasMeta) {
      parts.push("CmdOrCtrl");
    }
    if (e.altKey) {
      parts.push("Alt");
    }
    if (e.shiftKey) {
      parts.push("Shift");
    }

    parts.push(primaryKey);
    return parts.join("+");
  }

  /**
   * Format a canonical shortcut string for UI display.
   * E.g. "CmdOrCtrl+Shift+Space" -> "Ctrl + Shift + Space" (or "⌘ + ⇧ + Space" on Mac).
   */
  function formatDisplayShortcut(shortcutStr) {
    if (!shortcutStr) return "";
    var parts = shortcutStr.split("+").map(function (p) { return p.trim(); });
    var displayParts = parts.map(function (p) {
      if (p === "CmdOrCtrl") return IS_MAC ? "⌘" : "Ctrl";
      if (p === "Command" || p === "Cmd") return IS_MAC ? "⌘" : "Cmd";
      if (p === "Control" || p === "Ctrl") return IS_MAC ? "⌃" : "Ctrl";
      if (p === "Alt") return IS_MAC ? "⌥" : "Alt";
      if (p === "Shift") return IS_MAC ? "⇧" : "Shift";
      return p;
    });
    return displayParts.join(" + ");
  }

  /**
   * Check whether a KeyboardEvent matches a canonical shortcut string.
   */
  function matchesShortcut(e, shortcutStr) {
    if (!shortcutStr) return false;
    var currentCombo = parseKeyCombo(e);
    if (!currentCombo) return false;

    // Direct match
    if (currentCombo.toLowerCase() === shortcutStr.toLowerCase()) return true;

    // Normalised token set comparison
    var expectedTokens = shortcutStr.split("+").map(function (t) { return t.trim().toLowerCase(); });
    var actualTokens = currentCombo.split("+").map(function (t) { return t.trim().toLowerCase(); });

    if (expectedTokens.length !== actualTokens.length) return false;

    // Handle "cmdorctrl" matching "ctrl" or "cmd"
    for (var i = 0; i < expectedTokens.length; i++) {
      var exp = expectedTokens[i];
      if (exp === "cmdorctrl") {
        if (!e.ctrlKey && !e.metaKey) return false;
      } else if (exp === "ctrl" || exp === "control") {
        if (!e.ctrlKey) return false;
      } else if (exp === "alt") {
        if (!e.altKey) return false;
      } else if (exp === "shift") {
        if (!e.shiftKey) return false;
      } else if (exp === "cmd" || exp === "command" || exp === "meta" || exp === "super") {
        if (!e.metaKey) return false;
      } else {
        var key = normalizeKey(e.key, e.code).toLowerCase();
        if (exp !== key) return false;
      }
    }
    return true;
  }

  window.ShortcutUtil = {
    parseKeyCombo: parseKeyCombo,
    formatDisplayShortcut: formatDisplayShortcut,
    matchesShortcut: matchesShortcut,
    normalizeKey: normalizeKey,
  };
})();
