/* ═════════════════════════════════════════════════════════════════════
   session-title.js — pure logic for normalizing and sanitizing session titles.
   Strips plan mode framing templates, removes markdown headers, normalizes
   newlines/whitespace, and clamps max character length.
   Exposes window.SessionTitle (or module.exports in Node).
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SessionTitle = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Cleans and sanitizes a raw session title or user prompt:
   * 1. Strips Plan mode template wrapper (e.g. "Please draft a plan for the following task..." / "请为以下任务起草一份计划……");
   * 2. Strips Markdown heading prefixes (e.g. "# ", "## ");
   * 3. Replaces newlines and tabs with single spaces;
   * 4. Collapses multiple consecutive spaces and trims edges;
   * 5. Enforces a maximum character cap (default 100);
   * 6. Returns fallback if resulting string is empty.
   */
  function cleanSessionTitle(raw, fallback = "", options = {}) {
    if (typeof raw !== "string" || !raw.trim()) {
      return fallback || "";
    }
    const maxLen = typeof options.maxLength === "number" ? options.maxLength : 100;
    const undoMsg = options.undoMessage || (typeof window !== "undefined" ? window.UndoMessage : null);
    const tFn = options.t || (typeof window !== "undefined" ? window.t : null);

    let text = raw;

    // 1. Strip Plan mode framing if UndoMessage is available
    if (undoMsg && typeof undoMsg.stripPlanFraming === "function") {
      try {
        const res = undoMsg.stripPlanFraming(text, tFn);
        if (res && res.text) text = res.text;
      } catch (_) {}
    }

    // 2. Strip @file references (e.g. @"file.txt", @src/live.js)
    text = text.replace(/(?:^|\s)@(?:"[^"]+"|'[^']+'|[^\s@]+)/g, " ");

    // 3. Remove Markdown heading prefixes
    text = text.replace(/^\s*#{1,6}\s+/, "");

    // 4. Replace newlines, tabs, and carriage returns with spaces
    text = text.replace(/[\r\n\t]+/g, " ");

    // 5. Collapse consecutive whitespace and trim
    text = text.replace(/\s{2,}/g, " ").trim();

    // 6. Clamps maximum length (surrogate-pair safe)
    const chars = Array.from(text);
    if (chars.length > maxLen) {
      text = chars.slice(0, maxLen).join("").trim();
    }

    return text || fallback || "";
  }

  /**
   * Extracts the last folder segment from a filesystem path, normalizing
   * slashes and ignoring trailing separators.
   * e.g. "F:/Project/omp-desktop/" -> "omp-desktop"
   */
  function folderName(path) {
    if (!path || typeof path !== "string") return "";
    return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  }

  /**
   * Resolves a folder title for file tree / drawer headers, prioritizing
   * folder name over generic project names or "Files".
   */
  function resolveFolderTitle(rootPath, fallbackProjectName = "Files") {
    const folder = folderName(rootPath);
    return folder || fallbackProjectName || "Files";
  }

  const DEFAULT_NAME_RE = /^(PiDesk(\s*\(\d+\))?|resumed)$/i;

  /**
   * Checks whether a session name is a default / uncustomized placeholder name
   * (e.g. "PiDesk", "PiDesk (2)", "resumed").
   */
  function isDefaultSessionName(name) {
    if (!name || typeof name !== "string") return true;
    return DEFAULT_NAME_RE.test(name.trim());
  }

  /**
   * Checks whether a session name is still in its initial / unstarted state
   * (e.g. "PiDesk", "PiDesk (2)", or matches the bare folder name before conversation starts).
   */
  function isInitialSessionName(name, folder = "") {
    if (!name || typeof name !== "string") return true;
    const trimmed = name.trim();
    if (isDefaultSessionName(trimmed)) return true;
    const folderStr = folderName(folder);
    if (folderStr) {
      if (trimmed.toLowerCase() === folderStr.toLowerCase()) return true;
      const esc = folderStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^${esc}\\s*\\(\\d+\\)$`, "i").test(trimmed)) return true;
    }
    return false;
  }

  /**
   * Formats a session title for display on a tab:
   * - If folder is provided, prefixes with `${folderName}: ${cleaned}`.
   * - If no folder, returns `${cleaned}`.
   * - Avoids duplicating the prefix if raw already starts with `${folderName}:`.
   */
  function formatSessionTitle(raw, folder = "", options = {}) {
    const folderStr = folderName(folder);
    const cleaned = cleanSessionTitle(raw, "", options);

    if (folderStr) {
      if (!cleaned) return folderStr;
      const prefixPattern = new RegExp(`^${folderStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i");
      const bareTitle = cleaned.replace(prefixPattern, "");
      if (!bareTitle || bareTitle.toLowerCase() === folderStr.toLowerCase()) return folderStr;
      return `${folderStr}: ${bareTitle}`;
    }

    return cleaned || (options.fallback ?? "");
  }

  /**
   * Computes the next session title given the current session entry and raw title/prompt:
   * - Skips if entry is missing or raw text is blank.
   * - When !options.force:
   *     - Returns null if the title is already locked (entry.titleLocked || entry.userTitled).
   *     - Returns null if raw starts with "/" (slash commands like /plan, /compact, /review).
   *     - Returns null if the entry name is not in initial state (isInitialSessionName).
   * - Strips file mentions and sanitizes text; returns null if cleaned text is empty.
   * - Formats with folder prefix when applicable.
   * - Returns null if the formatted title equals entry.name.
   * - Returns the formatted title string otherwise.
   */
  function nextTitle(entry, raw, options = {}) {
    if (!entry || typeof raw !== "string" || !raw.trim()) return null;
    const force = Boolean(options.force);
    const isLocked = Boolean(entry.titleLocked || entry.userTitled);

    if (!force) {
      if (isLocked) return null;
      const trimmed = raw.trim();
      if (trimmed.startsWith("/")) return null;
      const folder = folderName(entry.path);
      if (!isInitialSessionName(entry.name, folder)) return null;
    }

    const folder = folderName(entry.path);
    const cleaned = cleanSessionTitle(raw, "", options);
    if (!cleaned) return null;

    const formatted = formatSessionTitle(cleaned, folder, { fallback: entry.name });
    if (!formatted || formatted === entry.name) return null;
    return formatted;
  }

  return {
    cleanSessionTitle,
    folderName,
    resolveFolderTitle,
    isDefaultSessionName,
    isInitialSessionName,
    formatSessionTitle,
    nextTitle,
  };
});
