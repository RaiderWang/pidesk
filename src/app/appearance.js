// app/appearance.js — shared appearance-application helper.
// Exposes window.applyAppearance(tweaks) and window.loadTweaksFromStorage().
// Used by the main window (via useThemeEffect in use-bridge-snapshot.jsx) and
// by the Quick Bar webview (inline head script + storage/Tauri event listeners).
// Plain script — IIFE so no globals leak into document scope.

(function () {
  "use strict";

  var VALID_THEMES    = ["aurora", "phosphor", "daylight", "clarity"];
  var VALID_DENSITIES = ["cozy", "compact", "dense"];
  var STORAGE_KEYS    = ["pidesk:tweaks", "omp-desktop:tweaks"];

  var THEME_ACCENTS = {
    clarity: [
      "#2563EB", // cobalt blue (signature default)
      "#0E7490", // deep ocean cyan
      "#047857", // deep emerald green
      "#7C3AED", // royal violet
      "#A21CAF", // berry fuchsia
      "#BE123C", // crimson rose
      "#B45309", // amber bronze
      "#475569", // slate steel
    ],
    daylight: [
      "#1F8A5B", // daylight forest green (signature default)
      "#1F7A8C", // warm deep cyan / teal
      "#2563EB", // cobalt blue
      "#6A4FE0", // deep lilac
      "#C04A56", // warm rose
      "#B45309", // warm amber bronze
      "#C2438C", // warm magenta
      "#475569", // slate
    ],
    aurora: [
      "#78E8BE", "#39E557", "#1F8A5B", "#2563EB", "#6EE7FF", "#FF7AC6", "#FFC56E", "#B59BFF"
    ],
    phosphor: [
      "#39E557", "#78E8BE", "#58F0E0", "#FFD24A", "#A98EFF", "#FF6EAA", "#FF8A6E", "#8EF060"
    ],
  };

  var BRIGHT_TO_DARK_CLARITY = {
    "#78e8be": "#047857",
    "#39e557": "#047857",
    "#1f8a5b": "#047857",
    "#6ee7ff": "#0e7490",
    "#ff7ac6": "#a21caf",
    "#ffc56e": "#b45309",
    "#b59bff": "#7c3aed",
  };

  var BRIGHT_TO_DARK_DAYLIGHT = {
    "#78e8be": "#1f8a5b",
    "#39e557": "#1f8a5b",
    "#6ee7ff": "#1f7a8c",
    "#ff7ac6": "#c2438c",
    "#ffc56e": "#b45309",
    "#b59bff": "#6a4fe0",
  };

  function getThemeAccents(theme) {
    return (THEME_ACCENTS && THEME_ACCENTS[theme]) || (THEME_ACCENTS && THEME_ACCENTS.clarity) || [];
  }

  function normalizeThemeAccent(theme, accent) {
    var accents = getThemeAccents(theme);
    var defaultAccent = accents[0];
    if (!accent) return defaultAccent;

    var lower = String(accent).toLowerCase();
    var mapped = lower;
    if (theme === "clarity" && BRIGHT_TO_DARK_CLARITY[lower]) {
      mapped = BRIGHT_TO_DARK_CLARITY[lower].toLowerCase();
    } else if (theme === "daylight" && BRIGHT_TO_DARK_DAYLIGHT[lower]) {
      mapped = BRIGHT_TO_DARK_DAYLIGHT[lower].toLowerCase();
    }

    // Ensure the resulting accent is in the theme's curated palette.
    // If not found, fall back to the theme's signature default accent
    // so the Tweaks color picker always has an active, checked chip.
    for (var i = 0; i < accents.length; i++) {
      if (accents[i].toLowerCase() === mapped) {
        return accents[i];
      }
    }
    return defaultAccent;
  }

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
    root.classList.remove("theme-aurora", "theme-phosphor", "theme-daylight", "theme-clarity");
    root.classList.add("theme-" + theme);

    // Density
    var density = VALID_DENSITIES.indexOf(opts.density) >= 0 ? opts.density : "compact";
    root.classList.remove("density-cozy", "density-compact", "density-dense");
    root.classList.add("density-" + density);

    // Mono-chat
    if (opts.monoChat) root.classList.add("mono-chat");
    else               root.classList.remove("mono-chat");

    // Accent colour (CSS custom property)
    if (opts.accent) {
      var accent = normalizeThemeAccent(theme, opts.accent);
      root.style.setProperty("--accent", accent);
    }

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
        if (raw) {
          var data = JSON.parse(raw);
          if (data && data.theme && data.accent) {
            data.accent = normalizeThemeAccent(data.theme, data.accent);
          }
          return data;
        }
      }
    } catch (_) {}
    return null;
  }

  window.THEME_ACCENTS         = THEME_ACCENTS;
  window.getThemeAccents       = getThemeAccents;
  window.normalizeThemeAccent  = normalizeThemeAccent;
  window.applyAppearance       = applyAppearance;
  window.loadTweaksFromStorage = loadTweaksFromStorage;
})();
