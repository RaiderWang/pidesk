/* ═════════════════════════════════════════════════════════════════════
   app/file-watch-match.js — pure path logic for the file tree watcher.
   Decides whether a `files://changed` payload concerns the panel's root.
   Plain script (IIFE): exposes `window.FileWatchMatch`.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  const WINDOWS_PATH = /^([a-z]:\/|\/\/)/i;

  /** `\` → `/`, trailing slashes dropped (but `/` and `c:/` stay intact). */
  function normalize(p) {
    if (typeof p !== "string" || p === "") return "";
    const s = p.replace(/\\/g, "/");
    if (/^[a-z]:\/*$/i.test(s)) return s.slice(0, 2) + "/";
    if (/^\/+$/.test(s)) return "/";
    return s.replace(/\/+$/, "");
  }

  /** Windows paths compare case-insensitively, POSIX paths do not. */
  function foldCase(p) {
    return WINDOWS_PATH.test(p) ? p.toLowerCase() : p;
  }

  /**
   * True when `child` is `base` or lies inside it, compared on directory
   * boundaries: `c:/proj/app-v2` is NOT inside `c:/proj/app`.
   */
  function isSameOrInside(base, child) {
    const b = foldCase(normalize(base));
    const c = foldCase(normalize(child));
    if (!b || !c) return false;
    if (c === b) return true;
    return c.startsWith(b.endsWith("/") ? b : b + "/");
  }

  /**
   * Whether an event payload `{ watchId, path }` should refresh the panel
   * showing `rootPath`, which is watched under `watchId`. A missing payload
   * never matches.
   */
  function matchesEvent(payload, watchId, rootPath) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.watchId && payload.watchId === watchId) return true;
    return isSameOrInside(payload.path, rootPath);
  }

  window.FileWatchMatch = { normalize, isSameOrInside, matchesEvent };
})();
