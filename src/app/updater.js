/* app/updater.js — pure logic behind in-app updates: the phase state machine,
   "ignore this version" persistence and release-note summarising.
   No DOM, no React, no Tauri (those live in use-updater.jsx). */
(function () {
  /** Delay before the silent startup check, so it never competes with boot. */
  const AUTO_CHECK_DELAY_MS = 5000;
  /** Re-check cadence while the app stays open. */
  const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  /** Manual-download fallback (e.g. updater cannot replace a .deb install). */
  const RELEASES_URL = "https://github.com/RaiderWang/pidesk/releases/latest";
  const IGNORED_KEY = "pidesk.update.ignored";

  /**
   * Phases: idle | checking | available | downloading | ready | uptodate | error.
   * `source` tells an `error` apart: "check" (lookup failed) vs "install".
   * `manual` is true when the user (not the timer) started the check.
   * `dismissed` only hides the floating banner ("Later"); `phase` and `info`
   * stay so Settings can still offer install / restart.
   */
  function initialState() {
    return { phase: "idle", info: null, percent: null, error: null, source: null, manual: false, dismissed: false };
  }

  function isInstallError(s) {
    return s.phase === "error" && s.source === "install";
  }

  /** Reducer for the update flow. Unknown/illegal transitions return `state`. */
  function reduce(state, action) {
    const s = state || initialState();
    switch (action && action.type) {
      case "check-start":
        if (s.phase === "downloading" || s.phase === "ready") return s;
        // A second check while one is in flight only upgrades it to manual.
        if (s.phase === "checking") return { ...s, manual: s.manual || !!action.manual };
        // Silent checks never disturb a known update or a retryable install error.
        if (!action.manual && (s.phase === "available" || isInstallError(s))) return s;
        return { ...initialState(), phase: "checking", manual: !!action.manual };
      case "check-found":
        if (s.phase !== "checking") return s;
        // A silent check never resurfaces a version the user chose to ignore.
        if (action.ignored && !s.manual) return { ...initialState(), phase: "idle" };
        return { ...initialState(), phase: "available", info: action.info, manual: s.manual };
      case "check-none":
        if (s.phase !== "checking") return s;
        return { ...initialState(), phase: "uptodate", manual: s.manual };
      case "check-fail":
        if (s.phase !== "checking") return s;
        return { ...initialState(), phase: "error", error: action.error || "", source: "check", manual: s.manual };
      case "install-start":
        if (!s.info || (s.phase !== "available" && !isInstallError(s))) return s;
        return { ...s, phase: "downloading", percent: 0, error: null, source: null, dismissed: false };
      case "progress":
        if (s.phase !== "downloading") return s;
        return { ...s, percent: typeof action.percent === "number" ? clampPercent(action.percent) : s.percent };
      case "installed":
        if (s.phase !== "downloading") return s;
        return { ...s, phase: "ready", percent: 100, dismissed: false };
      case "install-fail":
        if (s.phase !== "downloading") return s;
        return { ...s, phase: "error", error: action.error || "", source: "install", percent: null, dismissed: false };
      case "dismiss":
        // "Later": hide the banner only; Settings keeps the install / restart action.
        if (s.phase !== "available" && s.phase !== "ready" && !isInstallError(s)) return s;
        return { ...s, dismissed: true };
      case "ignore":
        // "Skip this version": forget the update entirely (persisted by the caller).
        if (s.phase === "downloading" || s.phase === "checking") return s;
        return initialState();
      default:
        return s;
    }
  }

  function clampPercent(p) {
    if (!Number.isFinite(p)) return 0;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  /**
   * Whether a `check_update` request should actually be sent. The reducer may
   * still accept `check-start` (e.g. to upgrade an in-flight check to manual)
   * without a new request being needed.
   */
  function canCheck(state, manual) {
    const s = state || initialState();
    if (s.phase === "checking" || s.phase === "downloading" || s.phase === "ready") return false;
    if (!manual && (s.phase === "available" || isInstallError(s))) return false;
    return true;
  }

  /** Whether `install_update` may be started from this state. */
  function canInstall(state) {
    const s = state || initialState();
    return !!s.info && (s.phase === "available" || isInstallError(s));
  }

  /** Whether the floating banner should be on screen for this state. */
  function isBannerVisible(state) {
    if (!state || state.dismissed) return false;
    if (state.phase === "available" || state.phase === "downloading" || state.phase === "ready") return true;
    // A failed lookup is reported inline in settings only; a failed install needs a retry affordance.
    return isInstallError(state);
  }

  function isIgnored(info, ignoredVersion) {
    return !!(info && info.version && ignoredVersion && info.version === ignoredVersion);
  }

  function loadIgnored(storage) {
    try {
      return (storage && storage.getItem(IGNORED_KEY)) || "";
    } catch (_) {
      return "";
    }
  }

  function saveIgnored(storage, version) {
    try {
      if (storage) storage.setItem(IGNORED_KEY, String(version || ""));
    } catch (_) { /* storage unavailable: ignoring then lasts for this session only */ }
  }

  /** Drop common inline Markdown (bold, code, links) for plain-text display. */
  function stripInline(line) {
    return line
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  }

  /**
   * Compact release-note preview. The release body is built by
   * scripts/generate-release-body.mjs: a `## PiDesk vX` title, a "What's
   * Changed" heading, the changelog, then `---` and an install guide. This
   * keeps only the changelog part: stops at the first `---` after content,
   * skips h1/h2 and "What's Changed" headings, strips inline Markdown, keeps
   * the first `maxLines` lines and caps at `maxChars` (ellipsis when cut).
   */
  function summarizeNotes(notes, maxLines = 6, maxChars = 320) {
    if (typeof notes !== "string") return "";
    const lines = [];
    for (const raw of notes.split(/\r?\n/)) {
      if (/^\s*-{3,}\s*$/.test(raw)) {
        if (lines.length) break;
        continue;
      }
      if (/^\s*#{1,2}\s/.test(raw)) continue;
      if (/^\s*#{1,6}\s.*what'?s changed/i.test(raw)) continue;
      const line = stripInline(raw.replace(/^\s*#{1,6}\s*/, "").trim());
      if (line) lines.push(line);
    }
    if (!lines.length) return "";
    let out = lines.slice(0, maxLines).join("\n");
    let cut = lines.length > maxLines;
    if (out.length > maxChars) {
      out = out.slice(0, maxChars).trimEnd();
      cut = true;
    }
    return cut ? out + "…" : out;
  }

  window.Updater = {
    AUTO_CHECK_DELAY_MS,
    AUTO_CHECK_INTERVAL_MS,
    RELEASES_URL,
    IGNORED_KEY,
    initialState,
    reduce,
    canCheck,
    canInstall,
    isBannerVisible,
    isIgnored,
    loadIgnored,
    saveIgnored,
    summarizeNotes,
  };
})();
