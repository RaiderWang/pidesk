// app/appearance.js — shared appearance-application helper.
// Exposes window.applyAppearance(tweaks) and window.loadTweaksFromStorage().
// Used by the main window (via useThemeEffect in use-bridge-snapshot.jsx) and
// by the Quick Bar webview (inline head script + storage/Tauri event listeners).
// Plain script — IIFE so no globals leak into document scope.

(function () {
  "use strict";

  var VALID_THEMES    = ["aurora", "phosphor", "daylight"];
  var VALID_DENSITIES = ["cozy", "compact", "dense"];
  var STORAGE_KEYS    = ["pidesk:tweaks", "omp-desktop:tweaks"];

  /**
   * Apply theme, density, accent, fontSize and monoChat to <html>.
   * Validates theme/density against known values; silently falls back to
   * defaults so stale/unknown values from localStorage can never crash.
   *
   * @param {{ theme?: string, accent?: string, density?: string, fontSize?: number, monoChat?: boolean }} opts
   */
  function applyAppearance(opts) {
    if (!opts) return;
    var root = document.documentElement;

    // Theme
    var theme = VALID_THEMES.indexOf(opts.theme) >= 0 ? opts.theme : "daylight";
    root.classList.remove("theme-aurora", "theme-phosphor", "theme-daylight");
    root.classList.add("theme-" + theme);

    // Density
    var density = VALID_DENSITIES.indexOf(opts.density) >= 0 ? opts.density : "compact";
    root.classList.remove("density-cozy", "density-compact", "density-dense");
    root.classList.add("density-" + density);

    // Mono-chat
    if (opts.monoChat) root.classList.add("mono-chat");
    else               root.classList.remove("mono-chat");

    // Accent colour (CSS custom property)
    if (opts.accent) root.style.setProperty("--accent", opts.accent);

    // Font size
    if (opts.fontSize) root.style.fontSize = opts.fontSize + "%";
  }

  /**
   * Load raw tweaks object from localStorage (compatible with both storage
   * keys used by this repo). Returns null if nothing is stored or on error.
   */
  function loadTweaksFromStorage() {
    try {
      for (var i = 0; i < STORAGE_KEYS.length; i++) {
        var raw = localStorage.getItem(STORAGE_KEYS[i]);
        if (raw) return JSON.parse(raw);
      }
    } catch (_) {}
    return null;
  }

  window.applyAppearance       = applyAppearance;
  window.loadTweaksFromStorage = loadTweaksFromStorage;
})();
